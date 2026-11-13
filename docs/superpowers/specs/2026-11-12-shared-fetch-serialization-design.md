---
status: active
---

# Serialize shared-clone fetches

Backlog: BI-PIR-08c116e7. Workroom: WC-A7DD73AC.
Implementation parent: BI-PIR-08c116e7. The server derived Small for this bug;
the current admission is design only. Funding is unresolved; this design
authorizes neither paid review nor a budget change.

## Objective and evidence

Concurrent cooperating callers that share one Git object store must refresh
origin/main without overlapping ref updates. Required online freshness remains
required. An unsuccessful fetch, timeout or uncertain lock owner must remain
inconclusive, never become an accepted local baseline.

The canonical Finance occurrence is cmwegyz940u090es5l7y4sxiz,
NPEL-5D3A509812 / TR-NONPROD-2343A5E61B1BC9FA69216B72. Its child exited 8
before candidate checkout or grading: origin/main was already
3f8ddebc25b7590c78ad6946da1fbf0b5545f2c7 while Git expected
6fbcbac652749923c6ac1a3b6c0acdbfe379c0d5. No candidate test verdict follows.
The original Finance controller owns its continuation; this repair never
starts, resumes or cancels a second Finance gate or takes its lease.

At inspected source d894c7ff4a81f2ad942f1ff7c89320b3260b8889,
scripts/local-ci-runner.mjs invokes refreshAcceptedBase before checkout.
scripts/lib/local-ci-base-freshness.mjs:53 calls
fetchOriginMainSharedSafe. scripts/lib/git-fetch-shared-safe.mjs protects
history depth but does not serialize callers. The separate raw fetch in
scripts/lib/local-integration-ci.mjs:456 is an additional exposure, not the
observed failing command.

## Research and alternatives

A disposable two-process experiment imported the unchanged shared-safe helper
from the named source and synchronized both callers before entry. A controlled
ref-update adapter refused overlapping entry: current helper results were
one concurrent-ref-update and one success. Wrapping that unchanged helper in
the existing local-convergence-lock with reconcileStale:false gave two
successes. This demonstrates the helper's missing exclusion and the existing
primitive's suitability; it is not a reproduction against the live repository
or an assertion that the product source is repaired.

The same experiment rules out a depth-only remedy: both callers reported a
full repository and still overlapped. It also rules out a network prerequisite
for this exclusion failure: the deterministic adapter performed no network IO.
Real network and permission failures still need separate refusal tests.

Reuse scripts/lib/local-convergence-lock.mjs, rather than introduce another
lock format or dependency. A worktree-local lock is insufficient because linked
worktrees share refs. Retrying arbitrary Git failures without exclusion hides
real faults and does not prevent the race. Deleting Git lockfiles, resetting
refs, forcing fetches or accepting an offline baseline is outside this repair.

## Ordered atomic implementation

1. Add deterministic multiprocess regressions for callers from two linked
   worktrees of a disposable local Git repository, plus contention and real
   fetch failures. Preserve the initial failing result.
2. Extend the existing shared-safe helper with a bounded synchronous wrapper
   around its fetch sequence, using a canonical absolute Git common directory
   as the shared lock location and the existing ownership/token primitive.
   Hold the lock over shallow inspection, refresh and any required deepening.
   Reuse the wrapper for unshallow operations. Do not silently fall back to a
   worktree-local path if common-directory resolution fails.
3. Wait for a bounded interval on contention, with a monotonic deadline and
   bounded sleeps. Disable foreign stale reclamation: PID identity is not
   portable across host/container namespaces. Timeout or unreadable ownership
   fails closed. Release only this invocation's token in finally. Preserve a
   primary fetch error if cleanup also fails; successful fetch with uncertain
   cleanup must not report success.
4. Route the separate integration-plan fetch through the existing helper CLI,
   preserving online freshness and depth policy. Inventory affected helper
   callers and update their tests. This only serializes cooperating callers;
   unrelated raw Git commands are not magically protected.
5. Verify current accepted-base resolution, unrelated repository concurrency,
   own release after success/failure, retained foreign locks, bounded waits,
   shallow/full history behavior, and failure propagation. Run affected source
   suites and required protected delivery checks. Before implementation,
   coordinate the required main refresh with the existing Finance controller;
   no optional shared refresh occurs during its recovery leg.

## Acceptance and limits

- AC-1: Two linked-worktree callers share one exclusion boundary and complete
  real disposable-repository refreshes without concurrent ref-update failure.
- AC-2: Independent clones can fetch concurrently; full clones never become
  shallow and existing deepening behavior remains bounded.
- AC-3: Network/authentication/ref failures and lock uncertainty remain
  explicit failures. No foreign lock removal, reset or offline false pass.
- AC-4: The observed initial admission refresh and the separate integration
  fetch use the same helper boundary. Required source freshness is preserved.
- AC-5: A protected PR and canonical/shared verification provide delivery
  evidence. Existing Finance continuation is observed separately, without
  attributing an earlier source or infrastructure result to the repaired bytes.

All steps deliver one atomic correction; none is independently shippable.
Rollback reverts the helper and caller change. It does not mutate refs or remove
retained lock ownership. Implementation, shared CI, merge, deployment and actual
runtime acceptance have not run at design authoring.
