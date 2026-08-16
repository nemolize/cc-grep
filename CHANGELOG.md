# @nemolize/cc-grep

## 0.4.0

### Minor Changes

- [#42](https://github.com/nemolize/cc-grep/pull/42) [`c8154d4`](https://github.com/nemolize/cc-grep/commit/c8154d4996202863be23977ab458151b634928cc) - Add `--session` to dump one session as a conversation. Search narrows to a
  session id, but reading that session back had no route through the tool;
  `--session` prints it whole instead of searching across all sessions. The id
  resolves by prefix, so the 8-char form search prints is enough, and the pattern
  becomes optional — passing one alongside `--session` keeps search semantics and
  highlights within the turns it selects. Filters compose unchanged and `--json`
  emits the same per-hit objects, so a dump pipes to `jq` like a search.

- [#52](https://github.com/nemolize/cc-grep/pull/52) [`694848e`](https://github.com/nemolize/cc-grep/commit/694848e3b4c4bb822e69244f8bc7dd5a6a9abca0) - Mark subagent hits and add a `--subagents <include|exclude|only>` scope filter.
  A subagent turn carries its parent's session id and a bare `user` role, so it
  was indistinguishable from something the human typed; hits now carry a `▸sub`
  mark as a separate token, keeping the session id copyable. The default differs
  per surface — a search includes subagent turns, a `--session` dump excludes
  them — and `--json` names the relation via `isSubagent`, `agentId` and
  `parentSessionId`. `--include-subagents` remains as a deprecated alias for
  `--subagents=include`.

## 0.3.0

### Minor Changes

- Render `tool_use` hits readably instead of as one serialized JSON blob. A tool
  call now extracts as a `⚙ <name>` header plus one `key: value` line per
  argument, with string values spliced in raw so their newlines become real
  lines. Because those lines are also what patterns match against, a hit inside
  a tool call now shows only its own neighbourhood rather than dragging an
  entire heredoc along, and `-C N` counts real lines. ([#30](https://github.com/nemolize/cc-grep/pull/30), closes [#29](https://github.com/nemolize/cc-grep/issues/29))

### Patch Changes

- Tighten CLI argument validation, and preserve the precedence of grouped
  control options so a later flag in a group no longer loses to an earlier one.
  Argument parsing moved to Node's own parser. ([#20](https://github.com/nemolize/cc-grep/pull/20))

## 0.2.1

### Patch Changes

- Report the real version under `--version`. The published 0.2.0 package
  answered `0.1.0`, because the CLI carried a hardcoded literal that had drifted
  from `package.json`; the version is now read from `package.json` at runtime. ([#16](https://github.com/nemolize/cc-grep/pull/16))

## 0.2.0

### Minor Changes

- No user-visible change; the version was raised alongside the release workflow
  that carried this project until Changesets replaced it.

## 0.1.0

### Minor Changes

- Initial release: a cross-project full-text search CLI over Claude Code session
  transcripts, published as `@nemolize/cc-grep` and runnable via `npx`.

Entries for 0.3.0 and earlier were reconstructed by hand from the git history,
this project having adopted Changesets only afterwards.
