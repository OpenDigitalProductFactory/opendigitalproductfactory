#!/usr/bin/env node
// N-1 caller-honesty ratchet (BI-D47955AF follow-up).
//
// The self-upgrade promoter is CANDIDATE-owned (built from the target commit)
// but CALLER-launched (run by the portal that is still deployed). That split is
// what makes an upgrade able to fix its own caller — and it is also a trapdoor:
// a PR can add a readiness requirement to the candidate's promote.sh AND the
// caller-side plumbing that satisfies it, and ship green, because the N-1
// acceptance harness supplies the new environment by hand. The harness ends up
// testing the post-fix world, while the real N-1 caller can never reach it.
//
// That is exactly how PR #3282 wedged every pre-existing install: readiness
// began requiring DPF_HOST_PLATFORM/DPF_HOST_ARCH, the deployed portal had no
// code to send them, and the harness hard-coded `-e DPF_HOST_PLATFORM=linux`
// so nothing went red. The upgrade that teaches the caller to send them WAS the
// blocked upgrade.
//
// The invariant this enforces:
//
//   A compatibility harness may not hand the candidate promoter any environment
//   key that the BASELINE caller does not itself pass.
//
// Baseline = the caller as it exists at the merge base (what is actually
// deployed out there), not as this PR leaves it. Anything the harness supplies
// beyond that is a simulation of a caller that does not exist yet.
//
// Usage:
//   node scripts/check-n-minus-one-caller-honesty.mjs [--base <ref>] [--json]
//
// Exit 0 = honest, 1 = violation, 2 = could not evaluate (missing base ref).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const CALLER_SOURCE = "apps/web/lib/self-upgrade/promoter.ts";
const HARNESS_SOURCE = "scripts/test-n-minus-one-upgrade.mjs";
const ACCEPTANCE_WORKFLOW = ".github/workflows/self-upgrade-acceptance.yml";

// Keys the harness owns because they describe the TEST RIG, not the caller
// contract: they select which promoter image to exercise, point it at throwaway
// mounts, and stub the docker preflight a real portal performs for itself.
// Every entry needs a reason — this list is the only way to weaken the ratchet,
// so it stays short and argued.
// Kept deliberately minimal: every entry here is a hole in the ratchet, so a key
// earns a place only when the real caller genuinely cannot be its source. Keys
// the caller DOES pass need no entry — the subset check already accepts them.
const HARNESS_SCAFFOLDING = new Map([
  ["DPF_RUNTIME_TRANSITION_SECRET_FILE", "rig points at a throwaway secret path; the portal bind-mounts the install's secret to the promoter's default location instead"],
  ["COMPOSE_PARALLEL_LIMIT", "bounds hosted-runner concurrency; not part of the promoter contract"],
]);

function git(args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 1e8 });
}

function readAtRef(ref, path) {
  try {
    return git(["show", `${ref}:${path}`]);
  } catch {
    return null;
  }
}

// Single-pass scanner over code, comments, and the three string forms. A plain
// regex is not enough: an apostrophe in prose ("the promoter's contract") reads
// as a quote and desynchronizes everything after it, silently under-reporting
// what the caller sends — which in a ratchet means false PASSES on the honesty
// check and false FAILS on the baseline. Comments are skipped, not tokenized.
export function scanStringLiterals(source) {
  const literals = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let value = "";
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") {
          value += source[i + 1] ?? "";
          i += 2;
          continue;
        }
        value += source[i];
        i += 1;
      }
      i += 1;
      literals.push(value);
      continue;
    }
    i += 1;
  }
  return literals;
}

// When a literal is exactly "-e", the next literal carries the env assignment.
// Robust to the multi-line args.push(...) formatting both files use.
export function extractDockerEnvKeys(source) {
  const literals = scanStringLiterals(source);
  const keys = new Set();
  literals.forEach((literal, index) => {
    if (literal !== "-e") return;
    const key = /^([A-Z][A-Z0-9_]*)=/.exec(literals[index + 1] ?? "")?.[1];
    if (key) keys.add(key);
  });
  return keys;
}

