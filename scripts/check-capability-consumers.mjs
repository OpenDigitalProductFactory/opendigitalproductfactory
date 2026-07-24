#!/usr/bin/env node
// scripts/check-capability-consumers.mjs
//
// BI-5CD43089 — the declared-but-inert capability guard.
//
// THE PROBLEM IT FIXES: the archetype capability registry
// (packages/storefront-templates/src/capability-registry.ts) derives applicability
// for 30 capability keys, but a static sweep (2026-07-23) found 6 of them gate
// NOTHING anywhere — no nav `orgCapabilityKey`, no `hasActiveOrgCapability` guard,
// no coworker binding. Two of those six even declare a `setupPrompt`, so the setup
// wizard asks the operator a question whose answer changes nothing (a user-visible
// honesty defect). Nothing caught this at build time, so every new capability added
// without a gate silently joined the inert set. At 22 archetypes the cost of an
// ungated capability is surface added to all 22.
//
// THE FIX (same shape as the #3476 quality-issue-registry compile-error and the
// Archetype Completeness Guard ratchet): every key in CAPABILITY_REGISTRY must have
// >=1 recognised consumer, or be listed in the shrink-only baseline of known-inert
// keys. A NEW capability must meet the floor (>=1 consumer) and is never parked in
// the baseline. A capability that declares a `setupPrompt` gets a louder check — a
// setup question with no enforcement is exactly the honesty defect — but pre-existing
// unwired prompts are tracked in the baseline as debt that may only shrink.
//
// Recognised consumers (the archetype-capability gate mechanisms; scanned across
// the gate-bearing dirs — app routes, nav model, customer-estate policy,
// coworker-lifecycle — tests excluded):
//   - nav `orgCapabilityKey: "KEY"` or `orgCapabilityKey: [..., "KEY", ...]`
//   - a `hasActiveOrgCapability("KEY")` route/API guard
//   - a `getActiveOrgCapabilities()` result `.has("KEY")` check
//   - a `getCapabilityActivation(profile, "KEY")` customer-estate scope/topology gate
//   - a coworker archetype-gating binding under apps/web/lib/coworker-lifecycle
//     (BI-14FC40CC consumer type)
// "Inert" therefore means "not gated by any of THESE mechanisms" — a key gated by
// a mechanism outside this set (e.g. a finance-templates flag) will read as inert
// until wired to a recognised gate. The baseline is shrink-only, so an
// over-inclusive entry is safe: it can only be removed, never silently mask a
// NEW ungated capability.
//
// Spec: docs/superpowers/specs/2026-07-24-capability-enforcement-completion-design.md §5.6
//
// Usage:
//   node scripts/check-capability-consumers.mjs           # check (CI)
//   node scripts/check-capability-consumers.mjs --update   # rewrite the baseline

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY_PATH = path.join(
  REPO_ROOT,
  "packages/storefront-templates/src/capability-registry.ts",
);
// Recognised consumers live in a bounded set of directories by contract (spec
// §5.6): route/page/API guards under app/, the nav model, and coworker bindings.
// Scoping the scan here keeps the guard fast (~800 files, not all ~5.8k of
// apps/web) and matches the contract — a guard placed elsewhere is not a
// recognised consumer pattern anyway.
const SCAN_DIRS = [
  path.join(REPO_ROOT, "apps/web/app"),
  path.join(REPO_ROOT, "apps/web/lib/navigation"),
  path.join(REPO_ROOT, "apps/web/lib/coworker-lifecycle"),
  path.join(REPO_ROOT, "apps/web/lib/customer-estate"),
];

// Directories whose whole purpose is capability gating (coworker archetype
// binding; customer-estate scope/topology policy via getCapabilityActivation).
// A capability-key literal appearing anywhere in these files is a gate
// reference — including keys passed indirectly through a wrapper like
// isRequiredStrictCapability(profile, "network-inventory"), which a
// call-shape regex would miss. Scoped to these dirs so a stray key string in an
// unrelated file is never counted.
const GATING_DIRS = ["/lib/coworker-lifecycle/", "/lib/customer-estate/"];
const BASELINE_PATH = path.join(REPO_ROOT, "scripts/capability-consumer-baseline.txt");

