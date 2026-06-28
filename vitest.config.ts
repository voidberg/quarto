import { configDefaults, defineConfig } from "vitest/config";

// Default (Node) test suite. The Workers-runtime suite lives in test/workers/
// and runs under its own config (vitest.workers.config.ts), so exclude it here.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "test/workers/**"],
  },
});
