#!/usr/bin/env node
// scripts/check-ux-fit-decision.mjs
//
// BI-D967DEE0 — UX-Fit gate, Phase 3: MEASURED-EVIDENCE MANIFEST. Attestation retired.
// (EP-UX-SYSTEM spec §6 L4; BI-65DEE968 §5 direction; Data-Impact Gate transport pattern.)
//
// WHAT CHANGED AND WHY. Phase 2 (BI-65DEE968) accepted a `UX-Fit-Decision:` trailer in a
// commit or the PR body. Its own header called that "a conscious-attestation MVP": a PR
// asserting `progressive-disclosure (principle_decide, margin 0.85)` passed without any
// check that a consult had happened or that the screen got better. A gate that cannot
// distinguish a real decision from a plausible sentence is a gate that measures typing.
//
// So the qualifying evidence is now RESTRICTED TO MEASURED ARTIFACTS, per BI-D967DEE0:
//   • "sweep-measurement" — the route's real budget metrics, checked against the COMMITTED
//     route-budget baseline (apps/web/lib/ux-budget/route-budget-baseline.json).
//   • "propose-n-pick"    — a real recorded choice among >= 2 options, carrying the
//     DecisionInteraction id it was recorded under.
// A bare "budgets acknowledged" record does NOT qualify — that is attestation theater with
// one extra row, and it is rejected by name.
//
// WHY A COMMITTED MANIFEST IS THE TRANSPORT. CI cannot read an install's database, so it
// can never resolve a DecisionInteraction id by itself. The Data-Impact Gate solved the
// same problem the same way: the PR carries a generated `*.data-impact.json`; here it
// carries `*.ux-fit.json` (convention: docs/ux-fit/<date>-<slug>.ux-fit.json). What makes
// this more than self-report is that the baseline IS committed — so for a pre-existing
// route the gate re-derives the ratchet from a measured artifact already in the tree and
// fails a manifest whose numbers regress it. The manifest states; the baseline adjudicates.
//
// The manifest must be ADDED OR MODIFIED IN THIS PR's diff. An untouched manifest from a
// previous change cannot satisfy the gate, so evidence cannot be recycled.
//
// This module exports pure validators (unit-tested against permanent red/green fixtures in
// docs/testing/fixtures/ux-fit/) and a `main()` that runs the gate in CI/local. It reads
// the evidence, never which surface produced it — identical for Claude Code, Codex, Grok
// and Build Studio, because all changes land via PR (AGENTS.md §4/§17).

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fetchOriginMainSharedSafe } from "./lib/git-fetch-shared-safe.mjs";
import { listChangedFiles, exitUnresolvable } from "./lib/git-changed-files.mjs";
// Canonical sensitivity constants (single source, shared with the gate-context pack;
// the dpf-skill-pack precheck hook keeps a drift-guard-pinned copy) — BI-2677A465.
// `UX_FIT_ATTESTATION_RE` is deliberately NOT imported: this gate no longer reads any
// trailer (BI-D967DEE0). It stays exported there, marked retired, because the
// gate-context pack still needs to recognise the dead trailer to warn about it.
import {
  UI_CONTROL_RE,
  UX_EXCLUDE_RE as EXCLUDE_RE,
  UX_ROUTE_FILE_RE as ROUTE_FILE_RE,
} from "./lib/gate-sensitivity.mjs";

// ── What counts as a UI-impacting change ────────────────────────────────────────

// Re-exported so the gate and its tests can never disagree about sensitivity.
export { UI_CONTROL_RE, EXCLUDE_RE, ROUTE_FILE_RE };
// The manifest itself.
export const MANIFEST_RE = /\.ux-fit\.json$/;
/**
 * Test fixtures are NOT evidence. They are deliberately-invalid red cases plus green cases
 * scoped to a synthetic route, so treating them as candidate manifests made every PR that
 * touched them inherit their intended failures — and let a green fixture masquerade as
 * coverage for an unrelated change. Caught by running the gate end-to-end on a synthetic
 * UI change; the unit tests could not see it because they inject manifests directly.
 */
export const FIXTURE_RE = /^docs\/testing\/fixtures\//;

