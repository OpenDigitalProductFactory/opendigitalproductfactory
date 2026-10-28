#!/usr/bin/env node
// scripts/derived-artifacts-gate.mjs
//
// BI-48768E05 — the single driver .githooks/pre-commit, .githooks/pre-push-gate,
// and CI all call into the derived-artifact registry
// (scripts/lib/derived-artifacts-registry.mjs) through. Adding a generator to
// the registry is what enrolls it everywhere at once; this file has no
// per-artifact knowledge.
//
// Subcommands:
//   regenerate-staged     pre-commit: for every registered artifact whose
//                         sources are staged, run its generate command and
//                         `git add` the result. Prints exactly what it did,
//                         itemized — mirrors the pre-commit Guard 2 (Prisma
//                         client) precedent: loud, never silent, fast.
//   push-exempt <baseRef> pre-push gate: decide whether the diff since
//                         baseRef needs the local-CI sandbox gate. Replaces
//                         the old docs-only path-regex exemption — "docs
//                         changed" is no longer treated as inherently
//                         runtime-safe; a docs change that is a registered
//                         artifact's source must pass that artifact's check.
//                         Registered artifact OUTPUTS (BI-AC48D79F) are not
//                         "runtime changes"; they ride with the docs source.
//   check-all             CI: run every registered artifact's check command.
//   list                  print the registry as JSON (debugging / CI
//                         visibility).
//
// Zero external dependencies.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { DERIVED_ARTIFACTS, affectedEntries, matchesAnyGlob } from "./lib/derived-artifacts-registry.mjs";
import { resolveHostCommandInvocation } from "./lib/host-command-invocation.mjs";
import { availableMermaidRenderer } from "./lib/mermaid-renderer.mjs";
import { gitText, gitTextOrNull } from "./lib/git.mjs";
import { classifySpawnResult, SPAWN_OUTCOME } from "./check-guards.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ── pure planning helpers (unit-tested without touching git/subprocesses) ──

/**
 * Decide what regenerate-staged should do for each artifact affected by
 * `stagedFiles`, given a `binaryAvailable(name)` predicate (injectable so
 * tests don't depend on the host's PATH / node_modules).
 *
 * Returns [{ entry, action }] where action is one of:
 *   "regenerate"          — run entry.generate, then stage entry.artifactPaths
 *   "advisory"            — sources changed but entry.autoStage === false;
 *                           print guidance, do not run generate
 *   "skip-missing-binary" — entry.requiresBinary is unavailable; print a
 *                           skip notice, do not run generate, do not fail
 */
export function planRegenerate(stagedFiles, registry = DERIVED_ARTIFACTS, binaryAvailable = () => true) {
  return affectedEntries(stagedFiles, registry).map((entry) => {
    if (entry.requiresBinary && !binaryAvailable(entry.requiresBinary)) {
      return { entry, action: "skip-missing-binary" };
    }
    if (entry.autoStage === false) {
      return { entry, action: "advisory" };
    }
    return { entry, action: "regenerate" };
  });
}

/**
 * Decide whether a push needs the local-CI sandbox gate.
 *
 * `diffFiles` is the full changed-file list since the comparison base.
 * `runCheck(entry)` returns true if the artifact is fresh (check passes).
 *
 * Mirrors the pre-existing docs-only semantics for genuinely non-doc runtime
 * code (still requires the gate — this function does not relax that), and
 * replaces the assumption "docs-only diff => safe" with "docs-only diff AND
 * no registered artifact invalidated by it is stale => safe".
 */
function isRegisteredArtifactOutput(filePath, registry) {
  return registry.some((entry) => matchesAnyGlob(filePath, entry.artifactPaths ?? []));
}

