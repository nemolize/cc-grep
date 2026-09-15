import { constants, createReadStream } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

import {
  type CodexFileState,
  newCodexFileState,
  parseCodexLine,
} from "./codex.js";
import { isRecord } from "./guards.js";
import type { Prefilter } from "./prefilter.js";
import { extractContent } from "./textExtract.js";
import type { TranscriptSource, Turn } from "./types.js";

// A single JSONL record over this many characters is either a pathological
// tool-result dump or a corrupted file — skip it rather than pay the
// JSON.parse + text-extract cost twice against readline's buffered line.
const MAX_JSONL_RECORD_CHARS = 8_000_000;

/**
 * Recursively yield every `*.jsonl` file path under `root`. A missing or
 * unreadable directory yields nothing (the caller reports "no transcripts")
 * rather than crashing. Symlinks are not followed — a symlink loop under the
 * transcript root would otherwise recurse forever.
 */
export async function* findTranscripts(root: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      yield* findTranscripts(full);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      yield full;
    }
  }
}

/**
 * Parse one transcript file into normalized turns. `source` selects the parser,
 * since the two agents share no schema; a line carrying no searchable text, and
 * a malformed one, are both skipped silently — never throw.
 *
 * `prefilter` may drop a raw line before it is parsed, which is what keeps a
 * rare term from costing a full-corpus parse. It must be a superset of the
 * caller's matcher, or hits go missing with no error.
 */
export async function* loadTurns(
  file: string,
  prefilter?: Prefilter,
  source: TranscriptSource = "claude",
): AsyncGenerator<Turn> {
  const stream = createReadStream(file, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let lineIndex = -1;
  const codexState = source === "codex" ? newCodexFileState() : undefined;
  try {
    for await (const line of rl) {
      lineIndex++;
      if (line.length === 0) continue;
      if (line.length > MAX_JSONL_RECORD_CHARS) continue;
      const turn =
        codexState === undefined
          ? parseClaudeLine(file, lineIndex, line, prefilter)
          : parseCodexFileLine(file, lineIndex, line, prefilter, codexState);
      if (turn) yield turn;
    }
  } catch {
    return; // unreadable file — skip, don't crash the scan
  } finally {
    rl.close();
    stream.destroy();
  }
}

/**
 * A metadata line is parsed even when the prefilter rejects it, because
 * skipping one would lose the `cwd` and session id every later turn inherits.
 */
function parseCodexFileLine(
  file: string,
  lineIndex: number,
  line: string,
  prefilter: Prefilter | undefined,
  state: CodexFileState,
): Turn | undefined {
  if (
    prefilter !== undefined &&
    !prefilter.test(line) &&
    !carriesCodexFileState(line)
  ) {
    return undefined;
  }
  return parseCodexLine(file, lineIndex, line, state);
}

/** Substring test on the raw line, so a metadata line survives the prefilter without a parse. */
function carriesCodexFileState(line: string): boolean {
  return line.includes('"session_meta"') || line.includes('"turn_context"');
}

function parseClaudeLine(
  file: string,
  lineIndex: number,
  line: string,
  prefilter: Prefilter | undefined,
): Turn | undefined {
  if (prefilter !== undefined && !prefilter.test(line)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const obj = parsed;

  const role = typeof obj["type"] === "string" ? obj["type"] : undefined;
  if (role !== "user" && role !== "assistant") return undefined;

  const message = isRecord(obj["message"]) ? obj["message"] : undefined;
  const { textLines, toolCalls } = extractContent(message?.["content"]);
  if (textLines.length === 0) return undefined;

  const timestamp =
    typeof obj["timestamp"] === "string" ? obj["timestamp"] : undefined;
  const parsedTs = timestamp === undefined ? NaN : Date.parse(timestamp);

  return {
    file,
    lineIndex,
    source: "claude",
    role,
    sessionId:
      typeof obj["sessionId"] === "string" ? obj["sessionId"] : undefined,
    timestamp,
    timestampMs: Number.isNaN(parsedTs) ? undefined : parsedTs,
    cwd: typeof obj["cwd"] === "string" ? obj["cwd"] : undefined,
    gitBranch:
      typeof obj["gitBranch"] === "string" ? obj["gitBranch"] : undefined,
    isMeta: obj["isMeta"] === true,
    isSidechain: obj["isSidechain"] === true,
    agentId: typeof obj["agentId"] === "string" ? obj["agentId"] : undefined,
    textLines,
    toolCalls,
  };
}

/**
 * Readability is checked, not just existence, because `findTranscripts` swallows
 * the `EACCES` a locked-down directory raises and would report it as no hits.
 */
export async function isReadableDir(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isDirectory()) return false;
    await access(path, constants.R_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
