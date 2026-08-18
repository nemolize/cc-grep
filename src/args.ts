import { parseArgs as parseNodeArgs } from "node:util";

import { parseSinceUntil } from "./duration.js";
import { defaultRoot } from "./loader.js";
import type {
  ColorMode,
  Options,
  RoleFilter,
  SubagentScope,
  SummaryMode,
} from "./types.js";

export const HELP = `cc-grep — grep across Claude Code session transcripts

Usage:
  cc-grep <pattern> [options]
  cc-grep --session <id> [pattern] [options]
  cc-grep --tool <name[,name...]> [--file <substring>] [pattern] [options]

Pattern:
  Substring match by default.
  -e, --regex          Treat <pattern> as a regular expression
  -F, --fixed          Force literal match (overrides --regex)
  -i, --ignore-case    Case-insensitive match

Scope:
  --root <path>        Transcript root (default: $CC_GREP_ROOT or ~/.claude/projects)
  Dash-prefixed option values require --option=value (e.g. --cwd=-generated).

Filters:
  --session <id>                Dump one session as a conversation (id or prefix);
                                pattern becomes optional and, if given, highlights
  --subagents <include|exclude|only>
                                Scope subagent turns (default: include when
                                searching, exclude in a --session dump)
  --include-subagents           Deprecated alias for --subagents=include
  --role <user|assistant|any>   Restrict by turn role (default: any)
  --since <dur|date>            Only turns at/after (e.g. 7d, 2h, 2026-06-01)
  --until <dur|date>            Only turns at/before
  --cwd <substring>             Restrict to sessions whose cwd matches
  --branch <substring>          Restrict by gitBranch
  --tool <name[,name...]>       Only turns that called one of these tools
                                (case-insensitive, e.g. Edit,Write,MultiEdit)
  --file <substring>            Only turns whose tool call targets a matching
                                path (file_path / notebook_path)
  --include-meta                Include isMeta (skill/system) turns

Context & output:
  -C, --context <N>    Lines of context around each match (default: 2)
  -m, --max-count <N>  Stop after N hits (notes on stderr that it capped)
  -c, --count          Print the number of hits instead of the hits
  -l, --list-sessions  Print one line per matching session, most hits first
  --json               Emit one JSON object per hit — or per session with -l,
                       or a single {"hits":N} with -c (pipeline-friendly)
  --color <always|never|auto>   Colorize output (default: auto)
  --resume             Print \`claude --resume <id>\` for the top hit
  --print-resume       Print the resume command for every hit
  -h, --help           Show this help
  -V, --version        Show version

Examples:
  cc-grep "auth flow"                                  Search every transcript
  cc-grep "auth flow" -c                               How many hits? (survey first)
  cc-grep "auth flow" -l                               Which sessions mention it?
  cc-grep "auth flow" --role user --subagents exclude  Only what the human asked
  cc-grep "auth flow" --since 30d -m 20                Recent, capped at 20 hits
  cc-grep --session a1b2c3d4 --role user               Read one session's asks

A broad pattern can match thousands of turns and print megabytes. Survey with
-c or -l first, then narrow with the filters above or cap with -m.
`;

export type ParseResult =
  | { kind: "options"; options: Options }
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "error"; message: string };

const ARG_OPTIONS = {
  regex: { type: "boolean", short: "e" },
  fixed: { type: "boolean", short: "F" },
  "ignore-case": { type: "boolean", short: "i" },
  root: { type: "string" },
  session: { type: "string" },
  role: { type: "string" },
  since: { type: "string" },
  until: { type: "string" },
  cwd: { type: "string" },
  branch: { type: "string" },
  tool: { type: "string", multiple: true },
  file: { type: "string" },
  "include-meta": { type: "boolean" },
  "include-subagents": { type: "boolean" },
  subagents: { type: "string" },
  context: { type: "string", short: "C" },
  "max-count": { type: "string", short: "m" },
  count: { type: "boolean", short: "c" },
  "list-sessions": { type: "boolean", short: "l" },
  json: { type: "boolean" },
  color: { type: "string" },
  resume: { type: "boolean" },
  "print-resume": { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "V" },
} as const;

const parseConfiguredArgs = (args: string[]) =>
  parseNodeArgs({
    args,
    options: ARG_OPTIONS,
    allowPositionals: true,
  });

const SHORT_OPTION_TYPES = new Map<string, "boolean" | "string">();
for (const option of Object.values(ARG_OPTIONS)) {
  if ("short" in option) {
    SHORT_OPTION_TYPES.set(option.short, option.type);
  }
}

const CONTROL_SHORT_OPTIONS = new Map<string, "help" | "version">([
  [ARG_OPTIONS.help.short, "help"],
  [ARG_OPTIONS.version.short, "version"],
]);

const findControlOption = (args: string[]): "help" | "version" | undefined => {
  for (const arg of args) {
    if (arg === "--") return undefined;
    if (arg === "-h" || arg === "--help") return "help";
    if (arg === "-V" || arg === "--version") return "version";
    if (!arg.startsWith("-") || arg.startsWith("--") || arg === "-") continue;

    for (const shortName of arg.slice(1)) {
      const controlOption = CONTROL_SHORT_OPTIONS.get(shortName);
      if (controlOption !== undefined) return controlOption;

      const optionType = SHORT_OPTION_TYPES.get(shortName);
      if (optionType === undefined || optionType === "string") break;
    }
  }
  return undefined;
};

