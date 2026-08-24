---
"@nemolize/cc-grep": patch
---

Skip `JSON.parse` on transcript lines that cannot contain the pattern. A search previously parsed every line of the corpus regardless of the pattern, so a term with a handful of hits cost the same full-corpus parse as one matching everywhere. Each raw line is now tested for a literal the pattern requires before it is parsed, cutting a 528 MB search from 2.19 s to 1.28 s (1.7×); the remaining time is dominated by line reading, not parsing.

The prefilter is a strict superset of the matcher, so results are unchanged: it falls back to parsing everything whenever no literal is provably required — no pattern (`--session` dumps), a regex with metacharacters, or a pattern whose only usable run is too short. Characters JSON may escape (`"`, `\`, `/`, non-ASCII) and separators the text extractor synthesises (`:`, `,`, `[]`, `{}`, space) are excluded from the literal, since those differ between the raw line and the text the matcher sees.
