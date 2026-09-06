// scripts/lib/gate-context.mjs — the gate-context pack (BI-2677A465).
//
// PREVENTION, not detection: CI's gates are discovered reactively — an agent
// writes code, pushes, and learns about the module-size ratchet, a frozen
// word budget, a required attestation trailer, or the generated route
// companions from a red check. The 52h failure taxonomy (2026-07-27 → 29)
// counted ~90 deterministic guard failures in exactly that class. This module
// answers, BEFORE generation or push: "given this diff, which gate
// constraints apply?" — derived from the same registries and checker exports
// CI runs (never a hand-written prose list that can drift):
//
//   - attestation trailers   → scripts/lib/gate-sensitivity.mjs +
//                              check-design-grounding-decision.mjs +
//                              check-data-impact.mjs + lib/seed-fit-gate.mjs
//   - module-size caps       → scripts/module-size-baseline.txt +
//                              lib/module-size-scope.mjs
//   - prose/style ratchets   → scripts/prose-lint-baseline.json +
//                              scripts/style-drift-baseline.json
//   - derived artifacts      → lib/derived-artifacts-registry.mjs
//   - route budgets/companions → apps/web/lib/ux-budget/route-budget-baseline.json
//                              + deriveRoute from lib/ci-evidence-plan.mjs
//   - migration immutability → the pre-commit guard + migration-safety contract
//
// Consumers: the scripts/gate-context.mjs CLI (`pnpm gate:context`) today; an
// MCP tool and Build Studio prompt assembly in follow-up slices (they must
// consume THIS module so the pack stays the single source).
//
// Determinism contract: output depends only on the input diff and the checked-
// in registries — no timestamps, no environment probes — so packs are
// comparable across runs and cacheable by tree.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { classifyChangedFiles } from "../check-design-grounding-decision.mjs";
import { classifyChangedSurfaces } from "../check-data-impact.mjs";
import { deriveRoute } from "./ci-evidence-plan.mjs";
import { affectedEntries } from "./derived-artifacts-registry.mjs";
import {
  ADDED_SOURCE_LINE_THRESHOLD,
  DOC_ARTIFACT_RE,
  NEW_SOURCE_FILE_RE,
  SOURCE_LINE_FILE_RE,
  UI_CONTROL_DESCRIPTION,
  UX_EXCLUDE_RE,
  UX_ROUTE_FILE_RE,
  isProseLintSource,
  isStyleDriftSource,
} from "./gate-sensitivity.mjs";
import { findCanonicalSeedContentPaths } from "./seed-fit-gate.mjs";
import { PR_TRAILER_NAMES } from "./pr-trailer-contract.mjs";
import { classifyConvergenceSurfaces } from "../check-convergence-impact.mjs";
import {
  MODULE_SIZE_HARD_CAP,
  MODULE_SIZE_SOFT_CEILING,
  isModuleSizeSource,
} from "./module-size-scope.mjs";
import { POLICY_GUARD_PROFILES } from "./ci-policy-guards.mjs";

export const GATE_CONTEXT_SCHEMA_VERSION = 2;

const MIGRATION_FILE_RE = /^packages\/db\/prisma\/migrations\/[^/]+\/migration\.sql$/;
// Schema domain-folder files (packages/db/prisma/schema/*.prisma, B5 Seam C
// layout) plus the legacy schema.prisma monolith for diffs spanning the split.
const PRISMA_SCHEMA_RE = /^packages\/db\/prisma\/schema(\.prisma$|\/[^/]+\.prisma$)/;

function normalize(path) {
  return String(path ?? "").trim().replace(/\\/g, "/");
}

function loadJson(repoRoot, relative) {
  try {
    return JSON.parse(readFileSync(join(repoRoot, relative), "utf8"));
  } catch {
    return null;
  }
}