export function evaluatePushExemption(diffFiles, registry = DERIVED_ARTIFACTS, runCheck = () => true) {
  // BI-AC48D79F: registered artifact outputs (e.g. doc-index.generated.json)
  // are regenerated and staged by pre-commit when their docs sources change.
  // They are not runtime sources. Counting them as "non-docs runtime" made
  // the freshness branch unreachable, so every indexed-docs push needed a
  // sandbox gate or an override.
  const nonDocChanges = diffFiles.filter(
    (f) => !isRegisteredArtifactOutput(f, registry) && !/^docs\/|^memory\/|\.md$/.test(f),
  );
  if (nonDocChanges.length > 0) {
    return { exempt: false, reason: "non-docs runtime changes present", files: nonDocChanges };
  }

  const affected = affectedEntries(diffFiles, registry);
  const checked = affected.map((entry) => ({
    entry,
    outcome: normalizeDerivedCheckResult(runCheck(entry)),
  }));
  const stale = checked.filter((row) => row.outcome === "stale").map((row) => row.entry);
  if (stale.length > 0) {
    return {
      exempt: false,
      reason: "docs diff invalidates a registered derived artifact",
      staleArtifacts: stale.map((e) => e.id),
    };
  }
  const unrun = checked.filter((row) => row.outcome === "unrun").map((row) => row.entry);
  if (unrun.length > 0) {
    return {
      exempt: true,
      reason: "docs diff, affected checks could not run on this host — not a staleness verdict",
      unrunArtifacts: unrun.map((e) => e.id),
    };
  }

  return { exempt: true, reason: affected.length > 0 ? "docs diff, all affected artifacts fresh" : "docs-only diff, no registered artifact touched" };
}

/** A boolean check stays compatible; "unrun" is an environment result, not stale. */
export function normalizeDerivedCheckResult(value) {
  if (value === true || value === "fresh") return "fresh";
  if (value === "unrun") return "unrun";
  return "stale";
}

function checkOutput(value) {
  if (typeof value === "string") return value;
  if (value && typeof value.toString === "function" && !Array.isArray(value)) {
    try { return value.toString("utf8"); } catch { return String(value); }
  }
  return "";
}

const TOOLCHAIN_MISSING = /command not found|not recognized as an internal or external command|Cannot find module|ERR_MODULE_NOT_FOUND/i;

/**
 * A checker that never started, or started and could not find its toolchain,
 * is "unrun". A checker that ran and exited non-zero is "stale".
 * Uses classifySpawnResult so a spawn ENOENT is not the same verdict as exit 1
 * (BI-20B40955, BI-BD7E0319).
 */
export function classifyDerivedArtifactCheck(error) {
  if (!error) return "fresh";
  const stdout = checkOutput(error.stdout);
  const stderr = checkOutput(error.stderr);
  const ran = typeof error.status === "number";
  const spawnResult = ran
    ? { status: error.status, signal: error.signal ?? null, stdout, stderr }
    : { error, status: null, signal: error.signal ?? null, stdout, stderr };
  const classified = classifySpawnResult(spawnResult);
  if (classified.outcome === SPAWN_OUTCOME.RUNNER_FAILURE) return "unrun";
  if (classified.outcome === SPAWN_OUTCOME.OK) return "fresh";
  if (error.status === 127 || TOOLCHAIN_MISSING.test(`${stdout}\n${stderr}`)) return "unrun";
  return "stale";
}

/**
 * Whether this diff should take the single local-CI sandbox slot.
 * Docs-only (the pre-push predicate) does not. A mixed code file is named.
 */
export function decideSandboxAdmission(exemption) {
  if (!exemption || exemption.exempt) {
    const reason = exemption?.reason ?? "docs-only diff";
    return {
      claim: false,
      message: `docs-only diff — sandbox not claimed (${reason}). Mixing a code file into this change is what would cost the exemption.`,
    };
  }
  if (Array.isArray(exemption.files) && exemption.files.length > 0) {
    return {
      claim: true,
      message: `sandbox required — these non-docs files forfeit the docs-only exemption: ${exemption.files.join(", ")}`,
    };
  }
  const stale = Array.isArray(exemption.staleArtifacts) && exemption.staleArtifacts.length > 0
    ? `: ${exemption.staleArtifacts.join(", ")}`
    : "";
  return {
    claim: true,
    message: `sandbox required (${exemption.reason}${stale}).`,
  };
}

