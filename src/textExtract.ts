import { isRecord } from "./guards.js";
import type { ToolCall } from "./types.js";

/** Text lines plus the tool calls `--tool` / `--file` filter on. */
export interface ExtractedContent {
  textLines: string[];
  toolCalls: ToolCall[];
}

/**
 * Extract searchable text lines from a transcript line's `message.content`.
 *
 * `content` is either a plain string or an array of content blocks. Blocks come
 * in several shapes (text / thinking / tool_use / tool_result / image); each is
 * flattened to zero or more text lines. Anything unrecognised is skipped rather
 * than throwing — the schema is undocumented and drifts, so extraction degrades
 * gracefully. A block's own text may contain newlines; those are split so that
 * matching and `-C N` context operate per visual line.
 *
 * Tool calls are collected structurally too: the rendered lines lose which
 * field a value came from.
 */
export function extractContent(content: unknown): ExtractedContent {
  const out: string[] = [];
  const toolCalls: ToolCall[] = [];
  collect(content, out, 0, toolCalls);
  return { textLines: out.flatMap((s) => s.split("\n")), toolCalls };
}

/** Text-only view of {@link extractContent}. */
export function extractTextLines(content: unknown): string[] {
  return extractContent(content).textLines;
}

const MAX_DEPTH = 8;

function collect(
  node: unknown,
  out: string[],
  depth: number,
  toolCalls: ToolCall[],
): void {
  if (node == null || depth > MAX_DEPTH) return;

  if (typeof node === "string") {
    if (node.length > 0) out.push(node);
    return;
  }

  if (Array.isArray(node)) {
    for (const item of node) collect(item, out, depth + 1, toolCalls);
    return;
  }

  if (!isRecord(node)) return;
  const block = node;

  switch (block["type"]) {
    case "text":
      collect(block["text"], out, depth + 1, toolCalls);
      return;
    case "thinking":
      collect(block["thinking"], out, depth + 1, toolCalls);
      return;
    case "tool_result":
      // `content` is a string or an array of `{type:"text", text}` blocks.
      collect(block["content"], out, depth + 1, toolCalls);
      return;
    case "tool_use":
      collectToolUse(block, out, toolCalls);
      return;
    case "image":
      return; // no text to search
    default:
      if (typeof block["text"] === "string") out.push(block["text"]);
      return;
  }
}

/** Prefix identifying a tool-call header line in the output. */
export const TOOL_MARK = "⚙";

/**
 * Matching only these keeps a `Grep --path` scoping a search distinguishable
 * from an `Edit` of the same file — which session *changed* it is the question.
 */
const PATH_FIELDS = new Set(["file_path", "notebook_path"]);

/**
 * Values keep their real newlines so `-C N` shows a hit's neighbourhood rather
 * than a whole heredoc.
 */
function collectToolUse(
  block: Record<string, unknown>,
  out: string[],
  toolCalls: ToolCall[],
): void {
  const name = typeof block["name"] === "string" ? block["name"] : "";
  if (name !== "") out.push(`${TOOL_MARK} ${name}`);

  const paths: string[] = [];
  const input = block["input"];
  if (isRecord(input)) {
    for (const [key, value] of Object.entries(input)) {
      out.push(`${key}: ${renderValue(value, 0)}`);
      if (PATH_FIELDS.has(key) && typeof value === "string" && value !== "") {
        paths.push(value);
      }
    }
  } else if (input != null) {
    out.push(renderValue(input, 0));
  }

  // A nameless, pathless call matches neither filter and would only render as
  // an empty `[]` label.
  if (name !== "" || paths.length > 0) toolCalls.push({ name, paths });
}

/**
 * Nested strings are spliced in raw rather than JSON-escaped, so a value's own
 * newlines become real lines while a literal backslash-n in the data stays
 * literal — post-unescaping a serialized blob cannot tell the two apart.
 */
function renderValue(value: unknown, depth: number): string {
  if (typeof value === "string") return value;
  if (depth > MAX_DEPTH) return safeStringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => renderValue(v, depth + 1)).join(", ")}]`;
  }
  if (isRecord(value)) {
    const fields = Object.entries(value).map(
      ([k, v]) => `${k}: ${renderValue(v, depth + 1)}`,
    );
    return `{${fields.join(", ")}}`;
  }
  return safeStringify(value);
}

function safeStringify(value: unknown): string {
  try {
    // The lib types this as `string`, but it returns `undefined` for
    // `undefined` and any value that serialises to nothing.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}