function loadModuleSizeBaseline(repoRoot) {
  try {
    const text = readFileSync(join(repoRoot, "scripts/module-size-baseline.txt"), "utf8");
    const map = new Map();
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^(\S+)\t(\d+)$/);
      if (!match) continue;
      const cap = Number(match[2]);
      // The checker resolves duplicate union-merge lines to the max cap.
      map.set(match[1], Math.max(cap, map.get(match[1]) ?? 0));
    }
    return map;
  } catch {
    return new Map();
  }
}

function policyGuard(id) {
  for (const guards of Object.values(POLICY_GUARD_PROFILES)) {
    const found = guards.find((entry) => entry.id === id);
    if (found) return found;
  }
  return null;
}

function guardObligations(paths) {
  const selected = [];
  const add = (id, because) => {
    const guard = policyGuard(id);
    if (guard && !selected.some((entry) => entry.id === id)) {
      selected.push({ id: guard.id, name: guard.name, commands: guard.commands, because });
    }
  };
  if (paths.some(isProseLintSource)) {
    add("prose-lint-guard", "planned source is scanned for UI-copy vocabulary, readability, sentence length, and text mass");
  }
  if (paths.some(isStyleDriftSource)) {
    add("style-drift-guard", "planned source is scanned for hardcoded colors and off-scale style tokens");
  }
  return selected;
}

function testImpact(files, repoRoot) {
  const policy = loadJson(repoRoot, "config/ci-evidence-policy.json");
  const production = (policy?.patterns?.production ?? []).map((pattern) => new RegExp(pattern));
  const tests = (policy?.patterns?.tests ?? []).map((pattern) => new RegExp(pattern));
  if (production.length === 0) return [];
  return files
    .filter((file) => file.status !== "D")
    .filter((file) => production.some((pattern) => pattern.test(file.path)))
    .filter((file) => !tests.some((pattern) => pattern.test(file.path)))
    .map((file) => ({
      path: file.path,
      action: "find-related-tests",
      tool: "find_related_tests",
      rule: "resolve graph-linked and colocated tests before Red; missing or stale advice expands verification",
    }));
}