/** Parse CAPABILITY_REGISTRY: return [{ key, hasSetupPrompt }] in source order. */
function parseRegistry(source) {
  const lines = source.split("\n");
  const entries = [];
  let current = null; // { key, buf }
  for (const line of lines) {
    // A top-level capability key is quoted at exactly 2-space indent then `: {`.
    const keyMatch = line.match(/^ {2}"([a-z0-9-]+)":\s*\{/);
    if (keyMatch) {
      if (current) entries.push(finishEntry(current));
      current = { key: keyMatch[1], buf: [] };
      continue;
    }
    // A line at exactly 2-space indent closing the object (`} as const ...`) ends the block.
    if (current && /^ {2}\}/.test(line)) {
      entries.push(finishEntry(current));
      current = null;
      continue;
    }
    if (current) current.buf.push(line);
  }
  if (current) entries.push(finishEntry(current));
  return entries;
}

function finishEntry(current) {
  return {
    key: current.key,
    hasSetupPrompt: current.buf.some((l) => /\bsetupPrompt:/.test(l)),
  };
}

/** Recursively collect .ts/.tsx files under dir, excluding node_modules + tests. */
function walkSource(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    if (entry.isSymbolicLink()) continue; // defensive: never follow symlinked trees
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkSource(full));
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !/\.(test|spec|stories)\.(ts|tsx)$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

// Cheap substring markers — a file with none of these cannot contain a consumer,
// so we skip the regex work entirely (most of apps/web's ~5.8k files).
const CONSUMER_MARKERS = [
  "orgCapabilityKey",
  "hasActiveOrgCapability",
  "getActiveOrgCapabilities",
  "capabilityKey",
];

// Precompiled global capture regexes — run ONCE per candidate file, key-agnostic,
// then the captured literal is intersected with the known registry keys. This is
// O(files) rather than O(files × keys × patterns).
const CAP_SINGLE_RE = [
  /orgCapabilityKey:\s*"([a-z0-9-]+)"/g,
  /hasActiveOrgCapability\(\s*"([a-z0-9-]+)"/g,
  /\.has\(\s*"([a-z0-9-]+)"\s*\)/g,
];
// Array form: orgCapabilityKey: ["a", "b"] — capture the whole bracket, then keys.
const CAP_ARRAY_RE = /orgCapabilityKey:\s*\[([^\]]*)\]/g;
// Any quoted lowercase-kebab literal — used only inside GATING_DIRS files, where
// every capability-key literal is a gate reference (see GATING_DIRS comment).
const QUOTED_RE = /"([a-z0-9-]+)"/g;

