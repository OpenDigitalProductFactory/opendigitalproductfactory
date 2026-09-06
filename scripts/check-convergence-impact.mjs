#!/usr/bin/env node
// scripts/check-convergence-impact.mjs
//
// Convergence-Impact Gate (BI-B19BE117) — deployment truth as a per-PR question.
//
// THE PROBLEM IT FIXES: every PR is reviewed for whether the change is correct.
// Nothing asks how an install created three versions ago arrives at the same
// state. Changes land in source, reach a FRESH install via the installer, and
// silently never reach the installs that already exist. It keeps surfacing as
// individual defects, each found by biting someone: BI-3727106F (hook
// convergence was install-time only), BI-BE8BBDE9 (existing installs cannot
// self-upgrade into the install-state migration), BI-922EBB99 (retired
// datastores left orphaned on existing installs), #3262 (a compose volume var
// never provisioned on existing installs). Deployments are cumulative: any
// install may upgrade from any past version, so each increment has to state
// how it converges.
//
// THE FIX: at the one chokepoint every surface traverses — the PR — classify
// the changed files against a NARROW registry of install-reachable surfaces
// (scripts/convergence-surfaces.json) and, when one is hit, require a
// `Convergence-Impact-Decision:` trailer in a commit message or the PR body
// that names a closed mode and the mechanism or reason. The trailer is the
// durable record an AI coworker can reason over later; it replaces release
// notes and human memory, which is where this knowledge lives today.
//
// It is the sibling of the Data-Impact Gate (scripts/check-data-impact.mjs),
// which owns the six persistent DATA surfaces and demands a JSON manifest.
// This gate owns everything else that needs install-side convergence and
// demands a trailer. Kernel decisions DI-9DF1A83ECACD (blocking, narrow
// classifier — not shadow) and DI-91594F6EF8FA (sibling, not folded in).
//
// Reads the evidence, not which surface produced it (governance-approves-
// evidence-not-provenance): identical for Claude Code, Codex, Grok, Build Studio.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { listChangedFiles } from "./lib/git-changed-files.mjs";
import { findCanonicalSeedContentPaths } from "./lib/seed-fit-gate.mjs";
import { PR_TRAILER_NAMES } from "./lib/pr-trailer-contract.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY_PATH = path.join(REPO_ROOT, "scripts", "convergence-surfaces.json");

export const TRAILER_NAME = PR_TRAILER_NAMES.convergenceImpact;
const TRAILER_RE = new RegExp(`^[ \\t]*${TRAILER_NAME}:[ \\t]*(.+?)[ \\t]*$`, "gim");

/**
 * Closed set of decisions. Each answers "how does an install that already
 * exists end up in the state this PR describes?" The reason names the
 * mechanism (auto-converges), the step (self-upgrade-step), the runbook
 * (operator-action), or the argument (fresh-install-only, not-reachable).
 */
export const CONVERGENCE_MODES = Object.freeze({
  "auto-converges": "an existing mechanism carries the change on the next upgrade — NAME it (promoter compose-from-release, session-start hook converger, seed re-run on boot, install-state migration edge …)",
  "self-upgrade-step": "this PR adds or changes the promoter / migration step that carries it — name the step",
  "operator-action": "an operator must do something on each existing install — name the action and the runbook that documents it",
  "fresh-install-only": "the surface does not exist on installs created before this PR and they do not need it — say why",
  "not-reachable": "the matched file is not actually deployed to installs (classifier false positive) — say why, so the registry can be tightened",
});
export const MIN_REASON_LENGTH = 20;

// ── Registry ──────────────────────────────────────────────────────────────────
export function loadRegistry(registryPath = REGISTRY_PATH) {
  const parsed = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  if (parsed.schemaVersion !== 1) throw new Error(`convergence-surfaces.json: unsupported schemaVersion ${parsed.schemaVersion}`);
  return parsed;
}

/**
 * Single-file COPY sources from a Dockerfile: `COPY a b c ./dest` yields a, b, c.
 * Directory sources (trailing slash or no extension) are skipped — they are app
 * source reached by the normal image rebuild, not files copied BY NAME.
 */
