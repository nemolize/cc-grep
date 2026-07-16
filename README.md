# cc-grep

Grep across every Claude Code session transcript on your machine, so you can
find past conversations by content — _"what did I discuss with Claude about X
three weeks ago?"_

Claude Code stores each session as a JSONL transcript under
`~/.claude/projects/`. `cc-grep` scans them all and prints matching turns with
their project, timestamp, session id, and role — plus a ready-to-run
`claude --resume` command to jump back into any hit.

Read-only. Nothing ever leaves your machine.

## Usage

```
npx @nemolize/cc-grep <pattern> [options]
```

The `bin` entry is `cc-grep`, so once installed globally (or symlinked) the
command is just `cc-grep <pattern>`.

```
$ npx @nemolize/cc-grep "auth flow"
~/proj-a  2026-07-10 21:34  a1b2c3d4  user
  │ …preceding line…
  │ >> …matched line with auth flow highlighted…
  │ …following line…
```

### Pattern

- Substring match by default.
- `-e, --regex` — treat the pattern as a regular expression.
- `-F, --fixed` — force literal match (overrides `--regex`).
- `-i, --ignore-case` — case-insensitive match.

### Scope

- `--root <path>` — transcript root. Defaults to `$CC_GREP_ROOT`, else
  `~/.claude/projects`.

### Filters

- `--role <user|assistant|any>` — restrict by turn role (default: `any`).
- `--since <dur|date>` / `--until <dur|date>` — time window. Accepts a relative
  duration (`7d`, `2h`, `30m`, `1w`) or an absolute date (`2026-06-01`).
- `--cwd <substring>` — restrict to sessions whose working directory matches.
- `--branch <substring>` — restrict by the git branch at session start.
- `--include-meta` — include `isMeta` (skill/system-injected) turns, off by
  default.

### Context & output

- `-C, --context <N>` — lines of context around each match (default: 2).
- `--json` — emit one JSON object per hit, one per line, for piping to `jq`.
- `--color <always|never|auto>` — colorize output (default: auto-detects a TTY).
- `--resume` — print `claude --resume <id>` for the top hit.
- `--print-resume` — print the resume command for every hit.

### Exit status

`0` when at least one hit is found, `1` when none, `2` on a usage error
(following the `grep` convention).

## How it works

Each transcript line is parsed defensively: unrecognised line shapes and
malformed JSON are skipped rather than crashing the scan, since the transcript
schema is undocumented and drifts. Searchable text is pulled from message text,
thinking blocks, tool inputs (e.g. the Bash command run), and tool results.

The scan is a plain linear read — fast enough (sub-second for a
low-thousands-of-sessions corpus) that no index is needed.

## Requirements

Node.js 22+. No native dependencies.

## License

MIT
