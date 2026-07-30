#!/usr/bin/env node
// scripts/check-ux-fit-decision.mjs
//
// BI-65DEE968 — The un-skippable UX-fit / cognitive-load gate.
//
// THE PROBLEM IT FIXES: AGENTS.md §12 (progressive disclosure), §16
// (dpf-ux-fit-review), and §17 (hide complexity from layman users) are a passive
// document + an advisory skill. A fast, operator-focused build (#2004's Build
// Runtime screen) shipped a raw "Context window: 22000 tokens" input that a
// non-technical user can't answer — the rule existed and nothing enforced it.
//
// THE FIX: enforce the check as EVIDENCE at the one chokepoint every build
// surface (Claude Code / Codex / Grok / Build Studio) must traverse — the PR.
// This gate fails a PR that introduces a UI-impacting change (new user-facing
// form controls, numeric inputs, or new routes) UNLESS a UX-fit / cognitive-load
// decision is attested. It reads the evidence, never which surface produced it
// ("governance approves evidence, not provenance" — AGENTS.md §17).
//
// ATTESTATION: a `UX-Fit-Decision:` trailer in any commit message in the PR
// range, or in the PR body. Authoring that trailer means the author ran the
// ux-fit review (and ideally scored options with principle_decide on the
// human_cognitive_load axis). v1 is a conscious-attestation MVP; a follow-up can
// verify a persisted DecisionInteraction record (BI-65DEE968 §5).

import { execFileSync } from "node:child_process";
import { fetchOriginMainSharedSafe } from "./lib/git-fetch-shared-safe.mjs";

// Canonical sensitivity constants (single source, shared with the gate-context
// pack; the dpf-skill-pack precheck hook keeps a drift-guard-pinned copy).
import {
  UI_CONTROL_RE,
  UX_EXCLUDE_RE as EXCLUDE_RE,
  UX_FIT_ATTESTATION_RE as ATTESTATION_RE,
  UX_ROUTE_FILE_RE as ROUTE_FILE_RE,
} from "./lib/gate-sensitivity.mjs";

// Refs reach us from CI env vars (BASE_SHA) and from git's own output. Pin the
// set of characters we accept so a forged value cannot smuggle shell metachars
// or git option flags through to execFile. (js/indirect-command-line-injection.)
const REF_RE = /^[A-Za-z0-9._\-/]{1,200}$/;
// Repo-relative paths git emits in --name-only. Reject anything that could be
// reinterpreted as a flag or escape the worktree. The character set must include
// Next.js route-segment punctuation — route groups `(shell)` and dynamic/
// catch-all segments `[id]` / `[[...slug]]` — which appear in legitimate
// apps/web/app paths. These chars are inert: execFile uses an arg array (no
// shell), and the leading-`-` guard below still blocks option injection.
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

// execFile with arg array — bypasses the shell entirely, so individual args
// containing $, `, ;, &, |, etc. are inert. The first-arg validator above
// guards against `--upload-pack`-style git option injection on the ref.
function git(...args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    return (e.stdout && e.stdout.toString()) || "";
  }
}

const base = assertSafeRef(process.env.BASE_SHA || "origin/main", "BASE_SHA");
// BI-1ADD56FC: never write .git/shallow into a full shared clone (breaks worktrees).
// Depth is only used when the repo is already shallow (typical GITHUB_ACTIONS checkout).
fetchOriginMainSharedSafe((args) => git(...args));

const changed = git("diff", "--name-only", `${base}...HEAD`, "--", "apps/web/**/*.tsx")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((f) => !EXCLUDE_RE.test(f));

if (changed.length === 0) {
  console.log("[ux-fit-gate] No user-facing apps/web/*.tsx changes — nothing to gate.");
  process.exit(0);
}

const addedFiles = new Set(
  git("diff", "--name-only", "--diff-filter=A", `${base}...HEAD`, "--", "apps/web/**/*.tsx")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean),
);

const impacting = [];
for (const f of changed) {
  const safePath = assertSafePath(f);
  const isNewRoute = ROUTE_FILE_RE.test(safePath) && addedFiles.has(safePath);
  const added = git("diff", `${base}...HEAD`, "--", safePath)
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"));
  const addsControl = added.some((l) => UI_CONTROL_RE.test(l));
  if (isNewRoute || addsControl) {
    impacting.push(safePath + (isNewRoute ? " (new route)" : " (adds a user-facing control)"));
  }
}

if (impacting.length === 0) {
  console.log("[ux-fit-gate] No UI-impacting controls or routes added — nothing to gate.");
  process.exit(0);
}

const commits = git("log", `${base}..HEAD`, "--format=%B");
const prBody = process.env.PR_BODY || "";
const attested = ATTESTATION_RE.test(commits) || ATTESTATION_RE.test(prBody);

if (attested) {
  console.log("[ux-fit-gate] UI-impacting change carries a UX-Fit-Decision attestation. OK.");
  for (const f of impacting) console.log("  • " + f);
  process.exit(0);
}

console.error("");
console.error("[ux-fit-gate] FAILED — UI-impacting change without a recorded UX-fit decision.");
console.error("");
console.error("These changes add user-facing controls / routes:");
for (const f of impacting) console.error("  • " + f);
console.error("");
console.error("Every UI-impacting change must carry a UX-fit / cognitive-load decision so");
console.error("over-exposed screens can't ship (AGENTS.md §12 progressive disclosure, §16");
console.error("dpf-ux-fit-review, §17 hide complexity from layman users).");
console.error("");
console.error("To resolve:");
console.error("  1. Run the UX-fit review (dpf-ux-fit-review skill) and score the options");
console.error("     with principle_decide on the human_cognitive_load axis.");
console.error("  2. Attest the decision — add a trailer to a commit message OR the PR body:");
console.error("       UX-Fit-Decision: <one-line outcome>");
console.error("     e.g.  UX-Fit-Decision: progressive-disclosure (principle_decide, margin 0.85)");
console.error("");
console.error("This gate reads the evidence, not which surface produced it — it applies");
console.error("identically to Claude Code, Codex, Grok, and Build Studio PRs.");
console.error("");
process.exit(1);
