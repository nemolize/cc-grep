import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      // json + json-summary feed the coverage report action in CI.
      reporter: ["text", "html", "json", "json-summary"],
      reportOnFailure: true,
      include: ["src/**/*.ts"],
      // cli.ts runs as a spawned binary in test/cli.test.js, so v8 attributes
      // none of it to this process.
      exclude: ["src/cli.ts", "src/types.ts"],
      // autoUpdate raises these as coverage improves but never lowers them, so
      // the numbers act as a ratchet rather than a target to drift down to.
      thresholds: {
        autoUpdate: true,
        statements: 94.35,
        branches: 90.65,
        functions: 100,
        lines: 96.21,
      },
    },
  },
});
