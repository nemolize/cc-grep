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
   * Searchable text lines extracted from `message.content`. Each element is one
   * logical line; matching and context (`-C N`) operate over this array.
   */
  textLines: string[];
}

export type RoleFilter = "user" | "assistant" | "any";

export type ColorMode = "always" | "never" | "auto";

export interface Options {
  pattern: string;
  regex: boolean;
  fixed: boolean;
  root: string;
  role: RoleFilter;
  sinceMs?: number | undefined;
  untilMs?: number | undefined;
  cwd?: string | undefined;
  branch?: string | undefined;
  includeMeta: boolean;
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