/** Set of capability keys that have at least one recognised consumer. */
function collectConsumedKeys(knownKeys) {
  const known = new Set(knownKeys);
  const consumed = new Set();
  const add = (k) => {
    if (known.has(k)) consumed.add(k);
  };
  const files = SCAN_DIRS.flatMap((d) => walkSource(d));
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    if (!CONSUMER_MARKERS.some((m) => src.includes(m))) continue;
    for (const re of CAP_SINGLE_RE) {
      for (const m of src.matchAll(re)) add(m[1]);
    }
    for (const m of src.matchAll(CAP_ARRAY_RE)) {
      for (const q of m[1].matchAll(QUOTED_RE)) add(q[1]);
    }
    const posix = file.replace(/\\/g, "/");
    if (GATING_DIRS.some((d) => posix.includes(d))) {
      for (const q of src.matchAll(QUOTED_RE)) add(q[1]);
    }
  }
  return consumed;
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return [];
  return fs
    .readFileSync(BASELINE_PATH, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

const BASELINE_HEADER = `# Capability consumer baseline — capability-registry keys with NO consumer
# recognised by this guard (no nav orgCapabilityKey, no hasActiveOrgCapability
# guard, no customer-estate getCapabilityActivation gate, no coworker binding).
# See the recognised-consumer list in check-capability-consumers.mjs. This list
# may only SHRINK.
#
# A NEW capability must meet the floor (>=1 recognised consumer) and is never
# added here. Keys marked (setupPrompt) ALSO declare a setup-wizard question that
# is not yet wired — the honesty defect BI-5CD43089 tracks: the wizard asks the
# operator something whose answer changes nothing. They stay here as shrink-only
# debt until a surface is built to enforce them; do not add a new
# setupPrompt-without-consumer.
#
# Regenerate with: node scripts/check-capability-consumers.mjs --update
`;

/** Compute the current inert set (keys with no consumer). */
function computeInert() {
  const registry = parseRegistry(fs.readFileSync(REGISTRY_PATH, "utf8"));
  const keys = registry.map((e) => e.key);
  const setupPromptKeys = new Set(registry.filter((e) => e.hasSetupPrompt).map((e) => e.key));
  const consumed = collectConsumedKeys(keys);
  const inert = keys.filter((k) => !consumed.has(k));
  return { registry, keys, setupPromptKeys, consumed, inert };
}

function update() {
  const { inert, setupPromptKeys } = computeInert();
  const body = inert
    .slice()
    .sort()
    .map((k) => (setupPromptKeys.has(k) ? `${k}  # (setupPrompt)` : k))
    .join("\n");
  fs.writeFileSync(BASELINE_PATH, `${BASELINE_HEADER}${body}${body ? "\n" : ""}`, "utf8");
  console.log(`Wrote capability consumer baseline (${inert.length} inert key(s)).`);
}

/**
 * Pure ratchet evaluation — injected inputs, no fs. Mirrors the archetype
 * completeness gate's testable shape.
 *
 * @param {object} input
 * @param {string[]} input.keys              all registry capability keys
 * @param {Set<string>} input.setupPromptKeys keys that declare a setupPrompt
 * @param {Set<string>} input.consumed        keys with a recognised consumer
 * @param {string[]} input.baseline           baselined (known-inert) keys
 * @returns {{ ok: boolean, errors: string[], inert: string[], staleBaseline: string[], promptDebt: string[] }}
 */
function evaluateCapabilityConsumers({ keys, setupPromptKeys, consumed, baseline }) {
  const baselineSet = new Set(baseline);
  const inert = keys.filter((k) => !consumed.has(k));
  const errors = [];
  const staleBaseline = [];

  // 1) Every inert key must be in the baseline (no NEW inert capability).
  for (const key of inert) {
    if (!baselineSet.has(key)) {
      const extra = setupPromptKeys.has(key)
        ? " — AND it declares a setupPrompt, so the setup wizard asks a question that changes nothing"
        : "";
      errors.push(
        `capability "${key}" derives applicability but has no recognised consumer${extra}. ` +
          `Wire it to a gate (nav orgCapabilityKey, hasActiveOrgCapability guard, customer-estate ` +
          `activation policy, or coworker binding) — do NOT add it to the baseline (baseline is for pre-existing debt only).`,
      );
    }
  }

  // 2) Baseline may only SHRINK: a baselined key that now has a consumer, or is no
  //    longer a registry key, is stale and must be removed.
  for (const key of baseline) {
    if (!keys.includes(key)) {
      errors.push(`baseline lists "${key}" which is not a capability key — remove it (run --update).`);
    } else if (consumed.has(key)) {
      staleBaseline.push(key);
      errors.push(
        `baseline lists "${key}" but it now HAS a consumer — remove it from the baseline (run --update). The ratchet only tightens.`,
      );
    }
  }

  const promptDebt = inert.filter((k) => setupPromptKeys.has(k));
  return { ok: errors.length === 0, errors, inert, staleBaseline, promptDebt };
}

function check() {
  const { keys, setupPromptKeys, consumed } = computeInert();
  const baseline = readBaseline().map((l) => l.split("#")[0].trim()).filter(Boolean);
  const { ok, errors, inert, promptDebt } = evaluateCapabilityConsumers({
    keys,
    setupPromptKeys,
    consumed,
    baseline,
  });

  if (!ok) {
    console.error("Capability consumer guard FAILED:\n");
    for (const e of errors) console.error(`  - ${e}`);
    console.error(
      `\nSpec: docs/superpowers/specs/2026-07-24-capability-enforcement-completion-design.md §5.6`,
    );
    process.exit(1);
  }

  console.log(
    `Capability consumer guard OK — ${keys.length} keys, ${consumed.size} consumed, ` +
      `${inert.length} in shrink-only baseline` +
      (promptDebt.length ? ` (${promptDebt.length} with unwired setupPrompt: ${promptDebt.join(", ")})` : "") +
      `.`,
  );
}

const isUpdate = process.argv.includes("--update");
const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("check-capability-consumers.mjs");
if (isMain) {
  if (isUpdate) update();
  else check();
}

export { parseRegistry, collectConsumedKeys, computeInert, evaluateCapabilityConsumers };
