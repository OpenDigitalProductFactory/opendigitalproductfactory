#!/usr/bin/env node
// scripts/check-tool-surface.mjs
//
// Plane-4 (tool surface) sibling of the plane-3 context-economy guard. Same doctrine,
// same soft shape, and it REUSES that guard's review machinery rather than restating it:
// one rule about how claims come due, applied to two planes.
//
// WHAT IS ALREADY GOVERNED — and therefore what this does NOT do. The DISPATCH path is
// in good shape and this guard deliberately leaves it alone:
//   • the per-turn attachment cap is bounded by LOCAL_TOOL_SELECTION_CLIFF for the
//     cliff-prone small-local class, not merely by window-fit
//     (apps/web/lib/actions/coworker-tool-budget.ts);
//   • MAX_COWORKER_ATTACHED_TOOLS is a hard ceiling above that;
//   • the long tail loads on demand, so the cap costs cost, not capability;
//   • tool DESCRIPTIONS are already enforced (tool-description-hygiene.test.ts, P5).
//
// WHAT IS NOT GOVERNED, and is the whole point of this file: the STANDING REGISTRY. Tool
// definitions accumulate in apps/web/lib/mcp/packs/* with nothing asking why. Every added
// tool is permanent: it enlarges the selection space every surface that lists tools must
// discriminate within, and the definition-token tax paid by any client that lists them
// all. `estimateToolDefinitionTokens` exists (lib/tak/context-economy-metrics.ts) but its
// own header says it changes nothing that is sent — a thermometer, exactly as the runtime
// context plane was before BI-3E218D80.
//
// A BIGGER REGISTRY IS NOT AUTOMATICALLY WORSE. Tools are capability, and capability is
// the point. So this guard does not cap the registry and never says no. It says: growth is
// permitted, growth in SILENCE is not — and the claim you record comes due, because
// "this tool earns its place" is a prediction like any other.
//
//   node scripts/check-tool-surface.mjs            # check (CI)
//   node scripts/check-tool-surface.mjs --update   # re-baseline, then write the reasons

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  DEFAULT_REVIEW_BY_DAYS,
  enforceClaimReview,
  reviewClaims,
} from "./check-context-economy.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = join(REPO_ROOT, "scripts", "tool-surface-baseline.json");
const PACKS_DIR = join(REPO_ROOT, "apps", "web", "lib", "mcp", "packs");
const TIER_REL = join("apps", "web", "lib", "mcp", "tool-tier.ts");
const BUDGET_REL = join("apps", "web", "lib", "actions", "coworker-tool-budget.ts");
const METRICS_REL = join("apps", "web", "lib", "tak", "context-economy-metrics.ts");

// ── Measurement (pure) ──────────────────────────────────────────────────────────

const TOOL_NAME_RE = /^\s+name: "[a-z_][a-z0-9_]*",/gm;
const INPUT_SCHEMA_RE = /^\s+inputSchema:/gm;

function countMatches(source, re) {
  return (source.match(re) ?? []).length;
}

/**
 * Count model-facing tool definitions in one pack source.
 *
 * `inputSchema` IS THE AUTHORITATIVE MARKER, not `name`. This was learned the hard way:
 * counting `name:` reported 350 repo-wide, but public-web-design-pack.ts carries three
 * extra `name:` fields inside JSON-RPC `params` payloads where its handlers CALL another
 * MCP server (`params: { name: "browse_open" }`). Those are outbound calls, not
 * definitions — the real total is 347. Every ToolDefinition has exactly one
 * `inputSchema`, and handler code has none, so the schema count is the honest one.
 *
 * `name` is retained purely as a tripwire in the one direction that cannot happen
 * legitimately: MORE schemas than names would mean the ToolDefinition shape itself
 * changed, and the count could no longer be trusted. More names than schemas is normal
 * and expected. A guard built on a quietly wrong measurement is worse than no guard, so
 * this reports the broken direction rather than guessing.
 */
export function countPackTools(source) {
  const byName = countMatches(source, TOOL_NAME_RE);
  const bySchema = countMatches(source, INPUT_SCHEMA_RE);
  return { byName, bySchema, tools: bySchema, agrees: bySchema <= byName };
}

