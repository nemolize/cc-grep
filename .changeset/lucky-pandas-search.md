---
"@nemolize/cc-grep": minor
---

Search Codex session transcripts alongside Claude Code's. Both roots are scanned by default — `~/.claude/projects` and `~/.codex/sessions` — so a machine with one agent installed needs no configuration, and `--source claude|codex|both` narrows it. A Codex hit is marked `codex` in its header and its `--json` row, and `--resume` prints `codex resume <id>` rather than `claude --resume <id>`, so a copied command cannot reopen the session under the wrong agent. The pattern, `--role`, `--since`/`--until`, `--cwd`, `--session` dumps, `--subagents`, `-c` and `-l` all work the same on both.

Three filters read something Codex records differently, or not at all, and the README says so rather than guessing: `--file` never matches a Codex turn (its tool arguments arrive as one opaque string, so no field is known to hold a path, and inferring one would attribute an edit to a session that merely mentioned a filename), `--tool` takes each source's own tool names, and `--branch` is Claude-only for now — Codex records the branch, but only at session start, which is a different filter than the per-turn one `--branch` documents. A `--file` or `--branch` run with a Codex root in scope says on stderr that it searched Claude only, so an empty result is never mistaken for an absence.

On the Codex side the searchable text covers messages, tool calls and their output, the queries a `web_search_call` or `tool_search_call` recorded, and the one-line reasoning summary older rollouts carry beside the encrypted body.

`--codex-root` joins `--root` so each source's root has its own flag, mirroring the env pair; `--root` keeps meaning Claude's exactly as it did. An unreadable root is an error when you named it — by flag or env var, and the message says which — and a silent skip when it was merely the default. A directory that exists but cannot be read now counts as unreadable rather than as no hits.

`parentSessionId` is now emitted only when the transcript recorded a parent. A few old Codex rollouts mark a thread as a subagent without naming one, and repeating the thread's own id there claimed it was its own parent.
