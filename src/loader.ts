import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { isRecord } from "./guards.js";
import { extractTextLines } from "./textExtract.js";
import type { Turn } from "./types.js";

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
 * Parse one transcript file into normalized turns. Only `user`/`assistant`
 * lines carry searchable text; other line types (summary, queue-operation, …)
 * are skipped. Malformed JSON lines are skipped silently — never throw.
 */
export async function* loadTurns(file: string): AsyncGenerator<Turn> {
  const stream = createReadStream(file, { encoding: "utf8" });
  // A read stream signals failure (missing file, permission, disappeared
  // mid-scan) asynchronously via an `error` event, not by throwing here.
  // Attaching a listener converts that into a rejected `for await` we swallow,
  // so one unreadable file never crashes the whole search.
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let lineIndex = -1;
  try {
    for await (const line of rl) {
      lineIndex++;
      if (line.length === 0) continue;
      const turn = parseLine(file, lineIndex, line);
      if (turn) yield turn;
    }
  } catch {
    return; // unreadable file — skip, don't crash the scan
  } finally {
    rl.close();
    stream.destroy();
  }
}

function parseLine(
  file: string,
  lineIndex: number,
  line: string,
): Turn | undefined {
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
  const textLines = extractTextLines(message?.["content"]);
  if (textLines.length === 0) return undefined;

  const timestamp =
    typeof obj["timestamp"] === "string" ? obj["timestamp"] : undefined;
  const parsedTs = timestamp === undefined ? NaN : Date.parse(timestamp);

  return {
    file,
    lineIndex,
    role,
    sessionId:
      typeof obj["sessionId"] === "string" ? obj["sessionId"] : undefined,
    timestamp,
    timestampMs: Number.isNaN(parsedTs) ? undefined : parsedTs,
    cwd: typeof obj["cwd"] === "string" ? obj["cwd"] : undefined,
    gitBranch:
      typeof obj["gitBranch"] === "string" ? obj["gitBranch"] : undefined,
    isMeta: obj["isMeta"] === true,
    textLines,
  };
}

/** Resolve the default transcript root: `CC_GREP_ROOT` env, else `~/.claude/projects`. */
export function defaultRoot(env: NodeJS.ProcessEnv, home: string): string {
  const override = env["CC_GREP_ROOT"];
  if (override !== undefined && override.length > 0) return override;
  return join(home, ".claude", "projects");
}

/** True if `path` exists and is a directory. */
export async function isReadableDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
