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
cc-grep --tool Edit --file <path>        # find which session changed a file
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
- `--tool <name[,name...]>` — restrict to turns that called one of these tools,
  matched case-insensitively. Repeatable, so `--tool Edit --tool Write` and
  `--tool Edit,Write` are the same request.
- `--file <substring>` — restrict to turns whose tool call targets a matching
  path (`file_path` / `notebook_path`). See
  [Finding which session changed a file](#finding-which-session-changed-a-file).
- `--include-meta` — include `isMeta` (skill/system-injected) turns, off by
  default.

### Surveying a broad pattern

A pattern that matches thousands of turns prints megabytes, which is the wrong
first move — especially when the output is going into an agent's context window.
Survey first, then narrow:

- `-c, --count` — print how many hits there are, and nothing else.
- `-l, --list-sessions` — print one line per matching session (full id, hit
  count, cwd), most hits first. The id is printed in full, so the line pastes
  into `--session`.
- `-m, --max-count <N>` — stop after N hits, and note on stderr that it capped.
  Piping through `head` also ends the scan (the EPIPE guard sees the closed
  pipe), so this is not about speed: `-m` stops at exactly hit N rather than at
  whatever the pipe buffer held, never cuts a hit mid-block, keeps the exit
  status meaningful, and composes with `-c`.

```
$ cc-grep "denyRead" -c
223

$ cc-grep "denyRead" -l
3bdb74bf-2a64-400b-94cb-b76a9f0620df    30 hits  ~/dotfiles
74b82329-00d8-4530-bb8b-c08d85d38c05    25 hits  ~/dotfiles
…
```

`--json` pairs with both: `-c` emits a single `{"hits":223}`, `-l` emits one
`{"sessionId":…,"hits":…,"cwd":…}` per session. Neither composes with
`--resume` / `--print-resume` — a summary prints no hit to resume, so the
combination is a usage error rather than a silently dropped flag.

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
~/proj  2026-07-25 01:28  09a180aa ▸sub  user
  │ >> …a skill body injected into a spawned agent…
```

The mark is a separate token, so the session id stays copyable into `--session`.
In a `--session` dump the mark carries the agent's own id alongside it
(`user  2026-07-25 01:28  ▸sub a2b5036c2408d89dc`), which separates one spawned
agent's turns from another's.

`--subagents` scopes them, and the default differs by surface — a search
includes them, a `--session` dump excludes them:

- `include` — search's default. Everything the session produced.
- `exclude` — what you want when reconstructing what the human actually asked,
  since `--role user` alone still mixes in every orchestrator prompt.
- `only` — what you want when auditing what a fan-out did.

`--json` names the relation rather than leaving it to be inferred from the file
path: `isSubagent`, plus `agentId` and `parentSessionId` on a subagent hit.

## Finding which session changed a file

"Who last touched this file, and in what conversation" is the transcript
analogue of `git log --follow`, and it is what an unexplained working-tree
change raises. Grepping for the path answers a different question: a `Read`, a
`Grep --path`, a `git diff -- <path>` and an actual `Edit` all match the same
string, and in a prose-heavy repo the filename's own mentions drown the rest.

`--tool` and `--file` filter on the tool calls themselves, so the edit is
separable from the mention:

```sh
$ cc-grep --tool Edit,Write --file 'rules/documentation-staleness.md' --since 7d
~/dotfiles  2026-08-07 23:01  84c616b9  assistant  [Edit ~/dotfiles/rules/documentation-staleness.md]
```

Both conditions hold on the _same_ call, so a session that read the file and
edited a different one does not match. With no pattern the hit is the header
alone — the tool and the path it targeted are the answer. Pass a pattern too
and the matched lines come back as usual, still restricted to those turns.

`--file` matches a substring of the path, so a repo-relative fragment finds an
absolute path in the transcript. `--tool` is case-insensitive and repeatable.

`--json` carries a `toolCalls` array (`{name, paths}`) on any hit that made one,
so the attribution is machine-readable without re-parsing the rendered lines.
On a patternless search `matchedLines` comes back empty for the same reason the
header stands alone — every line "matched", so listing them says nothing.

## Recipes

```sh
# Is X worth searching for at all, and where does it live?
cc-grep "X" -c
cc-grep "X" -l

# What did I ask about X in the last month?
cc-grep "X" --role user --since 30d --subagents exclude

# What did the agents a session spawned actually do with X?
cc-grep "X" --subagents only

# Jump back into the most relevant past session
cc-grep "X" --resume

# Only sessions from a specific project
cc-grep "X" --cwd myrepo

# Which session edited this file, and when?
cc-grep --tool Edit,Write --file src/format.ts --since 7d

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

A tool call's arguments become one `key: value` line each, with multi-line
values keeping their real line breaks — so a hit inside a long heredoc shows its
own neighbourhood rather than the whole argument. The tool's name is tagged on
the hit header:

```
~/proj-a  2026-07-30 22:59  22c88264  assistant  [Bash]
  │ >> command: gh pr create --draft --title "…"
  │ …following line of the heredoc…
```

The name is tagged even when the match lands deep enough in an argument that the
call's own header falls outside `-C N`.

An `Edit` renders its two sides as a diff rather than as labelled fields, and
arguments that carry no meaning for the reader (such as `replace_all`) are left
out unless they are what matched:

```
~/proj-a  2026-08-07 23:01  84c616b9  assistant  [Edit]
  │ file_path: .githooks/pre-commit
  │ >> - "$(git rev-parse --show-toplevel)/.githooks/lib/run-gitleaks.sh"
  │ + "$(git rev-parse --show-toplevel)/.githooks/lib/check-external-symlinks.sh"
```

This shaping is display-only: matching runs against the extracted `key: value`
lines, so `old_string:` still finds an edit and `--json` emits those lines
untouched. A pattern is tested per extracted line, so one spanning two arguments
won't match, and `command:` matches every Bash call.

Because extraction keeps a value's newlines but not the record of where they
were, the display layer tells an argument from a line of file content that looks
like one (`port: 80`) heuristically — a known argument name, not yet seen in that
call, and for a hidden argument its expected value too. A wrong guess never
hides a line, and a line that matched always prints; what it can do is carry a
`-`/`+` marker onto lines that are not part of that value — a run of content, or
text following the call in the same message.

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

### Releasing

Releases run on [Changesets](https://changesets.dev) — no version is edited and
no tag is pushed by hand. Alongside a user-visible change, run:

```
pnpm exec changeset        # pick patch/minor/major, write the summary
```

and commit the file it writes under `.changeset/`. Changes invisible to users
need none — and do not reach for `changeset --empty` to say so: an empty
changeset makes the workflow treat the repo as mid-release and never publish.

Those changesets accumulate on `main` until the release workflow collects them
into a **Version Packages** pull request — a version bump plus `CHANGELOG.md`
entries. That PR is the release: review it, and merging it publishes to npm,
pushes the `v<version>` tag and creates the GitHub Release.

Merge it with `gh pr merge <number> --admin`. GitHub does not trigger workflows
from events its own token created, so `ci.yml` never runs on that PR and `main`'s
required checks stay unreported. The release workflow checks the tree itself
instead — before opening the PR, and again on the merged commit before publishing.

When it goes wrong:

- `pnpm exec changeset version` needs `GITHUB_TOKEN` locally — it resolves pull
  request links through the API.
- A run that publishes to npm and then fails before tagging cannot be recovered
  by re-running: the version is already published, so the next run finds nothing
  to do. Tag and release by hand, using that version's `CHANGELOG.md` section as
  the release body.
- Merge the release PR only once its own workflow run has finished. A changeset
  landing on `main` while that run is still updating the PR leaves the merged
  bump unpublished, and the next release swallows the version.

## License

MIT
