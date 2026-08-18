---
"@nemolize/cc-grep": minor
---

Add `--tool` and `--file` to find which session touched a given file.

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
