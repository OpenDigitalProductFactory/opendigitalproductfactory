#!/usr/bin/env node
/**
 * CI guard — apps/mobile must run a UNIFIED jest ^30.x install.
 *
 * Background
 * ----------
 * PR #1053 and PR #1288 (both reverted) bumped only apps/mobile's direct jest
 * dep to 30 while jest-expo@~56 (Expo SDK 55/56) kept pulling jest 29 transitive
 * deps. That produced a MIXED 29/30 install (jest-runtime@30 + jest-mock@29) and
 * broke every mobile suite at load with "clearMocksOnScope is not a function".
 *
 * The supported fix is the inverse of the old pin: force the WHOLE jest family
 * to 30 via the `overrides` block in pnpm-workspace.yaml so there is exactly one
 * jest version. (pnpm 10 reads overrides from pnpm-workspace.yaml, not the
 * package.json "pnpm" field.) jest-expo's code already tolerates jest 30 even
 * though its declared ranges still say ^29, so a single unified jest 30 tree works.
 *
 * This script now asserts apps/mobile is on jest ^30, not ^29. It runs in CI as
 * a binding gate so a future Dependabot PR cannot silently regress the pin (in
 * either direction) and re-introduce the mixed-tree break.
 *
 * When this script fails
 * ----------------------
 *   1. If jest was bumped to a NEW major, confirm jest-expo tolerates it and the
 *      mobile suite still loads, then update REQUIRED_MAJOR here in the same PR.
 *   2. If jest regressed to 29, restore the jest 30 pin and the
 *      pnpm-workspace.yaml overrides block — do not bypass this guard.
 *
 * Exit codes
 * ----------
 *   0  Pin OK.
 *   1  Pin violated (jest devDep missing or not satisfying ^30).
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const MOBILE_PKG = resolve("apps/mobile/package.json");
const REQUIRED_MAJOR = 30;

let pkg;
try {
  pkg = JSON.parse(await readFile(MOBILE_PKG, "utf8"));
} catch (err) {
  console.error(`ERROR: Could not read ${MOBILE_PKG}: ${err.message}`);
  process.exit(1);
}

const declared = pkg.devDependencies?.jest;
if (typeof declared !== "string") {
  console.error("ERROR: apps/mobile devDependencies.jest is missing.");
  console.error("Expected a string satisfying ^30 (e.g. '~30.4.2' or '^30.0.0').");
  process.exit(1);
}

// Extract the major version from the leading numeric segment after stripping
// range operator characters (^ ~ >= = etc.).
const match = declared.match(/^[~^>=<\s]*(\d+)\./);
if (!match) {
  console.error(`ERROR: Could not parse major version from jest devDep "${declared}".`);
  console.error("Expected a semver range like '^30.0.0' or '~30.4.2'.");
  process.exit(1);
}

const major = Number(match[1]);
if (major !== REQUIRED_MAJOR) {
  console.error(`ERROR: apps/mobile jest is pinned to "${declared}" (major ${major}).`);
  console.error(`The mobile suite requires a unified jest ^${REQUIRED_MAJOR}.x install`);
  console.error("(enforced via the overrides block in pnpm-workspace.yaml).");
  console.error("");
  console.error("If this is an intentional new-major bump, confirm jest-expo");
  console.error("tolerates it and the mobile suite still loads, then update");
  console.error("REQUIRED_MAJOR in scripts/check-mobile-jest-pin.mjs and the");
  console.error("pnpm-workspace.yaml overrides in the SAME PR. Don't bypass — fix the guard.");
  process.exit(1);
}

console.log(`✓ apps/mobile jest pin OK ("${declared}" — major ${major}).`);
