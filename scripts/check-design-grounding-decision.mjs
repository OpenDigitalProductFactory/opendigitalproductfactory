#!/usr/bin/env node
// scripts/check-design-grounding-decision.mjs
//
// The Design Grounding Gate — the process-spine edge that proves an agent
// reviewed existing design + code substrate before changing UX/workflow/queue
// surfaces. Spec/Plan/Doc proves a durable artifact or attestation exists;
// UX-Fit proves cognitive-load review happened. This gate closes the seam
// between them: "what existing spec and code did you ground against?"

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fetchOriginMainSharedSafe } from "./lib/git-fetch-shared-safe.mjs";
import { requireChangedFiles } from "./lib/git-changed-files.mjs";

export const DESIGN_GROUNDING_RE = /(?:^|\n)\s*(?:#{1,6}\s*)?Design[ -]Grounding(?:-Decision)?:/i;
export const DESIGN_GROUNDING_HEADING_RE = /(?:^|\n)\s*#{1,6}\s+Design grounding\b/i;
export const OPERATIONAL_PRECEDENT_RE =
  /(?:^|\n)\s*Operational-Precedent:\s*(?:[a-z0-9][a-z0-9-]*|no-precedent\s*\([^)\n]{20,}\))\s*(?:\n|$)/i;
export const SPEC_EVIDENCE_RE =
  /existing specs?\/plans? reviewed|specs?\/plans? reviewed|search_specs_and_plans|docs\/superpowers\/(?:specs|plans)\//i;
export const CODE_EVIDENCE_RE =
  /current code substrate reviewed|code substrate|code graph|search_code_graph|mcp packs?|\brg\s+-n|apps\/web\/|packages\/[^/\s]+\//i;

// The trivial escape hatch: a marker plus an explicit no-contract-change (or
// "trivial") declaration carrying a parenthetical reason of at least 20
// characters. Mirrors the OPERATIONAL_PRECEDENT no-precedent form so a genuinely
// localized copy-only edit does not have to manufacture spec+code tokens.
export const TRIVIAL_NO_CONTRACT_RE =
  /(?:^|\n)\s*(?:#{1,6}\s*)?Design[ -]Grounding(?:-Decision)?:\s*(?:trivial|no[ -]contract[ -]change)\b[^\n]*\([^)\n]{20,}\)/i;

const ATTESTATION_HELP = `## Design grounding

- Existing specs/plans reviewed:
  - ...
- Current code substrate reviewed:
  - ...
- Source of truth:
  - ...
- Decision:
  - ...`;

// User-facing route/component/workflow/queue/attention files where a change is
// likely to need design grounding. Keep this narrower than "all source" so the
// gate is a targeted process-spine guard, not a generic paperwork tax.
export const DESIGN_SENSITIVE_FILE_RE =
  /^(apps\/web\/app\/.*\/page\.tsx|apps\/web\/components\/.*\.(tsx|ts)|apps\/web\/lib\/(?:attention|work-management|founder-review|navigation|wiki|mcp\/packs|tak)\/.*\.(ts|tsx)|scripts\/check-(?:spec-plan-doc|ux-fit|design-grounding).*\.mjs|packages\/dpf-skill-pack\/hooks\/.*\.(mjs|json)|packages\/storefront-templates\/src\/(?:twin-profile|business-view-profile)\.ts)$/;

const PHYSICAL_TWIN_FILE_RE =
  /^(apps\/web\/components\/twin\/.*\.(ts|tsx)|apps\/web\/.*OperationalScene.*\.(ts|tsx)|packages\/storefront-templates\/src\/(?:twin-profile|business-view-profile)\.ts)$/;

const DOC_EVIDENCE_FILE_RE =
  /^(docs\/.*\.(md|html)|AGENTS\.md|.*\/AGENTS\.md|docs\/founder-kernel\/wiki\/principles\/.*\.md|packages\/dpf-skill-pack\/skills\/.*\/SKILL\.md|skills\/.*\.skill\.md)$/;

const EXCLUDE_RE = /(\.(test|spec|stories)\.(ts|tsx|mjs)$|__tests__\/|\.d\.ts$|\/generated\/)/;
const REF_RE = /^[A-Za-z0-9._\-/]{1,200}$/;
const PATH_RE = /^[A-Za-z0-9._\-/()[\]@]+$/;

function assertSafeRef(ref, label) {
  if (!REF_RE.test(ref) || ref.startsWith("-")) {
    throw new Error(`[design-grounding-gate] refusing unsafe ${label}: ${JSON.stringify(ref)}`);
  }
  return ref;
}

function assertSafePath(path) {
  if (!PATH_RE.test(path) || path.startsWith("-")) {
    throw new Error(`[design-grounding-gate] refusing unsafe path: ${JSON.stringify(path)}`);
  }
  return path;
}

function git(...args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    return (e.stdout && e.stdout.toString()) || "";
  }
}

