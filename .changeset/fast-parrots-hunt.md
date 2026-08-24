---
"@nemolize/cc-grep": patch
---

Skip `JSON.parse` on transcript lines that cannot contain the pattern. A search previously parsed every line of the corpus regardless of the pattern, so a term with a handful of hits cost the same full-corpus parse as one matching everywhere. Each raw line is now tested for a literal the pattern requires before it is parsed, cutting a 528 MB search from 2.20 s to 1.43 s (1.5×); the remaining time is dominated by line reading, not parsing.

The prefilter is a strict superset of the matcher, so results are unchanged: it falls back to parsing everything whenever the literal cannot be scanned for reliably — no pattern (`--session` dumps), a regex with metacharacters, a pattern whose only usable run is too short, or a purely numeric one, since `JSON.parse` canonicalises numbers and `1e2` reaches the matcher as `100`. Characters JSON must escape (`"`, `\`, non-ASCII) and separators the text extractor synthesises (`:`, `,`, `[]`, `{}`, space) are excluded from the literal, and any line carrying a `\uXXXX` escape is parsed regardless, since JSON may encode even an ordinary character that way (an HTML-escaping serialiser writes `>` as `>`).
