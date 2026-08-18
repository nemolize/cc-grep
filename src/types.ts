/** One `tool_use` block, reduced to what `--tool` and `--file` filter on. */
export interface ToolCall {
  /** Empty when the block carried no `name`. */
  name: string;
  /** Values of the call's path-shaped input fields, in input order. */
  paths: string[];
}

/**
 * Normalized view of a single transcript turn (one JSONL line) that survived
 * schema-tolerant parsing. Fields absent in the source line are left undefined
 * rather than defaulted, so filters can distinguish "absent" from "empty".
 */
export interface Turn {
  /** Absolute path to the source `.jsonl` file. */
  file: string;
  /** 0-based line index within the file. */
  lineIndex: number;
  /** `type` field: `user` / `assistant` / etc. */
  role: string;
  sessionId?: string | undefined;
  /** Parsed epoch millis of `timestamp`, if it was a valid ISO8601 string. */
  timestampMs?: number | undefined;
  /** Raw `timestamp` string, preserved for display. */
  timestamp?: string | undefined;
  cwd?: string | undefined;
  gitBranch?: string | undefined;
  isMeta: boolean;
  /**
   * True for a subagent (sidechain) turn. Subagent transcripts live beside the
   * session's own file and carry the *parent's* `sessionId`, so this is what
   * separates the conversation from the agents it spawned.
   */
  isSidechain: boolean;
  /** Present only alongside `isSidechain`; the transcript omits it elsewhere. */
  agentId?: string | undefined;
  /**
   * Searchable text lines extracted from `message.content`. Each element is one
   * logical line; matching and context (`-C N`) operate over this array.
   */
  textLines: string[];
  /** Structural view of the turn's `tool_use` blocks; empty when it had none. */
  toolCalls: ToolCall[];
}

export type RoleFilter = "user" | "assistant" | "any";

export type SubagentScope = "include" | "exclude" | "only";

export type ColorMode = "always" | "never" | "auto";

export interface Options {
  /** Absent when `--session` is given without one: every turn is a hit. */
  pattern?: string | undefined;
  /** Session id (or a unique prefix) to dump as a conversation. */
  session?: string | undefined;
  regex: boolean;
  fixed: boolean;
  root: string;
  role: RoleFilter;
  sinceMs?: number | undefined;
  untilMs?: number | undefined;
  cwd?: string | undefined;
  branch?: string | undefined;
  /** Tool names to restrict to; a turn passes if it called any of them. */
  tools?: string[] | undefined;
  /** Substring matched against path-shaped tool-call inputs. */
  file?: string | undefined;
  includeMeta: boolean;
  /** Undefined leaves each surface its own default — see `passesSubagentScope`. */
  subagents?: SubagentScope | undefined;
  context: number;
  resume: boolean;
  printResume: boolean;
  json: boolean;
  color: ColorMode;
  ignoreCase: boolean;
}

/** One matched turn plus the specific line indices that matched. */
export interface Hit {
  turn: Turn;
  /** Indices into `turn.textLines` that matched the pattern. */
  matchedLineIndices: number[];
}
