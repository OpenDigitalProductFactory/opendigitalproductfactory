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
  const stale = affected.filter((entry) => !runCheck(entry));
  if (stale.length > 0) {
    return {
      exempt: false,
      reason: "docs diff invalidates a registered derived artifact",
      staleArtifacts: stale.map((e) => e.id),
    };
  }

  return { exempt: true, reason: affected.length > 0 ? "docs diff, all affected artifacts fresh" : "docs-only diff, no registered artifact touched" };
}

/** Run every registry entry's check; returns [{ entry, ok }]. */
export function evaluateCheckAll(registry = DERIVED_ARTIFACTS, runCheck = () => true) {
  return registry.map((entry) => ({ entry, ok: runCheck(entry) }));
}

// ── IO-touching implementations used by the CLI ────────────────────────────

function git(args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

function stagedFiles() {
  const out = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
  return out ? out.split("\n").filter(Boolean) : [];
}

function diffFiles(baseRef) {
  const out = git(["diff", "--name-only", baseRef, "HEAD"]);
  return out ? out.split("\n").filter(Boolean) : [];
}

function binaryAvailable(name) {
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

function execDerivedArtifactCommand(argv, stdio) {
  const invocation = resolveDerivedArtifactInvocation(argv);
  return execFileSync(invocation.command, invocation.args, {
    cwd: REPO_ROOT,
    stdio,
  });
}

function runCommand(argv) {
  execDerivedArtifactCommand(argv, "inherit");
}

function runCheckLive(entry) {
  try {
    execDerivedArtifactCommand(entry.check, "pipe");
    return true;
  } catch {
    return false;
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
  if (result.staleArtifacts) {
    for (const id of result.staleArtifacts) {
      const entry = DERIVED_ARTIFACTS.find((e) => e.id === id);
      console.log(`[pre-push-gate]   stale: "${id}" — run: ${entry.generate.join(" ")}`);
    }
  }
  return 1;
}

function cmdCheckAll() {
  const results = evaluateCheckAll(DERIVED_ARTIFACTS, runCheckLive);
  let failed = false;
  for (const { entry, ok } of results) {
    console.log(`[derived-artifacts] ${entry.id}: ${ok ? "fresh" : "STALE"}`);
    if (!ok) {
      console.log(`[derived-artifacts]   run: ${entry.generate.join(" ")}`);
      failed = true;
    }
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
