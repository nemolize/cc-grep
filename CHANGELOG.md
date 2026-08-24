# @nemolize/cc-grep

## 0.5.0

### Minor Changes

- [#66](https://github.com/nemolize/cc-grep/pull/66) [`5f8fd2b`](https://github.com/nemolize/cc-grep/commit/5f8fd2bcb46a41c2f694e46db8163b2b1843b7ba) - Render tool calls for a reader rather than as raw arguments. The tool's name now
  tags the hit header instead of taking a body line, an `Edit` shows its two sides
  as a diff, and an argument that carries no meaning (`replace_all`) is left out
  when it leads the call and is not itself what matched. Matching and `--json` are
  unchanged: the shaping is display-only, so `old_string:` still finds an edit.

  Telling an argument from a line of file content that looks like one is a
  heuristic, since extraction keeps a value's newlines but not the record of where
  they were. It is deliberately conservative: a wrong guess never hides a line, and
  a line that matched always prints — it can only carry a `-`/`+` marker onto lines
  that are not part of that value.

- [#61](https://github.com/nemolize/cc-grep/pull/61) [`ef3f9ed`](https://github.com/nemolize/cc-grep/commit/ef3f9ed68f2cb473c8da75efc8f8f8ad6fd96606) - Add `--tool` and `--file` to find which session touched a given file.

  `--tool <name[,name...]>` restricts to turns that called one of the named tools
  (case-insensitive, repeatable); `--file <substring>` restricts to turns whose
  tool call targets a matching path. Both conditions hold on the same call, so a
  session that read the file and edited a different one does not match — and
  neither does a prose mention of the filename, which a plain substring search
  cannot separate from an actual `Edit` call. The match is on the call rather
  than its outcome, so an edit that failed still matches; the attempt is itself
  evidence that session was working on the file.

  Either flag stands in for the pattern, and a patternless run prints the header
  alone, naming the tool and the path it targeted. `--json` gains a `toolCalls`
  array on any hit that made one, and returns `matchedLines` empty on a
  patternless search for the same reason the header stands alone — every line
  "matched", so listing them says nothing. A `--session` dump is unaffected.

- [#60](https://github.com/nemolize/cc-grep/pull/60) [`83b4952`](https://github.com/nemolize/cc-grep/commit/83b495204f6b6d5e019bb2e120a9d0bf9e35796b) - Add survey flags so a broad pattern can be narrowed before printing it: `-c/--count` reports the hit total, `-l/--list-sessions` reports one line per matching session ordered most hits first, and `-m/--max-count <N>` stops the scan after N hits and notes on stderr that it capped. Both summaries pair with `--json`, and neither combines with `--resume`/`--print-resume` (a summary prints no hit to resume, so the combination is a usage error). `--help` now carries an Examples section and a note that a broad pattern can print megabytes.

### Patch Changes

- [#76](https://github.com/nemolize/cc-grep/pull/76) [`12b5274`](https://github.com/nemolize/cc-grep/commit/12b5274dadb45ba3e7afbd63513520dfa646988b) - Skip `JSON.parse` on transcript lines that cannot contain the pattern. A search previously parsed every line of the corpus regardless of the pattern, so a term with a handful of hits cost the same full-corpus parse as one matching everywhere. Each raw line is now tested for a literal the pattern requires before it is parsed, cutting a 528 MB search from 2.19 s to 1.42 s (1.5×); the remaining time is dominated by reading the lines, not by parsing them.

  Results are unchanged. The prefilter is a strict superset of the matcher, and it stops prefiltering whenever the literal cannot be scanned for reliably: no pattern (`--session` dumps), a regex with metacharacters, a run under three characters, or a literal that could sit inside a value `JSON.parse` canonicalises — `1e2` reaches the matcher as `100`, and `1e400` overflows to `Infinity` and arrives as `null`. Characters JSON must escape and separators the text extractor synthesises are excluded from the literal, and any line carrying a `\uXXXX` escape is parsed regardless, since JSON may encode even an ordinary character that way (an HTML-escaping serialiser writes `>` as `>`). A property test derives what the matcher would see from each raw line and asserts the prefilter accepts whenever the matcher matches, so a future extractor change that mints a new divergence fails with a repro rather than silently losing hits.

- [#67](https://github.com/nemolize/cc-grep/pull/67) [`49b89a4`](https://github.com/nemolize/cc-grep/commit/49b89a4a3d639aae04be6496ce4b1f915e2b1f01) - Stop counting a `tool_use` block nested inside a `tool_result` as a call the
  session made.

  A tool's output is data, not a record of what the session did, so anything that
  echoes transcript-shaped JSON back — a log dump, a pasted API response, this
  tool's own `--json` output — could put a `tool_use` block there and have the
  session read as having called it. `--tool` and `--file` now filter on the
  assistant's own calls only. Text inside a `tool_result` is still extracted and
  searchable, unchanged.

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