function trailerConstraints(files, addedLinesByFile) {
  const trailers = [];
  const paths = files.map((f) => f.path);
  const docsTouched = paths.some((p) => DOC_ARTIFACT_RE.test(p));

  const newSubstantial = files.filter(
    (f) => f.status === "A" && NEW_SOURCE_FILE_RE.test(f.path) && !UX_EXCLUDE_RE.test(f.path),
  );
  const addedSourceLines = files
    .filter((f) => SOURCE_LINE_FILE_RE.test(f.path) && !/\.(test|spec)\.(ts|tsx)$/.test(f.path))
    .reduce((total, f) => total + (addedLinesByFile?.get?.(f.path) ?? 0), 0);
  if ((newSubstantial.length > 0 || addedSourceLines > ADDED_SOURCE_LINE_THRESHOLD) && !docsTouched) {
    trailers.push({
      gate: "Spec/Plan/Doc",
      trailer: `${PR_TRAILER_NAMES.processSpine}:`,
      level: "required",
      because: newSubstantial.length > 0
        ? `new source module(s)/route(s): ${newSubstantial.slice(0, 5).map((f) => f.path).join(", ")}`
        : `~${addedSourceLines} added source lines exceed the ${ADDED_SOURCE_LINE_THRESHOLD}-line substantial-change threshold`,
      alternative: "touch the affected doc/spec/plan in the same PR (preferred over the trailer)",
    });
  }

  const designSensitive = classifyChangedFiles(paths).designSensitive;
  if (designSensitive.length > 0) {
    trailers.push({
      gate: "Design Grounding",
      trailer: `${PR_TRAILER_NAMES.designGrounding}:`,
      level: "required",
      because: `design-sensitive file(s): ${designSensitive.slice(0, 5).join(", ")}`,
      alternative: "a '## Design grounding' section in the PR body (specs/plans reviewed + code substrate reviewed + source of truth + decision)",
    });
  }

  const newRoutes = files.filter(
    (f) => f.status === "A" && UX_ROUTE_FILE_RE.test(f.path) && !UX_EXCLUDE_RE.test(f.path),
  );
  const editedUi = files.filter(
    (f) => /apps\/web\/.*\.tsx$/.test(f.path) && !UX_EXCLUDE_RE.test(f.path),
  );
  // BI-D967DEE0: the UX-Fit gate takes a committed MEASURED manifest, not a trailer.
  // This pack is injected into agent context BEFORE generation, so advertising the
  // retired trailer here would pre-instruct every agent to satisfy a dead mechanism.
  const UX_FIT_MANIFEST = "docs/ux-fit/<date>-<slug>.ux-fit.json";
  const UX_FIT_ALTERNATIVE =
    'evidence.kind "sweep-measurement" (the route\'s real budget axes, adjudicated against ' +
    'apps/web/lib/ux-budget/route-budget-baseline.json) or "propose-n-pick" ' +
    "(decisionInteractionId + >=2 consideredOptions). An acknowledgement does NOT qualify, " +
    "and the UX-Fit-Decision: trailer is RETIRED.";
  if (newRoutes.length > 0) {
    trailers.push({
      gate: "UX-Fit",
      trailer: UX_FIT_MANIFEST,
      alternative: UX_FIT_ALTERNATIVE,
      level: "required",
      because: `net-new route page(s): ${newRoutes.map((f) => f.path).join(", ")}`,
    });
  } else if (editedUi.length > 0) {
    trailers.push({
      gate: "UX-Fit",
      trailer: UX_FIT_MANIFEST,
      alternative: UX_FIT_ALTERNATIVE,
      level: "conditional",
      because: `apps/web .tsx changed - required if the diff ADDS a user-facing control (${UI_CONTROL_DESCRIPTION})`,
    });
  }

  const seedPaths = findCanonicalSeedContentPaths(paths);
  if (seedPaths.length > 0) {
    trailers.push({
      gate: "Seed Contribution Fit",
      trailer: `${PR_TRAILER_NAMES.seedFit}:`,
      level: "required",
      because: `canonical seed content changed: ${seedPaths.slice(0, 5).join(", ")}`,
      note: "this one goes in the PR BODY (the gate reads the push-event body, not commit trailers)",
    });
  }

  const dataSurfaces = classifyChangedSurfaces(paths);
  if (dataSurfaces.length > 0) {
    trailers.push({
      gate: "Data-Impact",
      trailer: "Data-Impact manifest",
      level: "required",
      because: `persistent data surface(s) changed: ${dataSurfaces.join(", ")}`,
      alternative: "a data-impact manifest (or registered exception) covering migration/backfill/rollback disposition",
    });
  }

  // BI-B19BE117: an install-reachable surface (compose, env contract, installer,
  // hooks, config, image-copied-by-name script, seed content) must state how an
  // EXISTING install converges. Advertised here so every surface writes the
  // trailer before generation rather than learning about it from a red check.
  let convergence = [];
  try { convergence = classifyConvergenceSurfaces(paths); } catch { /* registry unreadable: the CI gate still runs */ }
  if (convergence.length > 0) {
    trailers.push({
      gate: "Convergence-Impact",
      trailer: `${PR_TRAILER_NAMES.convergenceImpact}:`,
      level: "required",
      because: `install-reachable surface(s) changed: ${convergence.map((s) => `${s.kind} (${s.files.slice(0, 3).join(", ")})`).join("; ")}`,
      alternative: "<mode> — <mechanism or reason, 20+ chars>; modes: auto-converges | self-upgrade-step | operator-action | fresh-install-only | not-reachable",
    });
  }

  return trailers;
}

