#!/usr/bin/env node
// scripts/check-golden-decisions.mjs
//
// Shift-left guard for the corpus-aware decision baseline (BI: golden-decisions
// shift-left guard). A new or edited kernel principle loads into EVERY
// principle_decide call (commandments at weight 1.0), so its dimension vector
// shifts ALL canonical decisions. The authoritative test is
// apps/web/lib/decision/golden-decisions.test.ts — but it only runs under
// vitest (unavailable in degraded worktrees) and, in practice, first FAILED a
// change at merge_group time after hours of queue churn (PR #2157). This guard
// is the same check with NO vitest dependency: pure node, ~50ms, reads the real
// docs/founder-kernel/wiki/principles/*.md corpus and gates on each canonical
// decision's winner + margin floor. Wired as a pre-push hook (fires before the
// push leaves the machine) and a fast CI job that merges main first so it scores
// the MERGE-STATE corpus — catching the "green alone, red merged" gap on the PR
// instead of in the queue.
//
// Math + scenarios MIRROR apps/web/lib/decision/{option-scoring,golden-decisions}.ts.
// The formula (alignment = Σ option·vec / Σ|vec|; contribution = weight × alignment;
// composite = Σ) is the core decision algorithm and is intentionally stable. The
// SCENARIOS below mirror GOLDEN_SCENARIOS; scripts/check-golden-decisions.test.mjs
// is a drift-guard that fails CI if the ids / margin floors / winners diverge, and
// both engines (this scorer + the canonical vitest test) run in CI against the same
// corpus, so any behavioral divergence surfaces as one going red.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PRINCIPLES_DIR = join(HERE, "..", "docs", "founder-kernel", "wiki", "principles");
// Profession wikis seed commandment-tier pages too (BI-68553F96): live retrieval
// consults them on every universal-ring decision, so the guard must score the
// same corpus or a profession-page change can drift a canonical decision while
// CI stays green.
const PROFESSIONS_DIR = join(HERE, "..", "docs", "professions");
const POPULATION = "in_platform_coworker"; // universal-ring caller; population filter only
const TIER_DEFAULT_WEIGHT = { commandment: 1.0, core: 0.4, contextual: 0.1 };

// ─── Canonical scenario panel — MIRRORS GOLDEN_SCENARIOS in golden-decisions.ts ──
// Kept in sync by scripts/check-golden-decisions.test.mjs (drift-guard).
export const SCENARIOS = [
  {
    id: "quick-vs-proper-normal",
    expectedWinner: "proper-seed-fix",
    marginFloor: 0.3,
    options: {
      "quick-runtime-patch": { long_term_maintainability: 0.2, schema_grounding: 0.2, reusability: 0.2, blast_radius: 0.1, speed_to_value: 0.9, evidence_density: 0.85, governance_compliance: 0.85, public_safety: 0.5, human_cognitive_load: 0.3 },
      "proper-seed-fix": { long_term_maintainability: 0.95, schema_grounding: 0.85, reusability: 0.7, blast_radius: 0.55, speed_to_value: 0.15, evidence_density: 0.5, governance_compliance: 0.5, human_cognitive_load: 0.4 },
    },
  },
  {
    id: "cheap-sound-vs-rebuild-guard",
    expectedWinner: "cheap-sound-additive",
    marginFloor: 0.1,
    options: {
      "cheap-sound-additive": { long_term_maintainability: 0.85, schema_grounding: 0.8, reusability: 0.6, blast_radius: 0.2, speed_to_value: 0.75, evidence_density: 0.9, governance_compliance: 0.6, cost_efficiency: 0.9, human_cognitive_load: 0.3 },
      "expensive-rebuild": { long_term_maintainability: 0.9, schema_grounding: 0.85, reusability: 0.7, blast_radius: 0.95, speed_to_value: 0.05, evidence_density: 0.4, governance_compliance: 0.5, cost_efficiency: 0.2, human_cognitive_load: 0.1 },
    },
  },
];

