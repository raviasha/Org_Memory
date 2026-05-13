import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/src/**/*.test.ts", "apps/**/src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["packages/**/src/**", "apps/**/src/**"],
      exclude: ["**/node_modules/**", "**/dist/**"],
    },
  },
  resolve: {
    alias: {
      "@org-memory/types": resolve(__dirname, "packages/types/src/index.ts"),
      "@org-memory/validators": resolve(
        __dirname,
        "packages/validators/src/index.ts"
      ),
    },
  },
});
