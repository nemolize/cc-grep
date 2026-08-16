# cc-grep

Grep across every Claude Code session transcript on your machine, so you can
find past conversations by content — _"what did I discuss with Claude about X
three weeks ago?"_

You solved something with Claude weeks ago and now hit the same problem — but
the shell history is gone and you can't remember which project it was in.
`cc-grep "denyRead"` finds the turn; `--resume` drops you back into that
session.

Claude Code stores each session as a JSONL transcript under
`~/.claude/projects/`. `cc-grep` scans them all and prints matching turns with
their project, timestamp, session id, and role — plus a ready-to-run
`claude --resume` command to jump back into any hit.

Read-only. Nothing ever leaves your machine.

## Usage

```
npx @nemolize/cc-grep <pattern> [options]
cc-grep <pattern> [options]              # once installed globally
cc-grep --session <id> [pattern]         # read one session as a conversation
```

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

- `--session <id>` — dump one session as a conversation instead of searching;
  see [Reading one session](#reading-one-session).
- `--subagents <include|exclude|only>` — scope subagent turns. Defaults differ
  per surface: a search includes them, a `--session` dump excludes them; see
  [Subagent turns](#subagent-turns). `--include-subagents` is a deprecated alias
  for `--subagents=include`.
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

## Reading one session

Finding a past decision is a two-step job: search narrows to a session, then you
read that session to recover the reasoning. `--session` covers the second step —
it prints a session as a conversation instead of searching across all of them:

```
$ cc-grep --session a1b2c3d4 --role user
session a1b2c3d4-5e6f-7890-abcd-ef1234567890  ~/proj-a  (main)

user  2026-07-10 21:30
  │ why did we drop the retry wrapper here?

user  2026-07-10 21:34
  │ …
```

- The id can be a prefix — the 8-char form the search output prints is enough.
  A prefix matching several sessions dumps each and warns on stderr, so widen it.
- Subagent turns are left out by default; `--subagents=include` puts them back.
  See [Subagent turns](#subagent-turns).
- The pattern is optional. Give one anyway to keep only the turns that match it,
  with the match highlighted; the whole turn is shown either way, since `-C N`
  windows are for scanning search hits, not for reading a conversation.
- The other filters compose: `--role user` shows just the asks, `--since` trims
  a long session to its recent stretch.
- `--json` emits the same per-hit objects as a search, so a dump pipes to `jq`
  the same way.

`claude --resume` also reopens a session, but interactively and at the cost of a
context window. Reading a past conversation as text is a different job.

## Subagent turns

A subagent's transcript lives beside its parent's and carries the _parent's_
session id, so its turns look like ordinary ones. They are not: a subagent's
`user` turn is the prompt an orchestrator injected into a spawned agent, not
something the human typed. In a fan-out-heavy session they can outnumber the
conversation itself.

Hits from a subagent are marked on the header, right after the session id:

```
~/proj  2026-07-25 01:28  09a180aa▸sub  user
  │ >> …a skill body injected into a spawned agent…
```

`--subagents` scopes them, and the default differs by surface — a search
includes them, a `--session` dump excludes them:

- `include` — search's default. Everything the session produced.
- `exclude` — what you want when reconstructing what the human actually asked,
  since `--role user` alone still mixes in every orchestrator prompt.
- `only` — what you want when auditing what a fan-out did.

`--json` names the relation rather than leaving it to be inferred from the file
path: `isSubagent`, plus `agentId` and `parentSessionId` on a subagent hit.

## Recipes

```sh
# What did I ask about X in the last month?
cc-grep "X" --role user --since 30d --subagents exclude

# What did the agents a session spawned actually do with X?
cc-grep "X" --subagents only

# Jump back into the most relevant past session
cc-grep "X" --resume

# Only sessions from a specific project
cc-grep "X" --cwd myrepo

# List the unique sessions that mention X
cc-grep "X" --json | jq -r .sessionId | sort -u

# Find the session that discussed X, then read how it started
cc-grep "X" --json | jq -r .sessionId | head -1 | xargs -I{} cc-grep --session {} --role user
```

## Exit status

`0` when at least one hit is found, `1` when none, `2` on a usage error
(following the `grep` convention).

## How it works

Each transcript line is parsed defensively: unrecognised line shapes and
malformed JSON are skipped rather than crashing the scan, since the transcript
schema is undocumented and drifts. Searchable text is pulled from message text,
thinking blocks, tool inputs (e.g. the Bash command run), and tool results.

A tool call is rendered as a `⚙ <tool name>` header followed by one
`key: value` line per argument, with multi-line values keeping their real line
breaks — so a hit inside a long heredoc shows its own neighbourhood rather than
the whole argument:

```
~/proj-a  2026-07-30 22:59  22c88264  assistant
  │ ⚙ Bash
  │ >> command: gh pr create --draft --title "…"
  │ …following line of the heredoc…
```

The `⚙` header is always shown for a matched tool call, even when the match
lands deep enough in an argument that the header falls outside `-C N`.

These rendered lines are also the lines matched against, so a pattern is tested
per displayed line: one spanning two arguments won't match, and `command:`
matches every Bash call.

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

`pnpm start` runs the built output, so re-run `pnpm run build` after each
source change.

### Checks

```
pnpm run lint            # eslint, prettier, type-check and knip, in parallel
pnpm run fix             # apply the eslint and prettier fixes
pnpm run test            # unit tests
pnpm run test:coverage   # unit tests with a coverage report
```

`pnpm run lint` uses `--continue-on-error`, so one failing check does not hide
the others. Coverage thresholds live in `vitest.config.ts` with `autoUpdate`
enabled: they rise as coverage improves and never fall on their own.

### Git hooks

`lefthook` installs them on `pnpm install`. `pre-commit` runs eslint and
prettier over the staged files, applying their fixes and re-staging what they
changed; `post-merge` reinstalls dependencies or toolchain versions when
`pnpm-lock.yaml` or `mise.toml` changed in the merge.

`lefthook.yml` only points at [`nemolize/lefthook-configs`](https://github.com/nemolize/lefthook-configs),
which holds the steps themselves and is shared across repositories.

## License

MIT
