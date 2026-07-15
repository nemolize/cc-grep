import { parseSinceUntil } from "./duration.js";
import { defaultRoot } from "./loader.js";
import type { ColorMode, Options, RoleFilter } from "./types.js";

export const HELP = `cc-grep — grep across Claude Code session transcripts

Usage:
  cc-grep <pattern> [options]

Pattern:
  Substring match by default.
  -e, --regex          Treat <pattern> as a regular expression
  -F, --fixed          Force literal match (overrides --regex)
  -i, --ignore-case    Case-insensitive match

Scope:
  --root <path>        Transcript root (default: $CC_GREP_ROOT or ~/.claude/projects)

Filters:
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

const NEEDS_VALUE = new Set([
  "--root",
  "--role",
  "--since",
  "--until",
  "--cwd",
  "--branch",
  "-C",
  "--context",
  "--color",
]);

/**
 * Parse argv (excluding node + script) into structured options. Unknown flags
 * and missing values produce an `error` result rather than throwing, so the CLI
 * can print a message + usage and exit non-zero. The first non-flag argument is
 * the pattern; a leading `--` stops option parsing.
 */
export function parseArgs(
  argv: string[],
  env: NodeJS.ProcessEnv,
  home: string,
  now: number = Date.now(),
): ParseResult {
  let pattern: string | undefined;
  let regex = false;
  let fixed = false;
  let ignoreCase = false;
  let root: string | undefined;
  let role: RoleFilter = "any";
  let sinceMs: number | undefined;
  let untilMs: number | undefined;
  let cwd: string | undefined;
  let branch: string | undefined;
  let includeMeta = false;
  let context = 2;
  let resume = false;
  let printResume = false;
  let json = false;
  let color: ColorMode = "auto";

  let noMoreFlags = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;

    if (noMoreFlags || !arg.startsWith("-") || arg === "-") {
      if (pattern === undefined) pattern = arg;
      else return err(`unexpected extra argument: "${arg}"`);
      continue;
    }
    if (arg === "--") {
      noMoreFlags = true;
      continue;
    }

    // Support --key=value.
    let key = arg;
    let inlineValue: string | undefined;
    const eq = arg.indexOf("=");
    if (arg.startsWith("--") && eq !== -1) {
      key = arg.slice(0, eq);
      inlineValue = arg.slice(eq + 1);
    }

    const takeValue = (): string | undefined => {
      if (inlineValue !== undefined) return inlineValue;
      if (i + 1 < argv.length) return argv[++i];
      return undefined;
    };

    if (
      NEEDS_VALUE.has(key) &&
      inlineValue === undefined &&
      i + 1 >= argv.length
    ) {
      return err(`option ${key} requires a value`);
    }

    switch (key) {
      case "-h":
      case "--help":
        return { kind: "help" };
      case "-V":
      case "--version":
        return { kind: "version" };
      case "-e":
      case "--regex":
        regex = true;
        break;
      case "-F":
      case "--fixed":
        fixed = true;
        break;
      case "-i":
      case "--ignore-case":
        ignoreCase = true;
        break;
      case "--include-meta":
        includeMeta = true;
        break;
      case "--resume":
        resume = true;
        break;
      case "--print-resume":
        printResume = true;
        break;
      case "--json":
        json = true;
        break;
      case "--root":
        root = takeValue();
        break;
      case "--role": {
        const v = takeValue();
        if (v !== "user" && v !== "assistant" && v !== "any") {
          return err(`--role must be one of user|assistant|any (got "${v}")`);
        }
        role = v;
        break;
      }
      case "--since":
      case "--until": {
        const v = takeValue();
        if (v === undefined) return err(`option ${key} requires a value`);
        try {
          const ms = parseSinceUntil(v, now);
          if (key === "--since") sinceMs = ms;
          else untilMs = ms;
        } catch (e) {
          return err(e instanceof Error ? e.message : String(e));
        }
        break;
      }
      case "--cwd":
        cwd = takeValue();
        break;
      case "--branch":
        branch = takeValue();
        break;
      case "-C":
      case "--context": {
        const v = takeValue();
        if (v === undefined) return err(`option ${key} requires a value`);
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0) {
          return err(`--context must be a non-negative integer (got "${v}")`);
        }
        context = n;
        break;
      }
      case "--color": {
        const v = takeValue();
        if (v !== "always" && v !== "never" && v !== "auto") {
          return err(`--color must be one of always|never|auto (got "${v}")`);
        }
        color = v;
        break;
      }
      default:
        return err(`unknown option: ${key}`);
    }
  }

  if (pattern === undefined) {
    return err("missing search pattern");
  }

  return {
    kind: "options",
    options: {
      pattern,
      regex,
      fixed,
      ignoreCase,
      root: root ?? defaultRoot(env, home),
      role,
      sinceMs,
      untilMs,
      cwd,
      branch,
      includeMeta,
      context,
      resume,
      printResume,
      json,
      color,
    },
  };
}

function err(message: string): ParseResult {
  return { kind: "error", message };
}