// `-e KEY=value` / `-e KEY` as written in a workflow run: block.
export function extractWorkflowEnvKeys(source) {
  const keys = new Set();
  for (const match of source.matchAll(/-e\s+([A-Z][A-Z0-9_]*)=/g)) keys.add(match[1]);
  return keys;
}

export function findViolations({ baselineCallerKeys, harnessKeys, scaffolding = HARNESS_SCAFFOLDING }) {
  return [...harnessKeys]
    .filter((key) => !scaffolding.has(key) && !baselineCallerKeys.has(key))
    .sort();
}

function resolveBaseRef(explicit) {
  if (explicit) return explicit;
  for (const candidate of ["origin/main", "main"]) {
    try {
      git(["rev-parse", "--verify", "--quiet", candidate]);
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function main(argv) {
  const asJson = argv.includes("--json");
  const baseIndex = argv.indexOf("--base");
  const baseRef = resolveBaseRef(baseIndex >= 0 ? argv[baseIndex + 1] : undefined);

  if (!baseRef) {
    console.error("[n1-caller-honesty] no base ref (origin/main or main) — cannot establish the baseline caller.");
    return 2;
  }

  let mergeBase;
  try {
    mergeBase = git(["merge-base", "HEAD", baseRef]).trim();
  } catch {
    console.error(`[n1-caller-honesty] no merge base with ${baseRef} — cannot establish the baseline caller.`);
    return 2;
  }

  const baselineCaller = readAtRef(mergeBase, CALLER_SOURCE);
  if (baselineCaller === null) {
    console.error(`[n1-caller-honesty] ${CALLER_SOURCE} absent at ${mergeBase.slice(0, 9)} — cannot establish the baseline caller.`);
    return 2;
  }

  const baselineCallerKeys = extractDockerEnvKeys(baselineCaller);
  const harnessKeys = new Set([
    ...extractDockerEnvKeys(readFileSync(join(REPO_ROOT, HARNESS_SOURCE), "utf8")),
    ...extractWorkflowEnvKeys(readFileSync(join(REPO_ROOT, ACCEPTANCE_WORKFLOW), "utf8")),
  ]);

  const violations = findViolations({ baselineCallerKeys, harnessKeys });
  const report = {
    baseRef,
    mergeBase,
    baselineCallerKeyCount: baselineCallerKeys.size,
    harnessKeyCount: harnessKeys.size,
    violations,
  };

  if (asJson) console.log(JSON.stringify(report, null, 2));

  if (violations.length > 0) {
    if (!asJson) {
      console.error("[n1-caller-honesty] FAIL — the N-1 harness supplies environment the deployed caller cannot.\n");
      for (const key of violations) {
        console.error(`  ${key}`);
        console.error(`    ${HARNESS_SOURCE} / ${ACCEPTANCE_WORKFLOW} pass this to the candidate promoter,`);
        console.error(`    but ${CALLER_SOURCE} at ${mergeBase.slice(0, 9)} never sends it.`);
      }
      console.error("\nThe harness is testing a caller that is not deployed anywhere. If the candidate");
      console.error("now requires this key, every existing install is wedged: it cannot supply the key,");
      console.error("and the upgrade that would teach it to IS the blocked upgrade.\n");
      console.error("Fix the candidate to derive the value from substrate it already has (mounted");
      console.error("install-state, the compose env file), or stage the requirement across two");
      console.error("releases — caller first, requirement second. Do NOT make the harness supply it.");
      console.error(`\nIf this key is genuinely test-rig plumbing, add it to HARNESS_SCAFFOLDING in`);
      console.error(`${"scripts/check-n-minus-one-caller-honesty.mjs"} with a reason.`);
    }
    return 1;
  }

  if (!asJson) {
    console.log(`[n1-caller-honesty] OK — harness passes ${harnessKeys.size} env key(s), none beyond what the baseline caller at ${mergeBase.slice(0, 9)} sends.`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
  process.exit(main(process.argv.slice(2)));
}
