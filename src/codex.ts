import { isRecord } from "./guards.js";
import { TOOL_MARK } from "./textExtract.js";
import type { ToolCall, Turn } from "./types.js";

/**
 * Codex records `cwd` only on `session_meta` / `turn_context`, so a parser
 * reading one message line in isolation cannot fill it.
 */
export interface CodexFileState {
  sessionId?: string | undefined;
  threadId?: string | undefined;
  cwd?: string | undefined;
  isSubagent: boolean;
}

export function newCodexFileState(): CodexFileState {
  return { isSubagent: false };
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Only the first names the thread, because a rollout carries its parent's or
 * ancestors' meta below its own and last-wins hid the file's own id.
 */
function applySessionMeta(
  payload: Record<string, unknown>,
  state: CodexFileState,
): void {
  const cwd = str(payload["cwd"]);
  if (cwd !== undefined) state.cwd = cwd;
  if (state.sessionId !== undefined) return;

  const threadSource = str(payload["thread_source"]);
  state.sessionId = str(payload["session_id"]) ?? str(payload["id"]);
  state.threadId = str(payload["id"]);
  state.isSubagent = threadSource !== undefined && threadSource !== "user";
}

/**
 * `developer` carries injected instructions rather than anything either party
 * said, so it maps onto the flag Claude sets for the same content, `isMeta`.
 */
function readRole(
  role: string | undefined,
): { role: string; isMeta: boolean } | undefined {
  if (role === "user" || role === "assistant") return { role, isMeta: false };
  if (role === "developer") return { role: "user", isMeta: true };
  return undefined;
}

function collectMessageText(content: unknown): string[] {
  if (typeof content === "string")
    return content === "" ? [] : content.split("\n");
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    const text = block["text"];
    if (typeof text === "string" && text !== "") out.push(...text.split("\n"));
  }
  return out;
}

/**
 * `paths` stays empty because arguments arrive as one opaque string, not the
 * keyed object Claude sends, so no field is known to hold a path.
 */
function readToolCall(
  payload: Record<string, unknown>,
): { toolCall: ToolCall; textLines: string[] } | undefined {
  const name = str(payload["name"]) ?? "";
  const raw = payload["input"] ?? payload["arguments"];
  const args = typeof raw === "string" ? raw : undefined;
  if (name === "" && args === undefined) return undefined;

  const textLines: string[] = [];
  if (name !== "") textLines.push(`${TOOL_MARK} ${name}`);
  if (args !== undefined) textLines.push(...args.split("\n"));

  return { toolCall: { name, paths: [] }, textLines };
}

/**
 * Read separately because a search call keeps its query in a shape of its own —
 * `action.queries` for the web, `arguments.query` for a tool lookup — not `input`.
 */
function readSearchCall(
  payload: Record<string, unknown>,
): { toolCall: ToolCall; textLines: string[] } | undefined {
  const name = str(payload["type"]) ?? "";
  const queries: string[] = [];

  const action = payload["action"];
  if (isRecord(action)) {
    const list = action["queries"];
    if (Array.isArray(list)) {
      for (const q of list) {
        if (typeof q === "string" && q !== "") queries.push(q);
      }
    }
    const one = str(action["query"]);
    if (one !== undefined) queries.push(one);
  }
  const args = payload["arguments"];
  if (isRecord(args)) {
    const one = str(args["query"]);
    if (one !== undefined) queries.push(one);
  }
  if (queries.length === 0) return undefined;

  return {
    toolCall: { name, paths: [] },
    textLines: [`${TOOL_MARK} ${name}`, ...queries],
  };
}

/**
 * Only the summary is read because the reasoning body sits in
 * `encrypted_content`; older rollouts are the ones carrying a summary at all.
 */
function readReasoning(payload: Record<string, unknown>): string[] {
  const summary = payload["summary"];
  if (!Array.isArray(summary)) return [];
  const out: string[] = [];
  for (const block of summary) {
    if (!isRecord(block)) continue;
    const text = block["text"];
    if (typeof text === "string" && text !== "") out.push(...text.split("\n"));
  }
  return out;
}

function readToolOutput(payload: Record<string, unknown>): string[] {
  const output = payload["output"];
  if (typeof output === "string")
    return output === "" ? [] : output.split("\n");
  return collectMessageText(output);
}

/**
 * Undefined for the bookkeeping records that dominate a rollout file, since
 * they hold no searchable text; `state` still absorbs metadata they carry.
 */
export function parseCodexLine(
  file: string,
  lineIndex: number,
  line: string,
  state: CodexFileState,
): Turn | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;

  const payload = isRecord(parsed["payload"]) ? parsed["payload"] : undefined;
  if (payload === undefined) return undefined;

  const lineType = parsed["type"];
  if (lineType === "session_meta") {
    applySessionMeta(payload, state);
    return undefined;
  }
  if (lineType === "turn_context") {
    const cwd = str(payload["cwd"]);
    if (cwd !== undefined) state.cwd = cwd;
    return undefined;
  }
  if (lineType !== "response_item") return undefined;

  let role: string;
  let isMeta: boolean;
  let textLines: string[];
  let toolCalls: ToolCall[] = [];

  switch (payload["type"]) {
    case "message": {
      const kind = readRole(str(payload["role"]));
      if (kind === undefined) return undefined;
      role = kind.role;
      isMeta = kind.isMeta;
      textLines = collectMessageText(payload["content"]);
      break;
    }
    case "agent_message": {
      role = "assistant";
      isMeta = false;
      textLines = collectMessageText(payload["content"]);
      break;
    }
    case "custom_tool_call":
    case "function_call": {
      const call = readToolCall(payload);
      if (call === undefined) return undefined;
      role = "assistant";
      isMeta = false;
      textLines = call.textLines;
      toolCalls = [call.toolCall];
      break;
    }
    case "web_search_call":
    case "tool_search_call": {
      const call = readSearchCall(payload);
      if (call === undefined) return undefined;
      role = "assistant";
      isMeta = false;
      textLines = call.textLines;
      toolCalls = [call.toolCall];
      break;
    }
    case "reasoning": {
      role = "assistant";
      isMeta = false;
      textLines = readReasoning(payload);
      break;
    }
    case "custom_tool_call_output":
    case "function_call_output": {
      role = "user";
      isMeta = false;
      textLines = readToolOutput(payload);
      break;
    }
    default:
      return undefined;
  }

  if (textLines.length === 0) return undefined;

  const timestamp = str(parsed["timestamp"]);
  const parsedTs = timestamp === undefined ? NaN : Date.parse(timestamp);

  return {
    file,
    lineIndex,
    source: "codex",
    role,
    sessionId: state.sessionId,
    timestamp,
    timestampMs: Number.isNaN(parsedTs) ? undefined : parsedTs,
    cwd: state.cwd,
    gitBranch: undefined,
    isMeta,
    isSidechain: state.isSubagent,
    agentId: state.isSubagent ? state.threadId : undefined,
    textLines,
    toolCalls,
  };
}