export function parseDockerfileCopySources(dockerfileText) {
  const sources = new Set();
  for (const rawLine of dockerfileText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!/^(COPY|ADD)\s/i.test(line)) continue;
    const parts = line.split(/\s+/).slice(1).filter((p) => !p.startsWith("--"));
    if (parts.length < 2) continue;
    for (const src of parts.slice(0, -1)) {
      if (src.endsWith("/")) continue;
      if (!path.posix.basename(src).includes(".")) continue; // bare dir name
      sources.add(src.replace(/^\.\//, ""));
    }
  }
  return [...sources];
}

function imageCopiedFiles(registry, readFile) {
  const spec = registry.imageCopy ?? {};
  const out = new Set();
  for (const df of spec.dockerfiles ?? []) {
    let text;
    try { text = readFile(df); } catch { continue; }
    for (const src of parseDockerfileCopySources(text)) {
      if ((spec.ignorePrefixes ?? []).some((p) => src.startsWith(p))) continue;
      if ((spec.ignoreFiles ?? []).includes(src)) continue;
      out.add(src);
    }
  }
  return out;
}

/**
 * Classify changed files into convergence surfaces.
 * Returns [{ kind, files }] — kinds hit, with the files that hit them.
 */
export function classifyConvergenceSurfaces(changedFiles, { registry, readFile } = {}) {
  const reg = registry ?? loadRegistry();
  const read = readFile ?? ((f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8"));
  const excludes = (reg.excludePatterns ?? []).map((p) => new RegExp(p));
  const candidates = changedFiles.filter((f) => !excludes.some((re) => re.test(f)));
  const hits = new Map();
  const add = (kind, file) => {
    if (!hits.has(kind)) hits.set(kind, new Set());
    hits.get(kind).add(file);
  };

  for (const surface of reg.surfaces ?? []) {
    const res = surface.patterns.map((p) => new RegExp(p));
    for (const f of candidates) if (res.some((re) => re.test(f))) add(surface.kind, f);
  }

  const copied = imageCopiedFiles(reg, read);
  for (const f of candidates) if (copied.has(f)) add("image-copied-by-name", f);

  if (reg.seedContent) {
    for (const f of findCanonicalSeedContentPaths(candidates)) add("seed-content", f);
  }

  return [...hits].map(([kind, files]) => ({ kind, files: [...files].sort() }));
}

// ── Trailer ───────────────────────────────────────────────────────────────────
/**
 * Extract every `Convergence-Impact-Decision:` trailer from free text.
 * Accepted shapes after the colon: `<mode> — <reason>`, `<mode>: <reason>`,
 * `<mode> (<reason>)`, `<mode> <reason>`.
 */
export function parseConvergenceDecisions(text) {
  const decisions = [];
  for (const m of String(text ?? "").matchAll(TRAILER_RE)) {
    const value = m[1].trim();
    const mm = /^([a-z][a-z-]*)\s*(?:[—:–-]\s*|\(\s*)?(.*?)\)?$/s.exec(value);
    if (!mm) { decisions.push({ raw: value, mode: null, reason: "" }); continue; }
    decisions.push({ raw: value, mode: mm[1], reason: mm[2].trim() });
  }
  return decisions;
}

export function validateConvergenceDecisions(decisions) {
  const errors = [];
  if (decisions.length === 0) return ["no Convergence-Impact-Decision trailer found"];
  decisions.forEach((d, i) => {
    const at = `decision[${i}] "${d.raw}"`;
    if (!d.mode || !Object.hasOwn(CONVERGENCE_MODES, d.mode)) {
      errors.push(`${at}: mode must be one of ${Object.keys(CONVERGENCE_MODES).join(" | ")}`);
      return;
    }
    if (d.reason.length < MIN_REASON_LENGTH) {
      errors.push(`${at}: needs a reason of at least ${MIN_REASON_LENGTH} characters — ${CONVERGENCE_MODES[d.mode]}`);
    }
  });
  return errors;
}

// ── Gate ──────────────────────────────────────────────────────────────────────
export function evaluateConvergenceGate({ changedFiles, commitMessages = "", prBody = "", registry, readFile } = {}) {
  const surfaces = classifyConvergenceSurfaces(changedFiles, { registry, readFile });
  if (surfaces.length === 0) return { ok: true, reason: "no-convergence-surface", surfaces, decisions: [] };
  const decisions = [...parseConvergenceDecisions(commitMessages), ...parseConvergenceDecisions(prBody)];
  const errors = validateConvergenceDecisions(decisions);
  if (errors.length > 0) {
    return { ok: false, reason: decisions.length === 0 ? "missing-decision" : "invalid-decision", surfaces, decisions, errors };
  }
  return { ok: true, reason: "attested", surfaces, decisions };
}

// ── CI entrypoint ─────────────────────────────────────────────────────────────
const REF_RE = /^[A-Za-z0-9._\-/]{1,200}$/;
function assertSafeRef(ref, label) {
  if (!REF_RE.test(ref) || ref.startsWith("-")) throw new Error(`[convergence-impact-gate] refusing unsafe ${label}: ${JSON.stringify(ref)}`);
  return ref;
}
function git(...args) {
  try {
    return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    return (e.stdout && e.stdout.toString()) || "";
  }
}

export function runGate({ base = process.env.BASE_SHA || "origin/main", changed, commitMessages, prBody = process.env.PR_BODY || "" } = {}) {
  assertSafeRef(base, "BASE_SHA");
  let files = changed;
  if (!files) {
    const listed = listChangedFiles(base);
    if (listed.status === "unresolvable") {
      return { ok: false, reason: "unresolvable-base", message: `cannot resolve ${base} — the guard did not run. This is not a pass. Remedy: git fetch --deepen 50 origin.` };
    }
    files = listed.files;
  }
  const commits = commitMessages ?? git("log", `${base}..HEAD`, "--format=%B");
  return evaluateConvergenceGate({ changedFiles: files, commitMessages: commits, prBody });
}

function describe(result) {
  const lines = [];
  for (const s of result.surfaces) {
    lines.push(`  • ${s.kind}`);
    for (const f of s.files) lines.push(`      ${f}`);
  }
  return lines.join("\n");
}

function main() {
  const result = runGate();
  const tag = "[convergence-impact-gate]";
  if (result.reason === "unresolvable-base") {
    console.error(`${tag} ${result.message}`);
    process.exit(1);
  }
  if (result.reason === "no-convergence-surface") {
    console.log(`${tag} No install-reachable surface changed — nothing to gate.`);
    process.exit(0);
  }
  if (result.ok) {
    console.log(`${tag} Install-reachable surface(s) changed and the PR states how existing installs converge. OK.`);
    console.log(describe(result));
    for (const d of result.decisions) console.log(`  ${TRAILER_NAME}: ${d.mode} — ${d.reason}`);
    process.exit(0);
  }
  console.error("");
  console.error(`${tag} FAILED — this PR changes a surface that reaches existing installs only through some convergence mechanism, and does not say which.`);
  console.error("");
  console.error(describe(result));
  console.error("");
  for (const e of result.errors) console.error(`  ✗ ${e}`);
  console.error("");
  console.error("Deployments are cumulative: any install may upgrade from any past version. State how an");
  console.error("install created before this PR arrives at the state this PR describes. Add a trailer to a");
  console.error("commit message or the PR body:");
  console.error("");
  console.error(`    ${TRAILER_NAME}: <mode> — <mechanism or reason, ${MIN_REASON_LENGTH}+ chars>`);
  console.error("");
  for (const [mode, help] of Object.entries(CONVERGENCE_MODES)) console.error(`    ${mode.padEnd(19)} ${help}`);
  console.error("");
  console.error(`  e.g. ${TRAILER_NAME}: auto-converges — promote.sh composes from the new release assets, so the new service starts on the next self-upgrade`);
  console.error(`  e.g. ${TRAILER_NAME}: operator-action — existing installs must add DPF_STATE_DIR to .env; documented in docs/operations/self-upgrade-runbook.md`);
  console.error("");
  console.error("This gate reads the evidence, not which surface produced it. The Data-Impact Gate owns the");
  console.error("persistent DATA surfaces (schema/migration/projection); this one owns everything else that");
  console.error("must converge on an existing install. Registry: scripts/convergence-surfaces.json.");
  console.error("");
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("check-convergence-impact.mjs")) {
  main();
}