// Break the evidence check into its three independent conditions so the gate can
// tell an author exactly which one is unmet instead of a single opaque failure.
export function analyzeDesignGroundingEvidence(text) {
  const t = String(text ?? "");
  const marker = DESIGN_GROUNDING_RE.test(t) || DESIGN_GROUNDING_HEADING_RE.test(t);
  const spec = SPEC_EVIDENCE_RE.test(t);
  const code = CODE_EVIDENCE_RE.test(t);
  const trivial = TRIVIAL_NO_CONTRACT_RE.test(t);
  // Full grounding needs marker + spec + code; the trivial path needs marker +
  // an explicit no-contract-change declaration with a reason.
  const ok = marker && (trivial || (spec && code));
  const missing = [];
  if (!marker) missing.push("marker");
  if (!trivial) {
    if (!spec) missing.push("spec-evidence");
    if (!code) missing.push("code-evidence");
  }
  return { ok, marker, spec, code, trivial, missing };
}

export function hasDesignGroundingEvidence(text) {
  return analyzeDesignGroundingEvidence(text).ok;
}

export function hasOperationalPrecedentEvidence(text) {
  return OPERATIONAL_PRECEDENT_RE.test(String(text ?? ""));
}

export function classifyChangedFiles(files) {
  const normalized = files
    .map((f) => String(f ?? "").trim().replace(/\\/g, "/"))
    .filter(Boolean)
    .filter((f) => !EXCLUDE_RE.test(f));
  return {
    designSensitive: normalized.filter((f) => DESIGN_SENSITIVE_FILE_RE.test(f)),
    physicalTwin: normalized.filter((f) => PHYSICAL_TWIN_FILE_RE.test(f)),
    evidenceFiles: normalized.filter((f) => DOC_EVIDENCE_FILE_RE.test(f)),
  };
}

// evidenceSources, when provided, lets the gate distinguish durable attestation
// (PR body + commit trailers, which survive main absorbing a doc) from evidence
// that lives only in a changed doc (which stops counting once main absorbs it,
// because this gate reads docs from the base...HEAD diff). evidenceText remains
// the backward-compatible single-string entry point for unit tests.
export function decide({ changedFiles = [], evidenceText = "", evidenceSources = null } = {}) {
  const { designSensitive, physicalTwin } = classifyChangedFiles(changedFiles);
  if (designSensitive.length === 0) {
    return { ok: true, reason: "no-design-sensitive-files", designSensitive, physicalTwin };
  }

  const durableText = evidenceSources
    ? [evidenceSources.prBody, evidenceSources.commits].filter(Boolean).join("\n\n")
    : evidenceText;
  const diffDocText = evidenceSources ? String(evidenceSources.changedDocText ?? "") : "";
  const combinedText = evidenceSources
    ? [durableText, diffDocText].filter(Boolean).join("\n\n")
    : evidenceText;

  const analysis = analyzeDesignGroundingEvidence(combinedText);
  if (!analysis.ok) {
    return { ok: false, reason: "missing-design-grounding", missing: analysis.missing, analysis, designSensitive, physicalTwin };
  }

  // The grounding evidence passed only because a changed doc carried it — flag it
  // so the author moves the attestation to a durable trailer before main absorbs
  // the doc and silently drops the evidence.
  const warnDiffDocOnly = evidenceSources ? !analyzeDesignGroundingEvidence(durableText).ok : false;

  if (physicalTwin.length > 0 && !hasOperationalPrecedentEvidence(combinedText)) {
    return { ok: false, reason: "missing-operational-precedent", designSensitive, physicalTwin, warnDiffDocOnly };
  }
  return {
    ok: true,
    reason: physicalTwin.length > 0
      ? "design-grounding-and-operational-precedent"
      : "design-grounding-evidence",
    designSensitive,
    physicalTwin,
    warnDiffDocOnly,
  };
}

