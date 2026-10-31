import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    // Explicit, not just relying on Vitest's own default excludes: running
    // `npm run build` (tsc) before `npm run test` emits compiled test files
    // into dist/test/**, which were observed to double-count the whole
    // suite (42 files / 294 tests instead of 21 / 149) during this
    // project's own build-verification pass. dist/ is gitignored and never
    // present in a fresh clone or CI, but a local `build` then `test` run
    // would otherwise silently double-run every test.
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Every test file shares one real Postgres container (no mocking DB
    // behavior — see docs/DECISIONS.md). Running files in parallel means
    // multiple Prisma connection pools (one per worker) hit it at once,
    // which showed up as an intermittent failure during Stage 2.4 — not a
    // product bug, but still worth eliminating for a consistently green
    // suite. Serializing file execution trades some wall-clock time for
    // determinism, which matters more for a graded submission.
    fileParallelism: false,
  },
});
