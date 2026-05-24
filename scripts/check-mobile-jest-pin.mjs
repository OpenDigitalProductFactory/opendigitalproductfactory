#!/usr/bin/env node
/**
 * CI guard — apps/mobile must stay on jest ^29.x.
 *
 * Background
 * ----------
 * PR #1053 ("fix(mobile): downgrade jest 30 → 29 — restores mobile test suite")
 * walked back a Dependabot-driven bump to jest 30 that broke every mobile
 * test simultaneously and blocked every open PR for hours. jest 30 changes
 * defaults that jest-expo 56.x is not yet compatible with.
 *
 * This script asserts the pin holds. It runs in CI as a binding gate so a
 * future Dependabot PR cannot silently re-introduce the same break.
 *
 * When this script fails
 * ----------------------
 *   1. Confirm the pin is intentional (it is, as of this writing).
 *   2. Close the offending dependency bump PR with a comment pointing at
 *      PR #1053 and this script.
 *   3. If jest 30 is now safe (jest-expo compatibility landed, etc.),
 *      remove or relax this guard in the same PR that does the bump.
 *      Don't bypass — fix the guard.
 *
 * Exit codes
 * ----------
 *   0  Pin OK.
 *   1  Pin violated (jest devDep missing or not satisfying ^29).
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const MOBILE_PKG = resolve("apps/mobile/package.json");
const REQUIRED_MAJOR = 29;

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
  console.error("Expected a string satisfying ^29 (e.g. '~29.7.0' or '^29.7.0').");
  process.exit(1);
}

// Extract the major version from the leading numeric segment after stripping
// range operator characters (^ ~ >= = etc.).
const match = declared.match(/^[~^>=<\s]*(\d+)\./);
if (!match) {
  console.error(`ERROR: Could not parse major version from jest devDep "${declared}".`);
  console.error("Expected a semver range like '^29.7.0' or '~29.7.0'.");
  process.exit(1);
}

const major = Number(match[1]);
if (major !== REQUIRED_MAJOR) {
  console.error(`ERROR: apps/mobile jest is pinned to "${declared}" (major ${major}).`);
  console.error(`The mobile suite requires jest ^${REQUIRED_MAJOR}.x — see PR #1053.`);
  console.error("");
  console.error("If this bump is intentional and jest-expo compatibility has");
  console.error("landed, remove this guard in scripts/check-mobile-jest-pin.mjs");
  console.error("in the same PR that bumps the version, and document the");
  console.error("compatibility evidence in docs/testing/pre-pr-gate.md.");
  process.exit(1);
}

console.log(`✓ apps/mobile jest pin OK ("${declared}" — major ${major}).`);
