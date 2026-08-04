import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for the web-app.
 *
 * The only responsibility here is resolving the `@/*` path alias (mirrors the
 * `paths` entry in tsconfig.json) so that tests can import and mock modules the
 * same way the application code does — e.g. `vi.mock("@/hooks/useWallet")`.
 *
 * `globals` is intentionally left disabled: every test imports `describe` /
 * `it` / `expect` / `vi` explicitly. React-hook tests opt into the jsdom
 * environment per-file with a `// @vitest-environment jsdom` docblock, so the
 * default (node) stays fast for the pure-logic and adapter suites.
 *
 * `esbuild.jsx` overrides the `jsx: "preserve"` this project's shared
 * tsconfig sets for Next.js's own SWC-based build pipeline — Vitest's
 * esbuild transform needs an actual JSX transform (not "preserve") to parse
 * `.tsx` component tests, which this config previously had no need to run.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    // Core Stellar network vars are required by `src/lib/env.client.ts` at
    // import time; provide test defaults here so suites run without a local
    // `.env.local` (Next.js loads that file only for its own tooling).
    env: {
      NEXT_PUBLIC_STELLAR_NETWORK: "TESTNET",
      NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE:
        "Test SDF Network ; September 2015",
      NEXT_PUBLIC_STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
      NEXT_PUBLIC_STELLAR_HORIZON_URL: "https://horizon-testnet.stellar.org",
    },
  },
});
