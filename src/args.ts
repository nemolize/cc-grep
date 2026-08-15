import { parseArgs as parseNodeArgs } from "node:util";

import { parseSinceUntil } from "./duration.js";
import { defaultRoot } from "./loader.js";
import type { ColorMode, Options, RoleFilter } from "./types.js";

export const HELP = `cc-grep — grep across Claude Code session transcripts

Usage:
  cc-grep <pattern> [options]
  cc-grep --session <id> [pattern] [options]

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
  --role <user|assistant|any>   Restrict by turn role (default: any)
  --since <dur|date>            Only turns at/after (e.g. 7d, 2h, 2026-06-01)
  --until <dur|date>            Only turns at/before
  --cwd <substring>             Restrict to sessions whose cwd matches
  --branch <substring>          Restrict by gitBranch
  --include-meta                Include isMeta (skill/system) turns

Context & output:
  -C, --context <N>    Lines of context around each match (default: 2)
  --json               Emit one JSON object per hit (pipeline-friendly)
  --color <always|never|auto>   Colorize output (default: auto)
  --resume             Print \`claude --resume <id>\` for the top hit
  --print-resume       Print the resume command for every hit
  -h, --help           Show this help
  -V, --version        Show version
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
  "include-meta": { type: "boolean" },
  context: { type: "string", short: "C" },
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
  // Without a pattern, `--session` still selects a whole conversation; an empty
  // pattern makes every line of it a match.
  if (pattern === undefined && session === undefined) {
    return err("missing search pattern");
  }
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
      pattern: pattern ?? "",
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
      includeMeta: values["include-meta"] ?? false,
      context,
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
