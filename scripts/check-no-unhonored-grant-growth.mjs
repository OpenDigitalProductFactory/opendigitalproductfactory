#!/usr/bin/env node
// Unhonored-grant-count ratchet — BI-6FD78522 (M6, late-defect-detection
// hardening plan docs/superpowers/plans/2026-08-16-late-defect-detection-hardening-plan.md).
//
// THE PROBLEM: agent_registry.json references grant keys that no tool
// implementation honors. TOOL_TO_GRANTS (apps/web/lib/tak/agent-grants.ts and
// its composed domain maps) denies unlisted tools by default, so a registry
// grant key that never appears in any tool's required-grant list is
// aspirational scope a coworker carries on paper but cannot exercise —
// coworkers fail at call time with a default-deny log line (BI-F998BCE8,
// BI-88B77204). apps/web/scripts/audit-coworker-tool-grants.ts surfaces this
// drift as a REPORT; this guard turns the COUNT into a shrink-only gate.
//
// HOW "honored" IS COMPUTED (same sources as the audit script):
//   - Every grant key appearing in a tool's required-grant value list across
//     the composed TOOL_TO_GRANTS sources (agent-grants.ts,
//     product-management-tool-grants.ts, initiative-readiness-tool-grants.ts)
//     is honored — some tool checks it.
//   - A GRANT_IMPLICATIONS coarse key whose implied set reaches an honored key
//     is honored too: an agent holding the coarse key can exercise the tools
//     that require the implied finer key (expandGrants in agent-grants.ts).
//
// unhonored = (union of all registry agents' tool_grants) − honored.
//
// RATCHET RULES (baseline idiom follows scripts/check-module-size.mjs):
//   - Baseline scripts/unhonored-grant-baseline.txt pins the count (first
//     content line) and lists the known-unhonored keys (one per line).
//   - The count may only SHRINK: current > pinned fails.
//   - ANY unhonored key not in the baseline list fails, even at equal count —
//     a swap (one key fixed, a new one introduced) is still growth.
//   - Shrinking is fine; re-run with --update to lock in the smaller set.
//
//   node scripts/check-no-unhonored-grant-growth.mjs            # check (guard loop)
//   node scripts/check-no-unhonored-grant-growth.mjs --update   # re-baseline (shrink only)

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { formatTxtBudgetHeader, parseTxtBudgetHeader } from "./lib/baseline-budget.mjs";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPTS_DIR, "..");
const BASELINE_PATH = join(REPO_ROOT, "scripts", "unhonored-grant-baseline.txt");

// The composed TOOL_TO_GRANTS sources. Must stay in step with the audit
// script's loadToolToGrants (apps/web/scripts/audit-coworker-tool-grants.ts):
// TOOL_TO_GRANTS deliberately composes bounded domain maps, and parsing only
// the root object would silently treat every spread entry as unhonored.
export const TOOL_TO_GRANTS_SOURCES = Object.freeze([
  {
    path: "apps/web/lib/tak/agent-grants.ts",
    pattern: /TOOL_TO_GRANTS:[^=]*= \{([\s\S]*?)\n\};/,
  },
  {
    path: "apps/web/lib/tak/product-management-tool-grants.ts",
    pattern: /PRODUCT_MANAGEMENT_TOOL_GRANTS[^=]*= \{([\s\S]*?)\n\}/,
  },
  {
    path: "apps/web/lib/tak/initiative-readiness-tool-grants.ts",
    pattern: /INITIATIVE_READINESS_TOOL_GRANTS[^=]*= \{([\s\S]*?)\n\}/,
  },
  {
    // Banking books-loop domain map (S-FIN, BI-DE27D34E), spread into
    // TOOL_TO_GRANTS. Registering it here so banking_read/banking_write read as
    // honored — the Bookkeeper coworker (S-BK) holds them.
    path: "apps/web/lib/tak/banking-tool-grants.ts",
    pattern: /BANKING_TOOL_GRANTS[^=]*= \{([\s\S]*?)\n\}/,
  },
]);

const BUDGET = Object.freeze({ owner: "platform-architecture", expiry: "2026-11-16" });
const NOTE_LINES = Object.freeze([
  "Unhonored-grant ratchet baseline (BI-6FD78522). Registry grant keys no tool",
  "implementation honors — aspirational scope a coworker cannot exercise.",
  "Shrink-only: keys leave by being honored (a tool requires them) or removed",
  "from agent_registry.json, never by expanding this baseline.",
  "First content line = pinned count; remaining lines = the known keys.",
  "Regenerate (after a genuine shrink): node scripts/check-no-unhonored-grant-growth.mjs --update",
]);

/** Parse the grant-key values out of a `tool: [grant, ...]` map source block. */
export function parseGrantValues(source, pattern) {
  const out = new Set();
  const block = source.match(pattern);
  if (!block) return out;
  for (const line of block[1].split("\n")) {
    const m = line.match(/^\s*(?:"([^"]+)"|'([^']+)'|([a-zA-Z0-9_-]+)):\s*\[([^\]]*)\]/);
    if (!m) continue;
    for (const g of m[4].split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""))) {
      if (g) out.add(g);
    }
  }
  return out;
}

