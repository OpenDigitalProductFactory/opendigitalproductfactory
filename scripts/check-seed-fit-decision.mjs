#!/usr/bin/env node

import { execFileSync } from "node:child_process";

import {
  evaluateSeedFitGate,
  normalizeGithubLabels,
  SEED_FIT_DECISIONS,
} from "./lib/seed-fit-gate.mjs";
import { requireChangedFiles } from "./lib/git-changed-files.mjs";

const REF_RE = /^[A-Za-z0-9._\-/]{1,200}$/;

function safeRef(ref, label) {
  if (!REF_RE.test(ref) || ref.startsWith("-")) {
    throw new Error(`[seed-fit-gate] refusing unsafe ${label}: ${JSON.stringify(ref)}`);
  }
  return ref;
}

function git(...args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (error) {
    return error.stdout?.toString() ?? "";
  }
}

if (process.env.GITHUB_EVENT_NAME && process.env.GITHUB_EVENT_NAME !== "pull_request") {
  console.log("[seed-fit-gate] Non-PR event has no review metadata; PR gate is not applicable.");
  process.exit(0);
}

const base = safeRef(process.env.BASE_SHA || "origin/main", "BASE_SHA");
git("fetch", "--no-tags", "origin", "main");
const changedFiles = requireChangedFiles(base, "seed-fit-gate");

let labels = [];
try {
  const parsed = JSON.parse(process.env.PR_LABELS_JSON || "[]");
  labels = normalizeGithubLabels(parsed);
} catch {
  console.error("[seed-fit-gate] PR_LABELS_JSON is not a JSON array.");
  process.exit(1);
}

const result = evaluateSeedFitGate({
  changedFiles,
  prBody: process.env.PR_BODY || "",
  labels,
});

if (result.ok) {
  if (result.reason === "no-seed-content") {
    console.log("[seed-fit-gate] No canonical seeded-content changes; nothing to gate.");
  } else {
    console.log(`[seed-fit-gate] Seeded-content decision is ${result.decision}. OK.`);
    for (const path of result.seedPaths) console.log(`  - ${path}`);
  }
  process.exit(0);
}

console.error(`[seed-fit-gate] FAILED: ${result.reason}.`);
for (const path of result.seedPaths) console.error(`  - ${path}`);
if (result.reason === "missing-decision") {
  console.error("Add exactly one reviewed `Seed-Fit-Decision: <value>` PR-body trailer or `seed-fit:<value>` label.");
}
if (result.reason === "contradictory-decisions") {
  console.error(`Conflicting decisions: ${result.decisions.join(", ")}`);
}
if (result.reason === "invalid-decision") {
  console.error(`Invalid decisions: ${result.invalid.join(", ")}`);
}
if (result.reason === "decision-not-merge-eligible") {
  console.error(`Decision ${result.decision} requires revision or removal of the seed delta before merge.`);
}
console.error(`Valid values: ${SEED_FIT_DECISIONS.join(", ")}`);
process.exit(1);
