# cc-grep

Grep across every Claude Code session transcript on your machine, so you can
find past conversations by content — _"what did I discuss with Claude about X
three weeks ago?"_

Claude Code stores each session as a JSONL transcript under
`~/.claude/projects/`. `cc-grep` scans them all and prints matching turns with
their project, timestamp, session id, and role — plus a ready-to-run
`claude --resume` command to jump back into any hit.

Read-only. Nothing ever leaves your machine.

## Why

You solved something with Claude weeks ago and now hit the same problem — but
the shell history is gone and you can't remember which project it was in.
`cc-grep "denyRead"` finds the turn; `--resume` drops you back into that
session.

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
- `--resume` — print `claude --resume <id>` for the top hit only. Use once
  your filters have narrowed things down to the session you want.
- `--print-resume` — print the resume command for every hit. Use while
  browsing, so any hit can be jumped into.

## Recipes

```sh
# What did I ask about X in the last month?
cc-grep "X" --role user --since 30d

# Jump back into the most relevant past session
cc-grep "X" --resume

# Only sessions from a specific project
cc-grep "X" --cwd myrepo

# List the unique sessions that mention X
cc-grep "X" --json | jq -r .sessionId | sort -u
```

## Exit status

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

Node.js 22+ — the floor tracks the active LTS line (enforced via the
package's `engines` field); older runtimes are untested. No native
dependencies.

## Development

```
pnpm install
pnpm run build
pnpm start <pattern> [options]   # e.g. `pnpm start -h`, `pnpm start "auth flow"`
```

`pnpm start` is `node dist/cli.js`, so a `pnpm run build` is required after
each source change. Pass CLI options after the pattern the same as `cc-grep`
itself.

## Gotchas

### `pnpm start -- -h` breaks flag parsing

Don't prefix flags with `--` — write `pnpm start -h`, not `pnpm start -- -h`.
pnpm forwards the trailing `-h` past its own separator, and the CLI's own `--`
stops flag parsing, so `-h` lands as the search pattern instead of the help
flag.

## License

MIT