export function buildGateContext({
  changedFiles = [],
  addedLinesByFile = new Map(),
  repoRoot = process.cwd(),
} = {}) {
  const files = changedFiles
    .map((f) => (typeof f === "string" ? { path: f, status: "M" } : f))
    .map((f) => ({ ...f, path: normalize(f.path) }))
    .filter((f) => f.path);
  const paths = files.map((f) => f.path);

  // 1. Attestation trailers this diff shape requires.
  const trailers = trailerConstraints(files, addedLinesByFile);

  // 2. Module-size ratchet: baselined caps for touched files; absolute budget
  //    for new source files. Baselined files may shrink, never grow.
  const sizeBaseline = loadModuleSizeBaseline(repoRoot);
  const moduleSize = [];
  for (const f of files) {
    if (f.status === "D") continue;
    if (sizeBaseline.has(f.path)) {
      moduleSize.push({ path: f.path, capLines: sizeBaseline.get(f.path), rule: "baselined: may shrink, never grow (guard counts lines its own way — trust the guard, not wc -l)" });
    } else if (f.status === "A" && isModuleSizeSource(f.path)) {
      moduleSize.push({ path: f.path, capLines: MODULE_SIZE_SOFT_CEILING, rule: `new module: keep under ${MODULE_SIZE_SOFT_CEILING} lines (hard cap ${MODULE_SIZE_HARD_CAP})` });
    }
  }

  // 3. Prose / style shrink-only ratchets for touched files.
  const proseBaseline = loadJson(repoRoot, "scripts/prose-lint-baseline.json") ?? {};
  const styleBaseline = loadJson(repoRoot, "scripts/style-drift-baseline.json") ?? {};
  const ratchets = [];
  for (const path of paths) {
    if (proseBaseline[path]) {
      ratchets.push({ path, ratchet: "prose-lint", frozen: proseBaseline[path], rule: "every axis may shrink, never grow" });
    }
    if (styleBaseline[path] !== undefined) {
      ratchets.push({ path, ratchet: "style-drift", frozen: styleBaseline[path], rule: "hardcoded style tokens may shrink, never grow" });
    }
  }

  // 4. Derived artifacts whose sources this diff touches — regenerate and
  //    commit the artifact in the SAME change (pre-commit stages registered
  //    ones automatically; route companions are checked by their own audits).
  const derived = affectedEntries(paths).map((entry) => ({
    id: entry.id,
    description: entry.description,
    artifacts: entry.artifactPaths,
  }));

  // 5. Routes: net-new pages face absolute budgets + four generated
  //    companions; pre-existing pages carry a frozen word/structure budget.
  const budgetBaseline = loadJson(repoRoot, "apps/web/lib/ux-budget/route-budget-baseline.json");
  const routes = [];
  for (const f of files) {
    const route = deriveRoute(f.path);
    if (!route || UX_EXCLUDE_RE.test(f.path)) continue;
    const frozen = budgetBaseline?.routes?.[route];
    if (f.status === "A" && !frozen) {
      routes.push({
        route,
        status: "net-new",
        rules: [
          "absolute UX budgets BLOCK (no legacy excuse): shell word/control/field budgets + data-dpf-lead band + owner-first next-action marker",
          "regenerate the four companions in this change: route-manifest, route-shells, route-audience (apps/web/scripts/build-route-*.ts) and doc-index",
          "update the hardcoded eligible-route count in apps/web/lib/ux-budget/ux-budget.test.ts",
        ],
      });
    } else if (frozen) {
      routes.push({
        route,
        status: "pre-existing",
        rules: [
          `frozen sweep baseline: ≤${frozen.defaultVisibleWords} words visible on arrival; heading/landmark structure must not change shape`,
          "net word delta ≤ 0 on this route — the merge-group sweep enforces it against the checked-in baseline",
        ],
      });
    }
  }

  // 6. Migrations: committed migrations are immutable; new ones carry the
  //    safety-attestation and timestamp contracts.
  const migrations = [];
  const editedMigrations = files.filter((f) => f.status !== "A" && f.status !== "D" && MIGRATION_FILE_RE.test(f.path));
  if (editedMigrations.length > 0) {
    migrations.push({
      severity: "blocking",
      rule: `committed migrations are IMMUTABLE (pre-commit rejects the edit): ${editedMigrations.map((f) => f.path).join(", ")} — author a NEW migration (field-fixes may need an earlier timestamp) instead`,
    });
  }
  if (files.some((f) => f.status === "A" && MIGRATION_FILE_RE.test(f.path))) {
    migrations.push({
      severity: "blocking",
      rule: "new migration: must pass the migration-safety guard (tightening DDL needs an in-file attestation/remediation block) and the timestamp-collision guard (rebump via git mv if a concurrent PR took your timestamp)",
    });
  }
  if (paths.some((p) => PRISMA_SCHEMA_RE.test(p))) {
    migrations.push({
      severity: "advisory",
      rule: "Prisma schema changed: a new model trips the substrate-complexity baseline (scripts/platform-substrate-baseline.json prismaModelCount) plus the new-Prisma-model gate gauntlet — update only your own baseline line",
    });
  }

  // 7. Work-start obligations: unlike shrink-only ratchets, these name guards
  // that scan a planned file even when it has no baseline entry yet, plus the
  // related-test lookup each production file needs before Red.
  const guards = guardObligations(paths);
  const tests = testImpact(files, repoRoot);

  return {
    schemaVersion: GATE_CONTEXT_SCHEMA_VERSION,
    changedFileCount: files.length,
    trailers,
    moduleSize,
    ratchets,
    derivedArtifacts: derived,
    routes,
    migrations,
    guardObligations: guards,
    testImpact: tests,
    verification: [
      "quick host-side guard check before the sandbox gate: pnpm run pregate:preflight (~1 min, no lease)",
      "runtime-code pushes need a passing exact-tree gate for this branch+SHA: pnpm run pregate",
      "before merge: pnpm pr:health (and read bot REVIEW findings, not just checks)",
    ],
  };
}

