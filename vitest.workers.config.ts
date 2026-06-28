import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Runs the test/workers/ suite inside workerd (the real Cloudflare Workers
// runtime) via Miniflare, to prove quarto works with Web APIs only — no Node
// built-ins, no nodejs_compat flag.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./test/workers/wrangler.jsonc" } })],
  test: {
    include: ["test/workers/**/*.test.ts"],
  },
});