/** Manifest paths in a diff that actually count as evidence. */
export function manifestPathsFromDiff(paths) {
  return paths.filter((p) => MANIFEST_RE.test(p) && !FIXTURE_RE.test(p));
}

/**
 * Map a Next.js page file to its route path. `apps/web/app/(shell)/ops/page.tsx` -> `/ops`.
 * Route groups `(shell)` are layout-only and contribute no path segment; a dynamic segment
 * `[id]` is kept verbatim so it matches how the sweep keys the baseline.
 */
export function routePathForPageFile(file) {
  const m = /^apps\/web\/app\/(.*)\/page\.tsx$/.exec(file);
  if (!m) return null;
  const segments = m[1]
    .split("/")
    .filter((s) => s.length > 0 && !(s.startsWith("(") && s.endsWith(")")));
  return "/" + segments.join("/");
}

/** The metric axes the sweep freezes. Mirrors RATCHET_AXES in lib/ux-budget/ratchet.ts. */
export const MEASURED_AXES = [
  "defaultVisibleWords",
  "leadBandWords",
  "primaryActions",
  "visibleFields",
  "maxChoicesPerControl",
  "subLegibleControls",
  "buriedPrimaryAction",
  "axeViolations",
];

/**
 * Per-axis polarity. Mirrors RATCHET_AXIS_POLARITY in lib/ux-budget/ratchet.ts —
 * and it has to, because this gate compares the SAME numbers against the SAME
 * frozen baseline. It previously mirrored only the axis LIST and applied
 * `now > was` to all of them, so the leadBandWords fix (BI-E7F6C76E) landed in
 * the ratchet and left this second consumer still failing the change it exists
 * to encourage: a migrated route adding its first lead band (0 -> 31) was
 * reported as a regression here even after the ratchet stopped doing so.
 *
 * "max"      — more is worse; an increase beyond the baseline is a regression.
 * "presence" — the budget wants this axis to EXIST. Going up is the fix, so only
 *              losing it (dropping to 0 when the baseline had one) regresses.
 */
export const MEASURED_AXIS_POLARITY = {
  defaultVisibleWords: "max",
  leadBandWords: "presence",
  primaryActions: "max",
  visibleFields: "max",
  maxChoicesPerControl: "max",
  subLegibleControls: "max",
  buriedPrimaryAction: "max",
  axeViolations: "max",
};

/** True when `now` is worse than the frozen `was` for this axis's polarity. */
export function axisRegressed(axis, was, now) {
  return MEASURED_AXIS_POLARITY[axis] === "presence"
    ? was > 0 && now === 0
    : now > was;
}

/** Evidence kinds that represent a real measurement or a real recorded choice. */
export const QUALIFYING_EVIDENCE_KINDS = ["sweep-measurement", "propose-n-pick"];
/**
 * Kinds that look like evidence but assert rather than measure. Named explicitly so the
 * failure says WHY instead of "unknown kind" — BI-D967DEE0 calls this out as the specific
 * regression to prevent.
 */
export const THEATRE_EVIDENCE_KINDS = [
  "budgets-acknowledged",
  "acknowledged",
  "attestation",
  "reviewed",
  "self-attested",
];

// ── Manifest validation (pure, deterministic error strings) ─────────────────────

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Validate one manifest's shape. Returns an array of human-readable errors; empty = valid.
 * Shape checks only — cross-checking against the diff and the baseline happens in runGate,
 * because those need repo state.
 */
