import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    env: { LOG_LEVEL: "silent" },
    coverage: { provider: "v8", include: ["src/**"], exclude: ["src/index.ts", "src/db/cli.ts", "src/db/pool.ts"], reporter: ["text", "json-summary"] },
  },
});
