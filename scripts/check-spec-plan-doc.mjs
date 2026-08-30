#!/usr/bin/env node
// scripts/check-spec-plan-doc.mjs
//
// The Spec/Plan/Doc Gate — the un-skippable process-spine enforcement edge.
//
// THE PROBLEM IT FIXES: AGENTS.md §6 (specs/plans), §10 (design research), and
// the dpf-writing-plans / dpf-architecture-review skills are a passive document
// + advisory skills. Build Studio gates these artifacts always-on at its
// Ideate/Plan reviewers; the external surfaces (Claude Code / Codex) only
// produce them "if the agent remembers". The result, observed repeatedly: a
// substantial new capability lands from an external client with NO spec, NO
// plan, and NO documentation touched — the very gap the
// 2026-05-30-development-process-spine-design.md spec diagnosed as
// "enforcement is memory-level, not harness-level" (§5.2). That spec was itself
// authored and then never turned into tracked, enforced work — an orphaned
// draft is the gap eating its own tail.
//
// THE FIX (mirrors the UX-Fit Gate, BI-65DEE968): enforce the discipline as
// EVIDENCE at the one chokepoint every build surface must traverse — the PR
// (AGENTS.md §4, "all changes land via PR"). This gate fails a PR that adds a
// substantial implementation surface (a new source module, a new route, or a
// large in-place rewrite) UNLESS the PR ALSO touches a durable-knowledge
// artifact (a spec, plan, doc, AGENTS.md, a kernel principle, or a SKILL.md) OR
// carries an explicit attestation. It reads the evidence, never which surface
// produced it ("governance approves evidence, not provenance" — AGENTS.md §17),
// so Claude Code, Codex, Grok, and Build Studio are all caught identically.
//
// ATTESTATION: a `Process-Spine-Decision:` trailer in any commit message in the
// PR range, or in the PR body. Authoring it is a conscious statement that the
// author considered the spec/plan/doc obligation and either satisfied it or
// judged it unnecessary (e.g. "trivial bugfix, no doc surface changed"). v1 is a
// conscious-attestation MVP, intentionally the same shape as the UX-Fit gate.
//
// Decision: pr-gate-plus-soft-hook (principle_decide, callingPopulation
// external_coding_agent, profile=platform). The companion soft, non-blocking
// interactive nudge is scripts/hooks/spec-plan-doc-precheck.mjs.

import { execFileSync } from "node:child_process";
import { listChangedFiles } from "./check-doc-anchor-existence.mjs";
import { fetchOriginMainSharedSafe } from "./lib/git-fetch-shared-safe.mjs";
// Canonical sensitivity constants (single source, shared with the gate-context
// pack; the dpf-skill-pack precheck hook keeps a drift-guard-pinned copy).
import {
  ADDED_SOURCE_LINE_THRESHOLD,
  DOC_ARTIFACT_RE,
  NEW_SOURCE_FILE_RE,
  PROCESS_SPINE_ATTESTATION_RE as ATTESTATION_RE,
  SOURCE_LINE_FILE_RE,
} from "./lib/gate-sensitivity.mjs";

// Test/story/generated scaffolding is never "implementation surface" for this
// gate (its own tests, fixtures, snapshots don't imply a missing spec/doc).
const EXCLUDE_RE = /(\.(test|spec|stories)\.(ts|tsx)$|__tests__\/|\.d\.ts$|\/generated\/)/;

// Refs reach us from CI env (BASE_SHA) and git output. Pin accepted chars so a
// forged value cannot smuggle shell metachars or git option flags into execFile.
const REF_RE = /^[A-Za-z0-9._\-/]{1,200}$/;
// Paths are passed to git as a literal pathspec after `--`, via execFile's arg
// array (no shell), so `()[]@` are inert here — but they DO occur in real repo
// paths (Next.js route groups `(shell)`, parallel routes `@slot`, dynamic
// segments `[id]`). Allow them; the leading-"-" guard below still blocks
// option-injection. Without this, the gate throws on any (group)/[param] file.
const PATH_RE = /^[A-Za-z0-9._\-/()[\]@]+$/;

function assertSafeRef(ref, label) {
  if (!REF_RE.test(ref) || ref.startsWith("-")) {
    throw new Error(`[spec-plan-doc-gate] refusing unsafe ${label}: ${JSON.stringify(ref)}`);
  }
  return ref;
}

function assertSafePath(path) {
  if (!PATH_RE.test(path) || path.startsWith("-")) {
    throw new Error(`[spec-plan-doc-gate] refusing unsafe path: ${JSON.stringify(path)}`);
  }
  return path;
}

// execFile with an arg array — bypasses the shell, so $, `, ;, &, | in args are
// inert; the ref validator guards against `--upload-pack`-style option injection.
function git(...args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    return (e.stdout && e.stdout.toString()) || "";
  }
}

