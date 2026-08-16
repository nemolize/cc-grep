#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { HELP, parseArgs } from "./args.js";
import {
  formatDumpBanner,
  formatDumpTurn,
  formatHit,
  formatHitJson,
  resumeCommand,
  shouldColor,
} from "./format.js";
import { isRecord } from "./guards.js";
import { isReadableDir } from "./loader.js";
import { search } from "./search.js";
import type { Hit } from "./types.js";

/** Read at runtime rather than hardcoded: a literal drifts from package.json on release. */
function readVersion(): string {
  const pkgPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "package.json",
  );
  const pkg: unknown = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (isRecord(pkg) && typeof pkg["version"] === "string")
    return pkg["version"];
  throw new Error(`no version field in ${pkgPath}`);
}

/**
 * Exit quietly when a downstream consumer closes the pipe (`cc-grep foo | head`,
 * `| less` then `q`). Without this, the next `stdout.write` emits an unhandled
 * EPIPE `error` event and Node crashes with a stack trace.
 */
function installEpipeGuard(): void {
  process.stdout.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") process.exit(0);
    throw err;
  });
}

/**
 * Write to stdout, awaiting `drain` when the internal buffer is full. Without
 * this, a fast producer piped into a slow consumer buffers unbounded output
 * in memory.
 */
async function writeStdout(chunk: string): Promise<void> {
  if (!process.stdout.write(chunk)) {
    await new Promise<void>((resolve) => process.stdout.once("drain", resolve));
  }
}

async function main(): Promise<number> {
  installEpipeGuard();
  const home = homedir();
  const parsed = parseArgs(process.argv.slice(2), process.env, home);

  switch (parsed.kind) {
    case "help":
      await writeStdout(HELP);
      return 0;
    case "version":
      await writeStdout(readVersion() + "\n");
      return 0;
    case "error":
      process.stderr.write(`cc-grep: ${parsed.message}\n\n${HELP}`);
      return 2;
  }

  const opts = parsed.options;

  if (!(await isReadableDir(opts.root))) {
    process.stderr.write(
      `cc-grep: no transcripts found — "${opts.root}" is not a readable directory\n` +
        `Set --root or CC_GREP_ROOT if your transcripts live elsewhere.\n`,
    );
    return 1;
  }

  // Typed `boolean`, but Node leaves it `undefined` when stdout is not a TTY.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-boolean-literal-compare
  const color = shouldColor(opts.color, process.stdout.isTTY === true);

  let count = 0;
  let firstHit: Hit | undefined;
  const resumeLines: string[] = [];
  const dumping = opts.session !== undefined;
  const dumpedSessions = new Set<string>();

  try {
    for await (const hit of search(opts)) {
      count++;
      firstHit ??= hit;

      // Tracked for every output format: the ambiguity warning is as useful to
      // a `--json` consumer, which would otherwise silently mix two sessions.
      const newSession =
        dumping && !dumpedSessions.has(hit.turn.sessionId ?? "?");
      if (newSession) dumpedSessions.add(hit.turn.sessionId ?? "?");

      if (opts.json) {
        await writeStdout(formatHitJson(hit, home) + "\n");
      } else if (dumping) {
        if (newSession) {
          const banner = formatDumpBanner(hit.turn, home, color);
          await writeStdout(
            (dumpedSessions.size > 1 ? "\n" : "") + banner + "\n\n",
          );
        }
        await writeStdout(formatDumpTurn(hit, opts, color) + "\n\n");
      } else {
        await writeStdout(formatHit(hit, opts, home, color) + "\n\n");
      }

      if (opts.printResume) {
        const cmd = resumeCommand(hit);
        // Every turn of a dump carries the same id, so print it once per session.
        if (cmd !== undefined && !(dumping && !newSession)) {
          resumeLines.push(cmd);
        }
      }
    }
  } catch (err) {
    // A matcher-build error (bad regex) surfaces on first use.
    process.stderr.write(
      `cc-grep: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }

  if (dumping && dumpedSessions.size > 1) {
    process.stderr.write(
      `cc-grep: "${opts.session ?? ""}" matched ${String(dumpedSessions.size)} sessions — ` +
        `pass a longer prefix to dump just one\n`,
    );
  }
  // A pattern or a filter empties a session that exists, so this reports the
  // turns rather than diagnosing the id the user would otherwise re-check.
  if (dumping && count === 0) {
    const narrowed =
      opts.pattern !== undefined ||
      opts.role !== "any" ||
      opts.sinceMs !== undefined ||
      opts.untilMs !== undefined ||
      opts.cwd !== undefined ||
      opts.branch !== undefined ||
      opts.subagents !== undefined;
    process.stderr.write(
      `cc-grep: no turns for session "${opts.session ?? ""}" — ` +
        (narrowed
          ? "check the id, or loosen the pattern/filters\n"
          : "check the id, or try --subagents=include\n"),
    );
  }

  if (!opts.json) {
    if (opts.resume && firstHit !== undefined) {
      const cmd = resumeCommand(firstHit);
      if (cmd !== undefined) await writeStdout(`\n${cmd}\n`);
    }
    if (opts.printResume && resumeLines.length > 0) {
      await writeStdout("\n" + resumeLines.join("\n") + "\n");
    }
  }

  return count > 0 ? 0 : 1;
}

// Set exitCode and let Node drain stdout naturally rather than calling
// process.exit(code), which truncates any unflushed output when piped into
// a slow consumer.
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stderr.write(
      `cc-grep: unexpected error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    process.exitCode = 2;
  });
