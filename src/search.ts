import { passesFilters } from "./filters.js";
import { findTranscripts, loadTurns } from "./loader.js";
import { buildMatcher } from "./matcher.js";
import type { Hit, Options } from "./types.js";

/**
 * Stream hits across every transcript under `opts.root`. For each turn that
 * passes the metadata filters, the matcher is run per text line; a turn with
 * ≥1 matching line yields one `Hit` carrying the matched line indices. Files
 * are processed sequentially and lazily so a large corpus streams rather than
 * loading wholesale.
 */
export async function* search(opts: Options): AsyncGenerator<Hit> {
  const matcher = buildMatcher(opts);

  for await (const file of findTranscripts(opts.root)) {
    for await (const turn of loadTurns(file)) {
      if (!passesFilters(turn, opts)) continue;

      const matchedLineIndices: number[] = [];
      for (const [i, line] of turn.textLines.entries()) {
        if (matcher.test(line)) matchedLineIndices.push(i);
      }
      if (matchedLineIndices.length > 0) {
        yield { turn, matchedLineIndices };
      }
    }
  }
}