/** Null when the merge base cannot be resolved — the caller must not treat that as exempt. */
export function sandboxDecisionForHead({
  cwd = REPO_ROOT,
  git = (args) => gitTextOrNull(args, { cwd }),
  runCheck = (entry) => runCheckLive(entry, cwd),
  registry = DERIVED_ARTIFACTS,
} = {}) {
  const mergeBase = git(["merge-base", "HEAD", "origin/main"]);
  if (!mergeBase) return null;
  const diff = git(["diff", "--name-only", mergeBase, "HEAD"]);
  if (diff == null) return null;
  const files = String(diff).split(/\r?\n/).filter(Boolean);
  return decideSandboxAdmission(evaluatePushExemption(files, registry, runCheck));
}

/**
 * True when running inside GitHub's merge queue — the `merge_group` event, or
 * the synthetic `gh-readonly-queue/<base>/pr-<n>-<sha>` ref it checks out.
 * Nothing local ever sets either, so pre-commit and pregate stay strict.
 */
export function isMergeQueueContext(env = process.env) {
  if (env.GITHUB_EVENT_NAME === "merge_group") return true;
  return typeof env.GITHUB_REF === "string" && env.GITHUB_REF.startsWith("refs/heads/gh-readonly-queue/");
}

/**
 * Run every registry entry's check; returns [{ entry, ok, tolerated }].
 *
 * `tolerated` is true only for an entry flagged `mergeQueueRaceTolerant` that
 * is stale while `mergeQueue` is set. Such an artifact is derived from
 * repo-wide state (e.g. the migration count), so two PRs that each touch a
 * source produce a merged tree neither of them could have generated: the
 * second one into the queue is always stale, through no author error, and
 * cannot push a fix into the queue. PR-head CI (`pull_request`) still runs
 * this check strictly against the author's own base, so an author who forgot
 * to regenerate is still caught; only merge-order drift is tolerated, and the
 * next PR touching a source regenerates it (pre-commit) and heals main.
 */
export function evaluateCheckAll(registry = DERIVED_ARTIFACTS, runCheck = () => true, { mergeQueue = false } = {}) {
  return registry.map((entry) => {
    const outcome = normalizeDerivedCheckResult(runCheck(entry));
    const ok = outcome !== "stale";
    const tolerated = outcome === "stale" && mergeQueue === true && entry.mergeQueueRaceTolerant === true;
    return { entry, ok, tolerated, outcome };
  });
}

/** Registry entries whose sources OR outputs appear in `files`. */
export function entriesTouchedBy(files, registry = DERIVED_ARTIFACTS) {
  return registry.filter((entry) => files.some((f) => (
    matchesAnyGlob(f, entry.sourceGlobs ?? []) || matchesAnyGlob(f, entry.artifactPaths ?? [])
  )));
}

/**
 * BI-1A06A1AF. CI judges freshness on the pull_request merge (main + branch);
 * preflight runs check-all on HEAD. Those agree for every entry whose inputs
 * changed on at most one side since the merge base: a branch-only change is
 * the HEAD verdict, a main-only change inherits main's. An entry whose inputs
 * (sources or outputs) changed on BOTH sides is exposed: its merged output is
 * something neither tree generated, so HEAD cannot predict CI.
 */
export function evaluateMergedBaseExposure({ branchFiles = [], mainFiles = [], registry = DERIVED_ARTIFACTS } = {}) {
  const onMain = new Set(entriesTouchedBy(mainFiles, registry).map((entry) => entry.id));
  return entriesTouchedBy(branchFiles, registry).filter((entry) => onMain.has(entry.id));
}

/**
 * Merged-base freshness verdict for HEAD against `baseRef`.
 *   current — HEAD contains baseRef; check-all on HEAD is CI's verdict
 *   clear   — behind, but no entry is exposed on both sides
 *   stale   — exposed entries; CI's merge cannot be judged fresh from HEAD
 *   unrun   — the merge base could not be computed (runner failure, not STALE)
 */