/** Parse GRANT_IMPLICATIONS coarse->implied[] pairs from agent-grants.ts. */
export function parseGrantImplications(source) {
  const out = {};
  const block = source.match(/GRANT_IMPLICATIONS[^=]*= \{([\s\S]*?)\n\};/);
  if (!block) return out;
  for (const line of block[1].split("\n")) {
    const m = line.match(/^\s*(?:"([^"]+)"|'([^']+)'|([a-zA-Z0-9_]+)):\s*\[([^\]]*)\]/);
    if (!m) continue;
    const key = m[1] ?? m[2] ?? m[3];
    out[key] = m[4]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return out;
}

/**
 * Pure core: compute the sorted unhonored registry grant keys.
 * honoredValues = grant keys some tool requires; implications = coarse->implied.
 */
export function computeUnhonored({ registryKeys, honoredValues, implications }) {
  const honored = new Set(honoredValues);
  // Fixed-point over implications: a coarse key reaching an honored key is honored.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [coarse, implied] of Object.entries(implications)) {
      if (!honored.has(coarse) && implied.some((g) => honored.has(g))) {
        honored.add(coarse);
        changed = true;
      }
    }
  }
  return [...registryKeys].filter((k) => !honored.has(k)).sort();
}

/** Parse the baseline: first content line = count, remaining lines = keys. */
export function parseBaseline(text) {
  let count = null;
  const keys = new Set();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (count === null) {
      if (!/^\d+$/.test(line)) return null; // malformed
      count = Number(line);
      continue;
    }
    keys.add(line);
  }
  if (count === null) return null;
  return { count, keys };
}

/**
 * Pure ratchet core. Returns { failures: string[], shrunk: boolean }.
 * Growth in count OR any key absent from the baseline list fails.
 */
export function evaluateRatchet({ current, baseline }) {
  const failures = [];
  if (baseline === null) {
    failures.push("baseline scripts/unhonored-grant-baseline.txt is missing or malformed — regenerate with --update on a clean tree.");
    return { failures, shrunk: false };
  }
  const newKeys = current.filter((k) => !baseline.keys.has(k));
  if (current.length > baseline.count) {
    failures.push(
      `unhonored grant-key count grew: ${current.length} > pinned ${baseline.count}. ` +
        `The count may only shrink — either honor the key in a TOOL_TO_GRANTS entry or remove it from agent_registry.json.`,
    );
  }
  if (newKeys.length > 0) {
    failures.push(
      `NEW unhonored grant key(s) not in the baseline: ${newKeys.join(", ")}. ` +
        `A registry grant no tool honors is scope a coworker carries on paper but cannot exercise (deny-by-default). ` +
        `Add a TOOL_TO_GRANTS entry that requires the key, or drop the grant from agent_registry.json.`,
    );
  }
  return { failures, shrunk: failures.length === 0 && current.length < baseline.count };
}

export function computeCurrentUnhonored(root = REPO_ROOT) {
  const registry = JSON.parse(readFileSync(join(root, "packages/db/data/agent_registry.json"), "utf8"));
  const registryKeys = new Set();
  for (const a of registry.agents) {
    for (const g of a.config_profile?.tool_grants ?? []) registryKeys.add(g);
  }
  const honoredValues = new Set();
  let implications = {};
  for (const src of TOOL_TO_GRANTS_SOURCES) {
    const text = readFileSync(join(root, src.path), "utf8");
    for (const g of parseGrantValues(text, src.pattern)) honoredValues.add(g);
    if (src.path.endsWith("tak/agent-grants.ts")) implications = parseGrantImplications(text);
  }
  if (honoredValues.size === 0) {
    throw new Error("parsed zero honored grant keys — TOOL_TO_GRANTS extraction is broken, refusing to ratchet against garbage");
  }
  return computeUnhonored({ registryKeys, honoredValues, implications });
}

function serializeBaseline(unhonored, budget) {
  const header = formatTxtBudgetHeader({ ...budget, noteLines: NOTE_LINES });
  return `${header}${unhonored.length}\n${unhonored.join("\n")}${unhonored.length ? "\n" : ""}`;
}

function main() {
  const current = computeCurrentUnhonored();

  if (process.argv.includes("--update")) {
    // Preserve the existing budget header; extending an expiry is a deliberate
    // owner act, never an --update side effect (BI-3F17B16B).
    let budget = BUDGET;
    try {
      const existing = parseTxtBudgetHeader(readFileSync(BASELINE_PATH, "utf8"));
      if (existing.owner && existing.expiry) budget = existing;
    } catch {
      // no existing baseline — use defaults
    }
    writeFileSync(BASELINE_PATH, serializeBaseline(current, budget), "utf8");
    console.log(`[unhonored-grant] baseline updated: ${current.length} unhonored grant key(s).`);
    return;
  }

  let baseline = null;
  try {
    baseline = parseBaseline(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    baseline = null;
  }

  const { failures, shrunk } = evaluateRatchet({ current, baseline });
  if (failures.length > 0) {
    console.error("[unhonored-grant] RATCHET VIOLATION:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  if (shrunk) {
    console.error(
      `[unhonored-grant] shrank: ${current.length} < pinned ${baseline.count} — lock it in with ` +
        `node scripts/check-no-unhonored-grant-growth.mjs --update`,
    );
  }
  console.log(`[unhonored-grant] OK — ${current.length} unhonored grant key(s) (pinned ${baseline.count}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