export function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return ["manifest is not an object"];
  }
  if (manifest.version !== "1") errors.push('manifest.version must be "1"');
  if (typeof manifest.decidedOption !== "string" || manifest.decidedOption.trim() === "") {
    errors.push("manifest.decidedOption is required (the option the decision landed on)");
  }

  const scope = manifest.scope;
  if (!scope || typeof scope !== "object") {
    errors.push("manifest.scope is required and must declare the files this decision covers");
  } else if (!Array.isArray(scope.files) || scope.files.length === 0) {
    errors.push("manifest.scope.files must be a non-empty array of repo-relative paths");
  } else if (!scope.files.every((f) => typeof f === "string" && f.length > 0)) {
    errors.push("manifest.scope.files entries must be non-empty strings");
  }

  const evidence = manifest.evidence;
  if (!evidence || typeof evidence !== "object") {
    errors.push("manifest.evidence is required");
    return errors;
  }

  if (THEATRE_EVIDENCE_KINDS.includes(evidence.kind)) {
    errors.push(
      `manifest.evidence.kind "${evidence.kind}" does NOT qualify — an acknowledgement is ` +
        `attestation theater with one extra row (BI-D967DEE0). Supply measured evidence: ` +
        QUALIFYING_EVIDENCE_KINDS.join(" or "),
    );
    return errors;
  }
  if (!QUALIFYING_EVIDENCE_KINDS.includes(evidence.kind)) {
    errors.push(
      `manifest.evidence.kind must be one of ${QUALIFYING_EVIDENCE_KINDS.join(", ")} ` +
        `(got ${JSON.stringify(evidence.kind)})`,
    );
    return errors;
  }

  if (evidence.kind === "sweep-measurement") {
    const measured = evidence.measured;
    if (!measured || typeof measured !== "object" || Array.isArray(measured)) {
      errors.push("sweep-measurement evidence needs measured{} keyed by route path");
    } else {
      const routes = Object.keys(measured);
      if (routes.length === 0) {
        errors.push("sweep-measurement evidence needs at least one measured route");
      }
      for (const route of routes) {
        if (!route.startsWith("/")) {
          errors.push(`measured route "${route}" must be a route path starting with "/"`);
        }
        const metrics = measured[route];
        if (!metrics || typeof metrics !== "object") {
          errors.push(`measured["${route}"] must be an object of measured axes`);
          continue;
        }
        for (const axis of MEASURED_AXES) {
          if (!isFiniteNumber(metrics[axis])) {
            errors.push(`measured["${route}"].${axis} must be a number (measure it, don't omit it)`);
          }
        }
      }
    }
  }

  if (evidence.kind === "propose-n-pick") {
    if (typeof manifest.decisionInteractionId !== "string" || !manifest.decisionInteractionId) {
      errors.push(
        "propose-n-pick evidence requires manifest.decisionInteractionId — the id the choice " +
          "was recorded under, so the ledger row can be found later",
      );
    }
    const considered = evidence.consideredOptions;
    if (!Array.isArray(considered) || considered.length < 2) {
      errors.push(
        "propose-n-pick evidence requires evidence.consideredOptions with at least 2 entries " +
          "(a pick among one option is not a choice)",
      );
    } else if (!considered.includes(manifest.decidedOption)) {
      errors.push(
        `manifest.decidedOption ${JSON.stringify(manifest.decidedOption)} must be one of ` +
          `evidence.consideredOptions`,
      );
    }
  }

  return errors;
}

/**
 * Re-derive the ratchet from the COMMITTED baseline. A pre-existing route's measured
 * numbers may not exceed what the tree already recorded; a route the manifest declares
 * new must genuinely be absent from the baseline.
 *
 * This is the step that makes the manifest adjudicable rather than self-reported.
 */
export function checkMeasurementAgainstBaseline(manifest, baseline) {
  const errors = [];
  const evidence = manifest?.evidence;
  if (evidence?.kind !== "sweep-measurement") return errors;
  const measured = evidence.measured ?? {};
  const baselineRoutes = baseline?.routes ?? {};

  for (const [route, metrics] of Object.entries(measured)) {
    const frozen = baselineRoutes[route];
    const declaredNew = evidence.baselineComparison === "new-route";

    if (!frozen) {
      if (!declaredNew) {
        errors.push(
          `measured route "${route}" is not in the committed budget baseline. If it is a new ` +
            `route set evidence.baselineComparison to "new-route"; otherwise the route path is wrong.`,
        );
      }
      continue;
    }
    if (declaredNew) {
      errors.push(
        `evidence.baselineComparison says "new-route" but "${route}" is already in the ` +
          `committed baseline`,
      );
      continue;
    }
    for (const axis of MEASURED_AXES) {
      const now = metrics?.[axis];
      const was = frozen[axis];
      if (!isFiniteNumber(now) || !isFiniteNumber(was)) continue;
      if (axisRegressed(axis, was, now)) {
        errors.push(
          `"${route}" regresses ${axis}: ${was} -> ${now}. The UX budget ratchet only allows ` +
            `a changed route to hold or improve its own frozen baseline.`,
        );
      }
    }
  }
  return errors;
}

