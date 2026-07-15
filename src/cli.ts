#!/usr/bin/env node
import { homedir } from "node:os";

import { HELP, parseArgs } from "./args.js";
import {
  formatHit,
  formatHitJson,
  resumeCommand,
  shouldColor,
} from "./format.js";
import { isReadableDir } from "./loader.js";
import { search } from "./search.js";
import type { Hit } from "./types.js";

const VERSION = "0.1.0";

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
      await writeStdout(VERSION + "\n");
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

  const color = shouldColor(opts.color, process.stdout.isTTY === true);

  let count = 0;
  let firstHit: Hit | undefined;
  const resumeLines: string[] = [];

  try {
    for await (const hit of search(opts)) {
      count++;
      if (!firstHit) firstHit = hit;

      if (opts.json) {
        await writeStdout(formatHitJson(hit, home) + "\n");
      } else {
        await writeStdout(formatHit(hit, opts, home, color) + "\n\n");
      }

      if (opts.printResume) {
        const cmd = resumeCommand(hit);
        if (cmd !== undefined) resumeLines.push(cmd);
      }
    }
  } catch (err) {
    // A matcher-build error (bad regex) surfaces on first use.
    process.stderr.write(
      `cc-grep: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
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

  // Exit 0 on ≥1 hit, 1 on none (grep convention).
  return count > 0 ? 0 : 1;
}

// Set exitCode and let Node drain stdout naturally rather than calling
// process.exit(code), which truncates any unflushed output when piped into
// a slow consumer.
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write(
      `cc-grep: unexpected error: ${err instanceof Error ? err.stack : String(err)}\n`,
    );
    process.exitCode = 2;
  });