function readEvidenceFromChangedDocs(files) {
  const chunks = [];
  for (const f of files) {
    if (!DOC_EVIDENCE_FILE_RE.test(f)) continue;
    const safePath = assertSafePath(f);
    try {
      chunks.push(readFileSync(safePath, "utf8"));
    } catch {
      // File may have been deleted/renamed in diff. Ignore; PR body/commits can
      // still carry evidence.
    }
  }
  return chunks.join("\n\n");
}

function main() {
  const base = assertSafeRef(process.env.BASE_SHA || "origin/main", "BASE_SHA");
  // BI-1ADD56FC: never write .git/shallow into a full shared clone.
  fetchOriginMainSharedSafe((args) => git(...args));

  const changedFiles = requireChangedFiles(base, "design-grounding-gate").map(assertSafePath);

  const commits = git("log", `${base}..HEAD`, "--format=%B");
  const prBody = process.env.PR_BODY || "";
  const changedDocText = readEvidenceFromChangedDocs(changedFiles);
  const evidenceSources = { prBody, commits, changedDocText };

  const verdict = decide({ changedFiles, evidenceSources });
  if (verdict.ok) {
    if (verdict.reason === "no-design-sensitive-files") {
      console.log("[design-grounding-gate] No UX/workflow/queue/navigation/process-spine files changed — nothing to gate.");
    } else {
      console.log("[design-grounding-gate] Design-sensitive change carries design-grounding evidence. OK.");
      for (const f of verdict.designSensitive) console.log("  • " + f);
      if (verdict.warnDiffDocOnly) {
        console.warn("");
        console.warn("[design-grounding-gate] WARNING — the only grounding attestation is in a changed doc.");
        console.warn("This gate reads doc evidence from the base...HEAD diff, so the attestation STOPS");
        console.warn("counting once main absorbs that doc. Put it in a durable place the gate always sees:");
        console.warn("a commit-message trailer or the PR body (a 'Design-Grounding-Decision:' line).");
      }
    }
    process.exit(0);
  }

  console.error("");
  if (verdict.reason === "missing-operational-precedent") {
    console.error("[design-grounding-gate] FAILED — physical-twin change without operational precedent evidence.");
    console.error("");
    console.error("Add an evidence pack from design intelligence:");
    console.error("  Operational-Precedent: restaurant-floor");
    console.error("");
    console.error("If no incumbent spatial workflow exists, record the researched absence and fallback:");
    console.error("  Operational-Precedent: no-precedent (reason of at least 20 characters)");
    console.error("");
    process.exit(1);
  }
  console.error("[design-grounding-gate] FAILED — design-sensitive change without design-grounding evidence.");
  console.error("");
  console.error("These files affect UX, workflow, queues, navigation, attention, or the process spine:");
  for (const f of verdict.designSensitive) console.error("  • " + f);
  console.error("");

  // Tell the author exactly which of the three independent conditions is unmet,
  // instead of a single opaque "missing evidence" verdict.
  const a = verdict.analysis || { marker: false, spec: false, code: false };
  const row = (ok, label, hint) =>
    `  ${ok ? "✓" : "✗"} ${label.padEnd(14)} ${ok ? "found" : "MISSING — " + hint}`;
  console.error("Evidence check — need marker + spec-evidence + code-evidence (or the trivial path below):");
  console.error(row(a.marker, "marker", 'add a "Design-Grounding-Decision:" trailer, or a "## Design grounding" heading'));
  console.error(row(a.spec, "spec-evidence", 'literal "specs/plans reviewed", or a docs/superpowers/(specs|plans)/… path'));
  console.error(row(a.code, "code-evidence", 'literal "code substrate", or an apps/web/… or packages/<x>/… path'));
  console.error("");
  console.error("Accepted example (put in the PR body or a commit message, not only a diff-doc):");
  console.error("");
  console.error(ATTESTATION_HELP);
  console.error("");
  console.error("Trivial no-contract-change path — marker + a reason of 20+ chars, no spec/code tokens needed:");
  console.error("  Design-Grounding-Decision: no-contract-change (localized copy-only fix; no routing or contract change)");
  console.error("");
  process.exit(1);
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("check-design-grounding-decision.mjs")) {
  main();
}
