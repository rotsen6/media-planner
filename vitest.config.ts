import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Nested worktrees under .claude/ hold copies of these tests.
  test: { exclude: [...configDefaults.exclude, ".claude/**"] },
});