export function mergedBaseDerivedVerdict({
  cwd = REPO_ROOT,
  baseRef = "origin/main",
  git = (args) => gitTextOrNull(args, { cwd }),
  registry = DERIVED_ARTIFACTS,
} = {}) {
  const mergeBase = git(["merge-base", "HEAD", baseRef]);
  const behindText = mergeBase ? git(["rev-list", "--count", `HEAD..${baseRef}`]) : null;
  if (!mergeBase || behindText == null) return { status: "unrun", baseRef, entries: [] };
  const behind = Number(String(behindText).trim());
  if (!Number.isFinite(behind)) return { status: "unrun", baseRef, entries: [] };
  if (behind === 0) return { status: "current", baseRef, behind, mergeBase, entries: [] };
  const list = (range) => {
    const out = git(["diff", "--name-only", "--no-renames", ...range]);
    return out == null ? null : String(out).split(/\r?\n/).filter(Boolean);
  };
  const branchFiles = list([mergeBase, "HEAD"]);
  const mainFiles = list([mergeBase, baseRef]);
  if (branchFiles == null || mainFiles == null) return { status: "unrun", baseRef, entries: [] };
  const entries = evaluateMergedBaseExposure({ branchFiles, mainFiles, registry });
  return { status: entries.length ? "stale" : "clear", baseRef, behind, mergeBase, entries };
}

// ── IO-touching implementations used by the CLI ────────────────────────────

const git = (args) => gitText(args, { cwd: REPO_ROOT });

function stagedFiles() {
  const out = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
  return out ? out.split("\n").filter(Boolean) : [];
}

function diffFiles(baseRef) {
  const out = git(["diff", "--name-only", baseRef, "HEAD"]);
  return out ? out.split("\n").filter(Boolean) : [];
}

function binaryAvailable(name) {
  // The Mermaid renderer is a tool (local mermaid-cli OR the pinned Docker
  // image), not a node_modules binary — ask the renderer module.
  if (name === "mmdc") return availableMermaidRenderer() !== null;
  const envOverride = process.env[name.toUpperCase()];
  if (envOverride) return existsSync(envOverride);
  const candidates =
    process.platform === "win32"
      ? [join(REPO_ROOT, "node_modules", ".bin", `${name}.cmd`), join(REPO_ROOT, "node_modules", ".bin", `${name}.exe`)]
      : [join(REPO_ROOT, "node_modules", ".bin", name)];
  return candidates.some((p) => existsSync(p));
}

export function resolveDerivedArtifactInvocation(
  argv,
  { platform = process.platform, env = process.env } = {},
) {
  return resolveHostCommandInvocation(argv[0], argv.slice(1), { platform, env });
}

function execDerivedArtifactCommand(argv, stdio, cwd = REPO_ROOT) {
  const invocation = resolveDerivedArtifactInvocation(argv);
  return execFileSync(invocation.command, invocation.args, {
    cwd,
    stdio,
  });
}

function runCommand(argv) {
  execDerivedArtifactCommand(argv, "inherit");
}

function runCheckLive(entry, cwd = REPO_ROOT) {
  try {
    execDerivedArtifactCommand(entry.check, "pipe", cwd);
    return "fresh";
  } catch (error) {
    return classifyDerivedArtifactCheck(error);
  }
}

function stageArtifact(artifactPath) {
  // A trailing "/**" means "this whole directory" — `git add` on the parent
  // directory covers every file the generator wrote under it.
  const target = artifactPath.endsWith("/**") ? artifactPath.slice(0, -3) : artifactPath;
  git(["add", "--", target]);
}

// ── subcommands ──────────────────────────────────────────────────────────