// ── The gate ───────────────────────────────────────────────────────────────────

/**
 * Pure gate evaluation.
 *
 * @param {object} input
 * @param {string[]} input.impactingFiles   UI-impacting changed files (with reason suffixes stripped)
 * @param {{path:string, manifest:unknown}[]} input.manifests  `*.ux-fit.json` touched by this PR
 * @param {object|null} input.baseline      parsed route-budget-baseline.json, or null
 * @returns {{ok:boolean, errors:string[], notes:string[]}}
 */
export function runGate({ impactingFiles, manifests, baseline }) {
  const errors = [];
  const notes = [];

  if (impactingFiles.length === 0) {
    return { ok: true, errors, notes: ["No UI-impacting controls or routes added — nothing to gate."] };
  }

  if (manifests.length === 0) {
    errors.push(
      "UI-impacting change carries no *.ux-fit.json manifest. The UX-Fit trailer was retired " +
        "(BI-D967DEE0) — a measured manifest is now required.",
    );
    return { ok: false, errors, notes };
  }

  // Shape, then baseline adjudication, per manifest.
  for (const { path, manifest } of manifests) {
    for (const e of validateManifest(manifest)) errors.push(`${path}: ${e}`);
    if (baseline) {
      for (const e of checkMeasurementAgainstBaseline(manifest, baseline)) errors.push(`${path}: ${e}`);
    }
  }
  if (!baseline) {
    notes.push(
      "route-budget-baseline.json not readable — measured numbers could not be adjudicated " +
        "against the frozen baseline in this run.",
    );
  }

  // Manifest-vs-diff consistency, both directions.
  const covered = new Set();
  for (const { manifest } of manifests) {
    const files = manifest?.scope?.files;
    if (Array.isArray(files)) for (const f of files) if (typeof f === "string") covered.add(f);
  }

  const uncovered = impactingFiles.filter((f) => !covered.has(f));
  for (const f of uncovered) {
    errors.push(
      `${f} is UI-impacting but no *.ux-fit.json manifest lists it in scope.files — the ` +
        `decision does not cover the change.`,
    );
  }

  const impacting = new Set(impactingFiles);
  for (const { path, manifest } of manifests) {
    const files = manifest?.scope?.files;
    if (!Array.isArray(files)) continue;
    for (const f of files) {
      if (typeof f === "string" && !impacting.has(f)) {
        errors.push(
          `${path}: scope.files lists "${f}", which is not a UI-impacting change in this PR — ` +
            `a stale or over-broad manifest cannot stand in as evidence.`,
        );
      }
    }
  }

  return { ok: errors.length === 0, errors, notes };
}

// ── git plumbing (unchanged hardening from BI-65DEE968) ─────────────────────────

// Refs reach us from CI env vars (BASE_SHA) and from git's own output. Pin the set of
// characters we accept so a forged value cannot smuggle shell metachars or git option
// flags through to execFile. (js/indirect-command-line-injection.)
const REF_RE = /^[A-Za-z0-9._\-/]{1,200}$/;
// Repo-relative paths git emits in --name-only. The character set must include Next.js
// route-segment punctuation — route groups `(shell)` and dynamic/catch-all segments
// `[id]` / `[[...slug]]`. These chars are inert: execFile uses an arg array (no shell),
// and the leading-`-` guard below still blocks option injection.
const PATH_RE = /^[A-Za-z0-9._\-/()[\]]+$/;

function assertSafeRef(ref, label) {
  if (!REF_RE.test(ref) || ref.startsWith("-")) {
    throw new Error(`[ux-fit-gate] refusing unsafe ${label}: ${JSON.stringify(ref)}`);
  }
  return ref;
}

function assertSafePath(path) {
  if (!PATH_RE.test(path) || path.startsWith("-")) {
    throw new Error(`[ux-fit-gate] refusing unsafe path: ${JSON.stringify(path)}`);
  }
  return path;
}

// execFile with arg array — bypasses the shell entirely, so individual args containing
// $, `, ;, &, |, etc. are inert.
function git(...args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    return (e.stdout && e.stdout.toString()) || "";
  }
}