function formatSection(title, lines) {
  if (lines.length === 0) return [];
  return [`## ${title}`, ...lines, ""];
}

export function formatGateContextMarkdown(context) {
  const out = ["# Gate context — constraints CI will enforce on this diff", ""];
  out.push(...formatSection(
    "Required attestations",
    context.trailers.map((t) =>
      `- **${t.gate}** (${t.level}): \`${t.trailer}\` — ${t.because}${t.alternative ? `; alternative: ${t.alternative}` : ""}${t.note ? ` (${t.note})` : ""}`,
    ),
  ));
  out.push(...formatSection(
    "Module-size caps",
    context.moduleSize.map((m) => `- \`${m.path}\` ≤ ${m.capLines} lines — ${m.rule}`),
  ));
  out.push(...formatSection(
    "Shrink-only ratchets on touched files",
    context.ratchets.map((r) => `- \`${r.path}\` [${r.ratchet}] frozen at ${JSON.stringify(r.frozen)} — ${r.rule}`),
  ));
  out.push(...formatSection(
    "Derived artifacts to regenerate in this change",
    context.derivedArtifacts.map((d) => `- **${d.id}**: ${d.artifacts.join(", ")}`),
  ));
  out.push(...formatSection(
    "Route budgets",
    context.routes.flatMap((r) => [`- \`${r.route}\` (${r.status}):`, ...r.rules.map((rule) => `  - ${rule}`)]),
  ));
  out.push(...formatSection(
    "Migrations",
    context.migrations.map((m) => `- [${m.severity}] ${m.rule}`),
  ));
  out.push(...formatSection(
    "Guards to exercise before implementation is considered complete",
    context.guardObligations.map((g) => `- **${g.name}** (\`${g.id}\`) — ${g.because}`),
  ));
  out.push(...formatSection(
    "Tests to resolve before implementation",
    context.testImpact.map((entry) => `- \`${entry.path}\`: call \`${entry.tool}\` — ${entry.rule}`),
  ));
  out.push(...formatSection("Verification path", context.verification.map((v) => `- ${v}`)));
  if (
    context.trailers.length + context.moduleSize.length + context.ratchets.length +
    context.derivedArtifacts.length + context.routes.length + context.migrations.length +
    context.guardObligations.length + context.testImpact.length === 0
  ) {
    out.splice(2, 0, "_No gate-sensitive surfaces detected in this diff — the always-on verification path still applies._", "");
  }
  return out.join("\n");
}