/** Number of entries in the `CORE_MCP_TOOL_NAMES` set — the opt-in lean tier. */
export function countCoreTierTools(tierSource) {
  const block = /CORE_MCP_TOOL_NAMES[\s\S]*?\]\)/.exec(tierSource);
  if (!block) return null;
  return countMatches(block[0], /^\s+"[a-z_][a-z0-9_]*",?$/gm);
}

/** Read a named numeric constant, e.g. `export const MAX_COWORKER_ATTACHED_TOOLS = 48;`. */
export function readNumericConstant(source, name) {
  const m = new RegExp(`${name}\\s*=\\s*(\\d[\\d_]*)`).exec(source);
  return m ? Number(m[1].replaceAll("_", "")) : null;
}

/**
 * The measured standing surface, as flat `key -> number` entries the baseline holds.
 * `packSources` is a map of filename -> source so disagreements can be named per file.
 */
export function measureToolSurface({ packSources, tierSource, budgetSource, metricsSource }) {
  const measured = {};
  const disagreements = [];
  let tools = 0;
  let packs = 0;

  for (const [file, source] of Object.entries(packSources)) {
    const { byName, bySchema, tools: packTools, agrees } = countPackTools(source);
    if (!agrees) {
      disagreements.push(`${file}: ${bySchema} inputSchema fields exceed ${byName} name fields`);
    }
    tools += packTools;
    packs += 1;
  }

  measured["registry.toolDefinitions"] = tools;
  measured["registry.packFiles"] = packs;

  const core = countCoreTierTools(tierSource);
  if (core !== null) measured["tier.coreToolNames"] = core;

  const maxAttached = readNumericConstant(budgetSource, "MAX_COWORKER_ATTACHED_TOOLS");
  if (maxAttached !== null) measured["dispatch.maxAttachedTools"] = maxAttached;

  const cliff = readNumericConstant(metricsSource, "LOCAL_TOOL_SELECTION_CLIFF");

  return { measured, disagreements, cliff };
}

// ── Evaluation (pure) ───────────────────────────────────────────────────────────

/**
 * Same three rules as the plane-3 guard: no silent drift past the baseline, a raised
 * baseline needs a substantive reason, shrink is welcome. Growth is never forbidden.
 */
export function evaluateToolSurface({ measured, baseline, baseBaseline, disagreements = [] }) {
  const errors = [];
  const notes = [];
  const justified = [];

  for (const d of disagreements) {
    errors.push(
      `tool-definition shape disagreement in ${d} — the count cannot be trusted, so this ` +
        `guard refuses to report a number rather than quietly measuring the wrong thing.`,
    );
  }

  for (const [key, now] of Object.entries(measured)) {
    const entry = baseline?.[key];
    if (!entry || typeof entry.value !== "number") {
      errors.push(`${key} is measured at ${now} but missing from the baseline — run --update.`);
      continue;
    }

    if (now > entry.value) {
      errors.push(
        `${key} grew ${entry.value} -> ${now} without re-baselining. Growth is allowed — ` +
          `raise the baseline and record WHY this tool earns a permanent place in the ` +
          `selection space every surface must discriminate within.`,
      );
      continue;
    }

    const was = baseBaseline?.[key]?.value;
    if (typeof was === "number" && entry.value > was) {
      const reason = typeof entry.reason === "string" ? entry.reason.trim() : "";
      if (reason.length < 20) {
        errors.push(
          `${key} baseline was raised ${was} -> ${entry.value} with no substantive reason. ` +
            `Say what capability it buys and why an existing tool could not carry it — a bare ` +
            `"added a tool" is the attestation theater these guards exist to prevent.`,
        );
      } else {
        justified.push(`${key} ${was} -> ${entry.value}: ${reason}`);
      }
    }

    if (now < entry.value) {
      notes.push(`${key} is ${now}, below its ${entry.value} baseline — run --update to keep the gain.`);
    }
  }

  return { ok: errors.length === 0, errors, notes, justified };
}

// ── I/O ─────────────────────────────────────────────────────────────────────────