const base = assertSafeRef(process.env.BASE_SHA || "origin/main", "BASE_SHA");
// BI-1ADD56FC: never write .git/shallow into a full shared clone (breaks worktrees).
fetchOriginMainSharedSafe((args) => git(...args));

// BI-1DF0BF51: a failed three-dot diff is not "no tracked source changes".
const listed = listChangedFiles(base);
if (listed.status === "unresolvable") {
  console.error(`[spec-plan-doc-gate] cannot resolve ${base} — the guard did not run. This is not a pass.`);
  console.error("[spec-plan-doc-gate] Remedy: git fetch --deepen 50 origin  (or git fetch origin main) and re-run.");
  if (listed.detail) console.error(`[spec-plan-doc-gate] git: ${listed.detail}`);
  process.exit(1);
}
const changed = listed.files.filter((f) => !EXCLUDE_RE.test(f));

if (changed.length === 0) {
  console.log("[spec-plan-doc-gate] No tracked source changes — nothing to gate.");
  process.exit(0);
}

const addedFiles = new Set(
  git("diff", "--name-only", "--diff-filter=A", `${base}...HEAD`)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean),
);

// 1) Does the PR touch a durable-knowledge artifact? That satisfies the gate.
const docTouched = changed.filter((f) => DOC_ARTIFACT_RE.test(f));

// 2) Does the PR introduce a substantial implementation surface?
const newModules = changed.filter((f) => addedFiles.has(f) && NEW_SOURCE_FILE_RE.test(f));

let addedSourceLines = 0;
for (const f of changed) {
  if (!SOURCE_LINE_FILE_RE.test(f)) continue;
  const safePath = assertSafePath(f);
  // --literal-pathspecs so a path like [taskId] is matched literally and not
  // treated as a git pathspec glob (which would silently count zero lines).
  const added = git("--literal-pathspecs", "diff", "--numstat", `${base}...HEAD`, "--", safePath)
    .split("\n")[0]
    ?.trim();
  if (!added) continue;
  const n = Number.parseInt(added.split("\t")[0], 10);
  if (Number.isFinite(n)) addedSourceLines += n;
}

const substantial = [];
for (const f of newModules) substantial.push(`${f} (new source module/route/migration)`);
if (addedSourceLines >= ADDED_SOURCE_LINE_THRESHOLD) {
  substantial.push(`+${addedSourceLines} source lines added (≥ ${ADDED_SOURCE_LINE_THRESHOLD} threshold)`);
}

if (substantial.length === 0) {
  console.log("[spec-plan-doc-gate] No substantial implementation surface added — nothing to gate.");
  process.exit(0);
}

if (docTouched.length > 0) {
  console.log("[spec-plan-doc-gate] Substantial change carries a spec/plan/doc touch. OK.");
  for (const f of docTouched) console.log("  • doc: " + f);
  process.exit(0);
}

const commits = git("log", `${base}..HEAD`, "--format=%B");
const prBody = process.env.PR_BODY || "";
const attested = ATTESTATION_RE.test(commits) || ATTESTATION_RE.test(prBody);

if (attested) {
  console.log("[spec-plan-doc-gate] Substantial change carries a Process-Spine-Decision attestation. OK.");
  process.exit(0);
}

console.error("");
console.error("[spec-plan-doc-gate] FAILED — substantial change with no spec/plan/doc and no attestation.");
console.error("");
console.error("This PR adds a substantial implementation surface:");
for (const f of substantial) console.error("  • " + f);
console.error("");
console.error("...but touches no durable-knowledge artifact (a spec, plan, doc, AGENTS.md,");
console.error("a kernel principle, or a SKILL.md). DPF treats specs, plans, and documentation");
console.error("as intrinsic platform resources (AGENTS.md §6 / §10): a new capability that");
console.error("lands undocumented is the external-client process gap this gate exists to close.");
console.error("");
console.error("To resolve, do ONE of:");
console.error("  1. Write/update the spec or plan (dpf-writing-plans skill → docs/superpowers/");
console.error("     specs|plans/) or update the affected doc / AGENTS.md / SKILL.md, and include");
console.error("     it in this PR. This is the intended path for a real new capability.");
console.error("  2. If the change genuinely needs no spec/plan/doc update (e.g. a trivial fix),");
console.error("     attest it — add a trailer to a commit message OR the PR body:");
console.error("       Process-Spine-Decision: <one-line reason>");
console.error("     e.g.  Process-Spine-Decision: localized bugfix, no contract/doc surface changed");
console.error("");
console.error("This gate reads the evidence, not which surface produced it — it applies");
console.error("identically to Claude Code, Codex, Grok, and Build Studio PRs (AGENTS.md §17).");
console.error("");
process.exit(1);
