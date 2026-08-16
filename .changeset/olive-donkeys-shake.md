---
"@nemolize/cc-grep": minor
---

Mark subagent hits and add a `--subagents <include|exclude|only>` scope filter.
A subagent turn carries its parent's session id and a bare `user` role, so it
was indistinguishable from something the human typed; hits now carry a `▸sub`
mark as a separate token, keeping the session id copyable. The default differs
per surface — a search includes subagent turns, a `--session` dump excludes
them — and `--json` names the relation via `isSubagent`, `agentId` and
`parentSessionId`. `--include-subagents` remains as a deprecated alias for
`--subagents=include`.
