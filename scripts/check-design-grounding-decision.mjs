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

export const DESIGN_GROUNDING_RE = /(?:^|\n)\s*(?:#{1,6}\s*)?Design[ -]Grounding(?:-Decision)?:/i;
export const DESIGN_GROUNDING_HEADING_RE = /(?:^|\n)\s*#{1,6}\s+Design grounding\b/i;
export const OPERATIONAL_PRECEDENT_RE =
  /(?:^|\n)\s*Operational-Precedent:\s*(?:[a-z0-9][a-z0-9-]*|no-precedent\s*\([^)\n]{20,}\))\s*(?:\n|$)/i;
export const SPEC_EVIDENCE_RE =
  /existing specs?\/plans? reviewed|specs?\/plans? reviewed|search_specs_and_plans|docs\/superpowers\/(?:specs|plans)\//i;
export const CODE_EVIDENCE_RE =
  /current code substrate reviewed|code substrate|code graph|search_code_graph|\brg\s+-n|apps\/web\/|packages\/[^/\s]+\/src\//i;

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

export function hasDesignGroundingEvidence(text) {
  const t = String(text ?? "");
  const marker = DESIGN_GROUNDING_RE.test(t) || DESIGN_GROUNDING_HEADING_RE.test(t);
  return marker && SPEC_EVIDENCE_RE.test(t) && CODE_EVIDENCE_RE.test(t);
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

export function decide({ changedFiles = [], evidenceText = "" } = {}) {
  const { designSensitive, physicalTwin } = classifyChangedFiles(changedFiles);
  if (designSensitive.length === 0) {
    return { ok: true, reason: "no-design-sensitive-files", designSensitive, physicalTwin };
  }
  if (!hasDesignGroundingEvidence(evidenceText)) {
    return { ok: false, reason: "missing-design-grounding", designSensitive, physicalTwin };
  }
  if (physicalTwin.length > 0 && !hasOperationalPrecedentEvidence(evidenceText)) {
    return { ok: false, reason: "missing-operational-precedent", designSensitive, physicalTwin };
  }
  return {
    ok: true,
    reason: physicalTwin.length > 0
      ? "design-grounding-and-operational-precedent"
      : "design-grounding-evidence",
    designSensitive,
    physicalTwin,
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

  const changedFiles = git("diff", "--name-only", `${base}...HEAD`)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(assertSafePath);

  const commits = git("log", `${base}..HEAD`, "--format=%B");
  const prBody = process.env.PR_BODY || "";
  const evidenceText = [prBody, commits, readEvidenceFromChangedDocs(changedFiles)].join("\n\n");

  const verdict = decide({ changedFiles, evidenceText });
  if (verdict.ok) {
    if (verdict.reason === "no-design-sensitive-files") {
      console.log("[design-grounding-gate] No UX/workflow/queue/navigation/process-spine files changed — nothing to gate.");
    } else {
      console.log("[design-grounding-gate] Design-sensitive change carries design-grounding evidence. OK.");
      for (const f of verdict.designSensitive) console.log("  • " + f);
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
  console.error("Before changing these surfaces, DPF requires the PR to state which existing");
  console.error("specs/plans and current code substrate were reviewed. This prevents a new");
  console.error("thread from inventing UX or queue behavior without first grounding in the");
  console.error("platform architecture.");
  console.error("");
  console.error("Add this to the PR body, a commit message, or a touched durable doc:");
  console.error("");
  console.error(ATTESTATION_HELP);
  console.error("");
  console.error("For trivial no-contract-change edits, use:");
  console.error("  Design-Grounding-Decision: reviewed <specs/code>; localized copy-only fix, no contract or routing change.");
  console.error("");
  process.exit(1);
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("check-design-grounding-decision.mjs")) {
  main();
}
