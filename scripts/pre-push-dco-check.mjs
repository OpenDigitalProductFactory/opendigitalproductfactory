#!/usr/bin/env node
// scripts/pre-push-dco-check.mjs — refuse a push whose PR payload contains a
// commit missing a DCO sign-off (BI: pre-push completion gate).
//
// The "DCO" required check on a DPF PR is posted by the third-party DCO GitHub
// App only AFTER the push, so an unsigned commit — classically a corrupted or
// auto-generated MERGE commit (PR #4189) — turns the PR red minutes later, once
// the author has moved on. This CLI runs the same per-commit predicate locally,
// at pre-push time, so the failure is caught before it leaves the worktree.
//
//   node scripts/pre-push-dco-check.mjs                 # scan origin/main..HEAD
//   node scripts/pre-push-dco-check.mjs --base <ref>    # override the base ref
//   node scripts/pre-push-dco-check.mjs --head <ref>    # override HEAD
//   node scripts/pre-push-dco-check.mjs --range A..B    # scan an explicit range
//
// Base ref precedence: --base, then $DPF_PREPUSH_BASE_REF, then origin/main
// (mirrors the pre-push gate's docs-only exemption base).
//
// Exit codes:
//   0 = every commit in range is signed off (or the range is empty)
//   1 = at least one commit is missing a sign-off (each is listed)
//   2 = the base ref could not be resolved AND no explicit range was given.
//       CI's DCO app still enforces sign-off; a local host that cannot compute
//       the PR range must not silently pass, but neither should it hard-fail a
//       genuine offline fork. The pre-push gate treats exit 2 as a loud warning.

import { fileURLToPath } from "node:url";

import { findUnsignedCommits, resolvePushRange } from "./lib/dco-signoff.mjs";

export function parseArgs(argv) {
  const opts = { base: undefined, head: "HEAD", range: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base") opts.base = argv[++i];
    else if (arg === "--head") opts.head = argv[++i];
    else if (arg === "--range") opts.range = argv[++i];
    else if (arg.startsWith("--base=")) opts.base = arg.slice("--base=".length);
    else if (arg.startsWith("--head=")) opts.head = arg.slice("--head=".length);
    else if (arg.startsWith("--range=")) opts.range = arg.slice("--range=".length);
  }
  return opts;
}

/**
 * Pure verdict function — no process side effects — so it is unit-testable with
 * an injected git executor.
 *
 * @returns {{ code:0|1|2, unsigned:object[], range:string|null, baseResolved:boolean, baseRef:string }}
 */
export function evaluateDcoPush({ argv = [], env = process.env, git, cwd } = {}) {
  const opts = parseArgs(argv);
  const baseRef = opts.base || env.DPF_PREPUSH_BASE_REF || "origin/main";
  const { range, baseResolved } = resolvePushRange({
    explicitRange: opts.range,
    baseRef,
    head: opts.head,
    git,
    cwd,
  });
  if (!range) {
    return { code: 2, unsigned: [], range: null, baseResolved, baseRef };
  }
  const unsigned = findUnsignedCommits(range, { git, cwd });
  return { code: unsigned.length > 0 ? 1 : 0, unsigned, range, baseResolved, baseRef };
}

export function main({ argv = process.argv.slice(2), env = process.env, out = process.stdout, err = process.stderr } = {}) {
  let verdict;
  try {
    verdict = evaluateDcoPush({ argv, env });
  } catch (error) {
    // git could not enumerate the range (not a repo, bad range). Surface it as a
    // warning rather than a hard block — the same posture the pre-push gate uses
    // when it cannot compute a comparison base.
    err.write(`[pre-push-dco] could not scan commit range: ${error.message}\n`);
    return 2;
  }
  if (verdict.code === 2) {
    err.write(
      `[pre-push-dco] base ref '${verdict.baseRef}' does not resolve; cannot compute the PR range locally.\n` +
        "[pre-push-dco] Fetch the base (e.g. git fetch origin main) or pass --range A..B. " +
        "CI's DCO app still enforces sign-off.\n",
    );
    return 2;
  }
  if (verdict.code === 1) {
    err.write(
      `[pre-push-dco] ${verdict.unsigned.length} commit(s) in ${verdict.range} are missing a DCO sign-off:\n`,
    );
    for (const commit of verdict.unsigned) {
      err.write(`[pre-push-dco]   ${commit.sha.slice(0, 12)}  ${commit.subject}\n`);
    }
    err.write(
      "[pre-push-dco] Add sign-off to every commit before pushing. For the tip commit:\n" +
        "[pre-push-dco]   git commit --amend --no-edit -s\n" +
        "[pre-push-dco] For a range, rebase with sign-off:\n" +
        "[pre-push-dco]   git rebase --signoff <base>\n" +
        "[pre-push-dco] A merge commit is signed with:  git merge --signoff <ref>  (or re-create it with -s).\n",
    );
    return 1;
  }
  out.write(`[pre-push-dco] all commits in ${verdict.range} carry a DCO sign-off.\n`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
