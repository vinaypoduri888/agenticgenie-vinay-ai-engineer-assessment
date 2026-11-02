import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // No real database dependency (the agent package never talks to
    // Postgres/Redis directly — see docs/DECISIONS.md), so unlike
    // apps/api's vitest config, file-level parallelism is safe to leave at
    // its default.
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