function lines(out) {
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

// User-visible copy in a line: quoted string literals and JSX text nodes. This is
// what the UX budget actually measures, so it is what decides whether a moved file
// introduced a new surface.
function visibleCopy(line) {
  const out = new Set();
  // A module specifier is not user copy — `import … from "@/components/…"` changes
  // with every file move and would otherwise read as new on-screen text.
  if (/^\s*[+-]?\s*(import|export)\b.*\bfrom\b/.test(line)) return out;
  // Only props/fields whose values are actually rendered count here. Treating every
  // quoted literal as copy makes className, ids, enum values and data attributes look
  // like UX changes, which turns the guard into noise and encourages bypasses.
  const renderedProperty =
    /\b(?:aria-label|alt|caption|description|empty(?:State)?|helperText|hint|label|message|placeholder|subtitle|summary|text|title)\s*(?:=|:)\s*["'`]([^"'`]{2,})["'`]/g;
  for (const m of line.matchAll(renderedProperty)) {
    const text = m[1].trim();
    if (text.includes("/") || text.startsWith("@")) continue; // path-like, not copy
    out.add(text);
  }
  for (const m of line.matchAll(/>\s*([A-Za-z][^<>{}]{2,})\s*</g)) out.add(m[1].trim());
  return out;
}

/** True when added TSX lines introduce copy a person can read or hear. */
export function addedLinesContainVisibleCopy(lines) {
  return lines.some((line) => visibleCopy(line).size > 0);
}

/**
 * Paths that arrived at their location by a `git mv` that introduced NO new
 * user-visible copy.
 *
 * Rename detection alone is not enough and a raw similarity threshold is the wrong
 * instrument: renaming a frequently-repeated identifier can push a byte-identical
 * move down to ~90% similarity, while a genuinely new control can sit above it.
 * What the gate cares about is whether a new surface appeared, so compare the copy:
 * if every string/JSX text on the added side already existed on the removed side,
 * the move is the same control at a new path. Anything that adds copy still has to
 * prove its fit. Returns the NEW paths.
 */
export function collectCopyPreservingRenames(base, runGit = git) {
  const out = new Set();
  const raw = runGit(
    "diff",
    "--name-status",
    "--find-renames=50%",
    `${base}...HEAD`,
    "--",
    "apps/web/**/*.tsx",
  );
  for (const line of raw.split("\n")) {
    const parts = line.trim().split(/\t+/);
    if (parts.length !== 3 || !/^R\d*$/.test(parts[0])) continue;
    const [, oldPath, newPath] = parts;
    const body = runGit("diff", "--find-renames=50%", `${base}...HEAD`, "--", oldPath, newPath);
    const added = new Set();
    const removed = new Set();
    for (const l of body.split("\n")) {
      if (l.startsWith("+++") || l.startsWith("---")) continue;
      if (l.startsWith("+")) for (const c of visibleCopy(l)) added.add(c);
      else if (l.startsWith("-")) for (const c of visibleCopy(l)) removed.add(c);
    }
    // Compare normalized: a rename re-cases and re-spaces the same words
    // ("Work Room" -> "Workroom", workRoomX -> workroomX). Text that survives
    // normalization as new IS new copy and still needs measured evidence.
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const removedNorm = new Set([...removed].map(norm));
    if ([...added].every((c) => removedNorm.has(norm(c)))) out.add(newPath);
  }
  return out;
}

function main() {
  const base = assertSafeRef(process.env.BASE_SHA || "origin/main", "BASE_SHA");
  // BI-1ADD56FC: never write .git/shallow into a full shared clone (breaks worktrees).
  fetchOriginMainSharedSafe((args) => git(...args));

  const listed = listChangedFiles(base);
  if (listed.status === "unresolvable") exitUnresolvable("ux-fit-gate", base, listed.detail);
  const changed = listed.files
    .filter((f) => f.startsWith("apps/web/") && f.endsWith(".tsx"))
    .filter((f) => !EXCLUDE_RE.test(f));

  const addedFiles = new Set(
    lines(git("diff", "--name-only", "--diff-filter=A", `${base}...HEAD`, "--", "apps/web/**/*.tsx")),
  );

  // A moved file is the SAME control at a new path, not a new one. Without rename
  // detection `git mv` reads as delete+add, so a pure rename would demand fresh
  // measured UX evidence for a screen nobody changed. Forgiven only when the move
  // introduced no new user-visible copy; a move that also added a surface still
  // has to prove its fit.
  const renamedFiles = collectCopyPreservingRenames(base);

  const impactingFiles = [];
  const reasons = new Map();
  for (const f of changed) {
    const safePath = assertSafePath(f);
    if (renamedFiles.has(safePath)) continue;
    const isNewRoute = ROUTE_FILE_RE.test(safePath) && addedFiles.has(safePath);
    const added = git("diff", `${base}...HEAD`, "--", safePath)
      .split("\n")
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"));
    const addsControl = added.some((l) => UI_CONTROL_RE.test(l));
    const addsVisibleCopy = addedLinesContainVisibleCopy(added);
    if (isNewRoute || addsControl || addsVisibleCopy) {
      impactingFiles.push(safePath);
      reasons.set(
        safePath,
        isNewRoute
          ? "new route"
          : addsControl
            ? "adds a user-facing control"
            : "adds user-visible copy",
      );
    }
  }

  // Manifests must be touched by THIS PR, so evidence cannot be recycled.
  const manifestPaths = manifestPathsFromDiff(lines(git("diff", "--name-only", `${base}...HEAD`)));
  const manifests = [];
  for (const p of manifestPaths) {
    try {
      manifests.push({ path: p, manifest: JSON.parse(readFileSync(p, "utf8")) });
    } catch (e) {
      manifests.push({ path: p, manifest: null });
      console.error(`[ux-fit-gate] ${p} is not readable JSON: ${e.message}`);
    }
  }

  let baseline = null;
  try {
    baseline = JSON.parse(readFileSync("apps/web/lib/ux-budget/route-budget-baseline.json", "utf8"));
  } catch {
    /* adjudication is skipped and noted */
  }

  const { ok, errors, notes } = runGate({ impactingFiles, manifests, baseline });

  for (const n of notes) console.log(`[ux-fit-gate] ${n}`);

  if (ok) {
    if (impactingFiles.length > 0) {
      console.log("[ux-fit-gate] UI-impacting change carries measured UX-fit evidence. OK.");
      for (const f of impactingFiles) console.log(`  • ${f} (${reasons.get(f)})`);
      for (const { path } of manifests) console.log(`  ↳ evidence: ${path}`);
    }
    process.exit(0);
  }

  console.error("");
  console.error("[ux-fit-gate] FAILED — UI-impacting change without measured UX-fit evidence.");
  console.error("");
  if (impactingFiles.length > 0) {
    console.error("These changes add user-facing controls / routes:");
    for (const f of impactingFiles) console.error(`  • ${f} (${reasons.get(f)})`);
    console.error("");
  }
  for (const e of errors) console.error(`  - ${e}`);
  console.error("");
  console.error("To resolve — commit a manifest at docs/ux-fit/<date>-<slug>.ux-fit.json:");
  console.error("");
  console.error("  {");
  console.error('    "version": "1",');
  console.error('    "decidedOption": "progressive-disclosure",');
  console.error('    "scope": { "files": ["apps/web/app/(shell)/example/page.tsx"] },');
  console.error('    "evidence": {');
  console.error('      "kind": "sweep-measurement",');
  console.error('      "baselineComparison": "improved",');
  console.error('      "measured": { "/example": {');
  console.error("        " + MEASURED_AXES.map((a) => `"${a}": 0`).join(", "));
  console.error("      } }");
  console.error("    }");
  console.error("  }");
  console.error("");
  console.error("Measure with the UX route sweep (or lib/ux-budget's auditUxBudget on the served");
  console.error("DOM). For a recorded option pick instead, use evidence.kind=propose-n-pick with");
  console.error("decisionInteractionId + consideredOptions.");
  console.error("");
  console.error("An acknowledgement does not qualify, and the UX-Fit-Decision trailer is retired");
  console.error("(BI-D967DEE0): the gate now adjudicates measured numbers against the committed");
  console.error("route-budget baseline, so a screen cannot regress behind a plausible sentence.");
  console.error("");
  process.exit(1);
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("check-ux-fit-decision.mjs")) {
  main();
}
