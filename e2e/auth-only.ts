/**
 * Run ONLY the e2e login bootstrap, without running any spec.
 *
 * The UX route budget sweep (BI-BD81682A) needs an authenticated session so it
 * measures real owner surfaces rather than freezing the login page as every route's
 * baseline. Playwright normally fires `globalSetup` as a side effect of running a
 * test, but the sweep is a standalone script, and running a whole spec just to get a
 * cookie is both slow and a flakiness source.
 *
 * Reuses e2e/global-setup.ts verbatim — there is one login path, not two.
 *
 *   pnpm exec tsx e2e/auth-only.ts
 */
import globalSetup from "./global-setup";
import type { FullConfig } from "@playwright/test";
import { sanitizeForLog } from "../scripts/lib/safe-log.mjs";

// An async IIFE, not top-level await: the repo root has no "type": "module", so tsx
// transforms this to CJS and esbuild rejects top-level await in that output format.
void (async () => {
  try {
    // globalSetup ignores its config argument; the cast keeps the shared signature.
    await globalSetup({} as FullConfig);
  } catch (err) {
    // CodeQL js/log-injection (#481): the bootstrap error can carry the
    // rejected login text. sanitizeForLog strips CR/LF before it is logged.
    console.error(
      "[auth-only] login bootstrap failed:",
      sanitizeForLog(err instanceof Error ? (err.stack ?? err.message) : String(err)),
    );
    process.exit(1);
  }
})();