function cmdRegenerateStaged() {
  const plan = planRegenerate(stagedFiles(), DERIVED_ARTIFACTS, binaryAvailable);
  if (plan.length === 0) return 0;

  let failed = false;
  for (const { entry, action } of plan) {
    if (action === "skip-missing-binary") {
      console.log(`[pre-commit] derived-artifact "${entry.id}": sources changed but ${entry.requiresBinary} is not installed — SKIPPED (CI is the backstop via --check).`);
      continue;
    }
    if (action === "advisory") {
      console.log(`[pre-commit] derived-artifact "${entry.id}": sources changed (${entry.description}).`);
      console.log(`[pre-commit]   This artifact requires a deliberate decision, not auto-regeneration. If needed, run:`);
      console.log(`[pre-commit]     ${entry.generate.join(" ")}`);
      console.log(`[pre-commit]   and review + stage ${entry.artifactPaths.join(", ")} yourself.`);
      continue;
    }
    console.log(`[pre-commit] derived-artifact "${entry.id}": sources changed (${entry.description}) — regenerating...`);
    try {
      runCommand(entry.generate);
    } catch (err) {
      console.error(`[pre-commit] ERROR: "${entry.generate.join(" ")}" failed for derived-artifact "${entry.id}".`);
      console.error(String(err?.message ?? err));
      failed = true;
      continue;
    }
    for (const artifactPath of entry.artifactPaths) stageArtifact(artifactPath);
    console.log(`[pre-commit] derived-artifact "${entry.id}": regenerated and staged ${entry.artifactPaths.join(", ")}.`);
  }

  if (failed) {
    console.error("");
    console.error("Commit rejected. A derived-artifact generator failed — see errors above.");
    console.error("");
    return 1;
  }
  return 0;
}

function cmdPushExempt(baseRef) {
  if (!baseRef) {
    console.error("[pre-push-gate] push-exempt requires a base ref argument.");
    return 2;
  }
  const result = evaluatePushExemption(diffFiles(baseRef), DERIVED_ARTIFACTS, runCheckLive);
  if (result.exempt) {
    console.log(`[pre-push-gate] derived-artifact registry: exempt (${result.reason}).`);
    return 0;
  }
  console.log(`[pre-push-gate] derived-artifact registry: NOT exempt (${result.reason}).`);
  if (result.files?.length) {
    console.log(`[pre-push-gate]   non-docs: ${result.files.join(", ")}`);
  }
  if (result.staleArtifacts) {
    for (const id of result.staleArtifacts) {
      const entry = DERIVED_ARTIFACTS.find((e) => e.id === id);
      console.log(`[pre-push-gate]   stale: "${id}" — run: ${entry.generate.join(" ")}`);
    }
  }
  return 1;
}

function cmdCheckAll() {
  const mergeQueue = isMergeQueueContext();
  const results = evaluateCheckAll(DERIVED_ARTIFACTS, runCheckLive, { mergeQueue });
  let failed = false;
  for (const { entry, ok, tolerated, outcome } of results) {
    if (outcome === "unrun") {
      console.log(`[derived-artifacts] ${entry.id}: UNRUN — the checker could not run on this host; this is not a staleness verdict`);
      continue;
    }
    if (ok) {
      console.log(`[derived-artifacts] ${entry.id}: fresh`);
      continue;
    }
    if (tolerated) {
      console.log(
        `[derived-artifacts] ${entry.id}: STALE — tolerated in the merge queue (repo-wide count drifted under a concurrent merge; PR-head CI enforced freshness against the author's base, and the next source-touching PR regenerates it)`,
      );
      continue;
    }
    console.log(`[derived-artifacts] ${entry.id}: STALE`);
    console.log(`[derived-artifacts]   run: ${entry.generate.join(" ")}`);
    failed = true;
  }
  return failed ? 1 : 0;
}

function cmdList() {
  console.log(JSON.stringify(DERIVED_ARTIFACTS, null, 2));
  return 0;
}

function main() {
  const [sub, ...rest] = process.argv.slice(2);
  switch (sub) {
    case "regenerate-staged":
      process.exit(cmdRegenerateStaged());
      break;
    case "push-exempt":
      process.exit(cmdPushExempt(rest[0]));
      break;
    case "check-all":
      process.exit(cmdCheckAll());
      break;
    case "list":
      process.exit(cmdList());
      break;
    default:
      console.error("Usage: node scripts/derived-artifacts-gate.mjs <regenerate-staged|push-exempt <baseRef>|check-all|list>");
      process.exit(2);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