// ─── Minimal principle-frontmatter parse (mirrors parsePrinciplePage) ────────
function parsePrinciple(raw, slug) {
  const fm = (raw.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---/) || [, ""])[1];
  const scalar = (k) => {
    const m = fm.match(new RegExp(`^${k}:(.*)$`, "m"));
    if (!m) return undefined;
    const v = m[1].trim().replace(/^["']|["']$/g, "");
    return v.length ? v : undefined;
  };
  const blockList = (k) => {
    const lines = fm.split("\n");
    const idx = lines.findIndex((l) => l === `${k}:` || l.startsWith(`${k}:`));
    if (idx < 0) return [];
    const inline = lines[idx].match(new RegExp(`^${k}:\\s*\\[(.*)\\]`));
    if (inline) return inline[1].split(",").map((s) => s.trim().replace(/['"]/g, "")).filter(Boolean);
    const out = [];
    for (let j = idx + 1; j < lines.length; j++) {
      const m = lines[j].match(/^\s+-\s+(.+?)\s*$/);
      if (!m) { if (/^\S/.test(lines[j])) break; else continue; }
      out.push(m[1].replace(/['"]/g, ""));
    }
    return out;
  };
  let vec;
  const vm = fm.match(/^principleDimensionVector:\s*(\{.*\})\s*$/m);
  if (vm) { try { vec = JSON.parse(vm[1]); } catch { /* leave undefined */ } }
  const w = scalar("principleWeight");
  return {
    slug,
    pageKind: scalar("pageKind"),
    status: scalar("status"),
    tier: scalar("principleTier"),
    appliesTo: blockList("principleAppliesTo"),
    vec,
    weight: w !== undefined ? Number(w) : undefined,
  };
}

function kernelPrincipleFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({ path: join(dir, f), slug: f.replace(/\.md$/, "") }));
}

function professionPrincipleFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const profession of readdirSync(dir, { withFileTypes: true })) {
    if (!profession.isDirectory()) continue;
    const wikiDir = join(dir, profession.name, "wiki");
    if (!existsSync(wikiDir)) continue;
    for (const f of readdirSync(wikiDir)) {
      if (!f.endsWith(".md")) continue;
      // Mirrors the seeded WikiPage slug: professions/<profession>/<page>.
      out.push({
        path: join(wikiDir, f),
        slug: `professions/${profession.name}/${f.replace(/\.md$/, "")}`,
      });
    }
  }
  return out;
}

export function loadCommandments(dir = PRINCIPLES_DIR, professionsDir = PROFESSIONS_DIR) {
  return [...kernelPrincipleFiles(dir), ...professionPrincipleFiles(professionsDir)]
    .map(({ path, slug }) => parsePrinciple(readFileSync(path, "utf8"), slug))
    .filter((p) => p.pageKind === "principle" && (!p.status || p.status === "published"))
    .filter((p) => p.tier === "commandment")
    .filter((p) => !p.appliesTo?.length || p.appliesTo.includes(POPULATION))
    .map((p) => ({ id: p.slug, weight: typeof p.weight === "number" ? p.weight : TIER_DEFAULT_WEIGHT.commandment, vec: p.vec ?? {} }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// ─── Scoring (mirrors option-scoring.ts) ─────────────────────────────────────
function alignment(features, vec) {
  const dims = Object.keys(vec);
  if (!dims.length) return 0; // empty vector -> semantic fallback -> 0 (no embeddings here)
  let num = 0, den = 0;
  for (const d of dims) { den += Math.abs(vec[d]); const f = features[d]; if (typeof f === "number") num += f * vec[d]; }
  return den === 0 ? 0 : num / den;
}
function composite(features, commandments) {
  return commandments.reduce((s, p) => s + p.weight * alignment(features, p.vec), 0);
}

export function runCheck(dir = PRINCIPLES_DIR) {
  const commandments = loadCommandments(dir);
  const results = SCENARIOS.map((s) => {
    const scored = Object.entries(s.options)
      .map(([id, f]) => [id, composite(f, commandments)])
      .sort((a, b) => b[1] - a[1]);
    const margin = scored[0][1] - scored[1][1];
    const winnerOk = scored[0][0] === s.expectedWinner;
    const marginOk = margin >= s.marginFloor;
    return { id: s.id, winner: scored[0][0], expectedWinner: s.expectedWinner, margin, marginFloor: s.marginFloor, winnerOk, marginOk, ok: winnerOk && marginOk };
  });
  return { commandmentCount: commandments.length, results, ok: results.every((r) => r.ok) };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────
const invokedDirectly = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("check-golden-decisions.mjs");
if (invokedDirectly) {
  const { commandmentCount, results, ok } = runCheck();
  console.log(`[golden-decisions] scored ${results.length} canonical decisions against ${commandmentCount} commandments`);
  for (const r of results) {
    const status = r.ok ? "OK" : "FAIL";
    console.log(`  [${status}] ${r.id}: winner=${r.winner}${r.winnerOk ? "" : ` (WANT ${r.expectedWinner})`} margin=${r.margin.toFixed(4)} floor=${r.marginFloor}${r.marginOk ? "" : " BELOW FLOOR"}`);
  }
  if (!ok) {
    console.error(
      "\n[golden-decisions] A canonical decision regressed. A kernel-principle change moved the\n" +
      "decision baseline below its margin floor (or flipped a winner). If the change is a new/edited\n" +
      "principle: recalibrate its principleDimensionVector / principleWeight (a procedural meta-principle\n" +
      "wants a focused vector + low weight) so it does not perturb decisions it has no bearing on. See\n" +
      "docs/founder-kernel/AUTHORING.md and the worked example in PR #2157.",
    );
    process.exit(1);
  }
  console.log("[golden-decisions] all canonical decisions hold. OK");
}
