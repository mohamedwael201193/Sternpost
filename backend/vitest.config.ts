import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    // Each file boots an in-memory Postgres (PGlite); under parallel load the first test can exceed 5s.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: { LOG_LEVEL: "silent" },
    coverage: { provider: "v8", include: ["src/**"], exclude: ["src/index.ts", "src/db/cli.ts", "src/db/pool.ts", "src/runtime.ts", "src/serverless.ts"], reporter: ["text", "json-summary"] },
  },
});