function readPackSources() {
  const sources = {};
  for (const file of readdirSync(PACKS_DIR)) {
    if (!file.endsWith(".ts") || file.includes(".test.")) continue;
    sources[file] = readFileSync(join(PACKS_DIR, file), "utf8");
  }
  return sources;
}

function readBaseline(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8")).entries ?? null;
  } catch {
    return null;
  }
}

function readBaselineAtBase() {
  try {
    const out = execFileSync("git", ["show", "origin/main:scripts/tool-surface-baseline.json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(out).entries ?? null;
  } catch {
    // Same fail-open contract as the plane-3 guard: a missing comparison must never
    // invent a violation.
    return null;
  }
}

function main() {
  const { measured, disagreements, cliff } = measureToolSurface({
    packSources: readPackSources(),
    tierSource: readFileSync(join(REPO_ROOT, TIER_REL), "utf8"),
    budgetSource: readFileSync(join(REPO_ROOT, BUDGET_REL), "utf8"),
    metricsSource: readFileSync(join(REPO_ROOT, METRICS_REL), "utf8"),
  });

  if (process.argv.includes("--update")) {
    const existing = readBaseline(BASELINE_PATH) ?? {};
    const entries = {};
    for (const [key, value] of Object.entries(measured)) {
      const prior = existing[key];
      entries[key] = {
        value,
        ...(prior && prior.value === value && prior.reason
          ? {
              reason: prior.reason,
              ...(prior.recordedAt ? { recordedAt: prior.recordedAt } : {}),
              ...(prior.reviewByDays ? { reviewByDays: prior.reviewByDays } : {}),
            }
          : {}),
      };
    }
    writeFileSync(
      BASELINE_PATH,
      JSON.stringify(
        {
          _comment:
            "Plane-4 standing tool-surface baseline (scripts/check-tool-surface.mjs). Growth is " +
            "ALLOWED but never silent: raise a value and record `reason` + `recordedAt` saying " +
            "what capability it buys. Dispatch-time caps are governed elsewhere and are not " +
            "the subject of this baseline.",
          selectionCliff: cliff,
          entries,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`Wrote tool-surface baseline: ${Object.keys(entries).length} entries.`);
    process.exit(0);
  }

  const baseline = readBaseline(BASELINE_PATH);
  if (!baseline) {
    console.error("Missing scripts/tool-surface-baseline.json — run --update to create it.");
    process.exit(1);
  }

  const { errors, notes, justified } = evaluateToolSurface({
    measured,
    baseline,
    baseBaseline: readBaselineAtBase(),
    disagreements,
  });

  const review = reviewClaims({ baseline, now: Date.now(), defaultReviewByDays: DEFAULT_REVIEW_BY_DAYS });
  const claimVerdict = enforceClaimReview({ review, raisedNewClaim: justified.length > 0 });

  for (const j of justified) console.log(`  [recorded] ${j}`);
  for (const n of notes) console.log(`  [note] ${n}`);
  for (const w of claimVerdict.warnings) console.log(`  [review] ${w}`);
  errors.push(...claimVerdict.errors);

  if (errors.length > 0) {
    console.error("\nTool-surface guard failed.\n");
    for (const e of errors) console.error(`  - ${e}`);
    console.error("");
    console.error("This guard does not cap the registry and cannot say no. Tools are capability.");
    console.error("What it refuses is a permanent addition to the selection space recorded in");
    console.error("silence — because the claim has to survive long enough to be checked.");
    console.error("");
    console.error("  node scripts/check-tool-surface.mjs --update   # then write the reasons");
    console.error("");
    process.exit(1);
  }

  console.log(
    `Tool-surface OK — ${measured["registry.toolDefinitions"]} tool definitions across ` +
      `${measured["registry.packFiles"]} packs; core tier ${measured["tier.coreToolNames"]}, ` +
      `per-turn ceiling ${measured["dispatch.maxAttachedTools"]}, selection cliff ${cliff}.` +
      (justified.length ? ` ${justified.length} recorded increase(s).` : ""),
  );
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("check-tool-surface.mjs")) {
  main();
}