/**
 * Parse argv (excluding node + script) into structured options. Unknown flags
 * and missing values produce an `error` result rather than throwing, so the CLI
 * can print a message + usage and exit non-zero. The first non-flag argument is
 * the pattern — required unless `--session` is given; a leading `--` stops
 * option parsing.
 */
export function parseArgs(
  argv: string[],
  env: NodeJS.ProcessEnv,
  home: string,
  now: number = Date.now(),
): ParseResult {
  const controlOption = findControlOption(argv);
  if (controlOption !== undefined) return { kind: controlOption };

  let parsed: ReturnType<typeof parseConfiguredArgs>;
  try {
    parsed = parseConfiguredArgs(argv);
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }

  const { positionals, values } = parsed;

  if (values.help === true) return { kind: "help" };
  if (values.version === true) return { kind: "version" };

  const session = values.session;
  if (session !== undefined && session === "") {
    return err("--session requires a session id (or a unique prefix)");
  }

  const pattern = positionals[0];
  if (positionals[1] !== undefined) {
    return err(`unexpected extra argument: "${positionals[1]}"`);
  }

  const roleValue = values.role;
  if (
    roleValue !== undefined &&
    roleValue !== "user" &&
    roleValue !== "assistant" &&
    roleValue !== "any"
  ) {
    return err(`--role must be one of user|assistant|any (got "${roleValue}")`);
  }
  const role: RoleFilter = roleValue ?? "any";

  const subagentsValue = values.subagents;
  if (
    subagentsValue !== undefined &&
    subagentsValue !== "include" &&
    subagentsValue !== "exclude" &&
    subagentsValue !== "only"
  ) {
    return err(
      `--subagents must be one of include|exclude|only (got "${subagentsValue}")`,
    );
  }
  if (subagentsValue !== undefined && values["include-subagents"] === true) {
    return err("--subagents and --include-subagents cannot be combined");
  }
  const subagents: SubagentScope | undefined =
    subagentsValue ??
    (values["include-subagents"] === true ? "include" : undefined);

  let sinceMs: number | undefined;
  let untilMs: number | undefined;
  let context = 2;

  try {
    if (values.since !== undefined) {
      sinceMs = parseSinceUntil(values.since, "since", now);
    }
    if (values.until !== undefined) {
      untilMs = parseSinceUntil(values.until, "until", now);
    }
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }

  if (values.context !== undefined) {
    if (values.context === "") {
      return err('--context must be an integer in [0, 10000] (got "")');
    }
    const parsedContext = Number(values.context);
    if (
      !Number.isInteger(parsedContext) ||
      parsedContext < 0 ||
      parsedContext > 10_000
    ) {
      return err(
        `--context must be an integer in [0, 10000] (got "${values.context}")`,
      );
    }
    context = parsedContext;
  }

  let tools: string[] | undefined;
  if (values.tool !== undefined) {
    tools = values.tool
      .flatMap((value) => value.split(","))
      .map((name) => name.trim())
      .filter((name) => name !== "");
    if (tools.length === 0) {
      return err("--tool requires at least one tool name");
    }
  }

  if (values.file === "") {
    return err("--file requires a path substring");
  }

  // `--tool` / `--file` select turns on their own, so they stand in for the
  // pattern the same way `--session` does.
  if (
    pattern === undefined &&
    session === undefined &&
    tools === undefined &&
    values.file === undefined
  ) {
    return err("missing search pattern");
  }

  let maxCount: number | undefined;
  if (values["max-count"] !== undefined) {
    const parsedMaxCount = Number(values["max-count"]);
    if (
      values["max-count"] === "" ||
      !Number.isInteger(parsedMaxCount) ||
      parsedMaxCount < 1
    ) {
      return err(
        `--max-count must be an integer >= 1 (got "${values["max-count"]}")`,
      );
    }
    maxCount = parsedMaxCount;
  }

  if (values.count === true && values["list-sessions"] === true) {
    return err("--count and --list-sessions cannot be combined");
  }
  const summary: SummaryMode | undefined =
    values.count === true
      ? "count"
      : values["list-sessions"] === true
        ? "sessions"
        : undefined;

  if (summary !== undefined) {
    const summaryFlag = values.count === true ? "--count" : "--list-sessions";
    for (const resumeFlag of ["resume", "print-resume"] as const) {
      if (values[resumeFlag] === true) {
        return err(
          `--${resumeFlag} and ${summaryFlag} cannot be combined — a summary prints no hit to resume`,
        );
      }
    }
  }

  const colorValue = values.color;
  if (
    colorValue !== undefined &&
    colorValue !== "always" &&
    colorValue !== "never" &&
    colorValue !== "auto"
  ) {
    return err(
      `--color must be one of always|never|auto (got "${colorValue}")`,
    );
  }
  const color: ColorMode = colorValue ?? "auto";

  if (sinceMs !== undefined && untilMs !== undefined && sinceMs > untilMs) {
    return err("--since must not be after --until");
  }

  return {
    kind: "options",
    options: {
      pattern,
      session,
      regex: values.regex ?? false,
      fixed: values.fixed ?? false,
      ignoreCase: values["ignore-case"] ?? false,
      root: values.root ?? defaultRoot(env, home),
      role,
      sinceMs,
      untilMs,
      cwd: values.cwd,
      branch: values.branch,
      tools,
      file: values.file,
      includeMeta: values["include-meta"] ?? false,
      subagents,
      context,
      maxCount,
      summary,
      resume: values.resume ?? false,
      printResume: values["print-resume"] ?? false,
      json: values.json ?? false,
      color,
    },
  };
}

function err(message: string): ParseResult {
  return { kind: "error", message };
}
