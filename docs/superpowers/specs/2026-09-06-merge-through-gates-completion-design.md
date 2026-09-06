---
status: active
---

# Merge-Through-Gates Completion — direct-merge platform work reaches `done`

**Date:** 2026-09-06 · **Epic:** EP-4614F35E · **Kernel decision:** DI-54AECB341524 (principle_decide, high confidence, proceed)

## Problem

The `initiative-readiness.v2` completion gate requires a full independent-reviewer
lifecycle — research, design-spec, spec-approval (minting an objective baseline),
plan, plan-review, plan-coverage, traceability, architecture review, delivery,
acceptance, objective-reconciliation — before any `feature`-profile backlog item can
reach `done`. That lifecycle is right for **demand-driven customer feature work**.

It is wrong for **direct-merge platform-maintenance work**: the maintainer's own
changes that already merged into `main` through **CI + the protected merge queue + PR
review**. That class never accrues the demand-driven receipts (no product objective to
reconcile; on a single-operator install no second independent human reviewer), so
finished, merged, live work is stranded as `open` forever. Reproduced first-hand:
EP-WORKROOM-CLOSEOUT's four merged BIs cannot reach `done` — 13 gate receipts across
six role-grants that direct-merge work structurally cannot produce.

This is a **governance calibration** defect, not missing work.

## Decision (kernel-ratified)

`principle_decide` (DI-54AECB341524, high confidence, "proceed", autonomy-eligible,
no commandment conflict) recommends recognizing **a PR merged through the code gates
as an alternate completion path for direct-merge platform work**, over keeping the
full lifecycle for every item. The status-quo option scored *negative* against "Do the
work; don't task the operator with what an agent can do"; "Governance approves evidence,
not provenance" and "Platform function never depends on a client" pulled toward the fix.

## Design

For a completing backlog item, recognize completion when **all** hold:

1. **Merged through the gates** — the item's Workroom head SHA is reachable from the
   trunk, computed by LOCAL git (`isReachableFromTrunk`) against the host source mount
   the portal already carries (`/host-dpf`, or `DPF_REPO_ROOT`/`DPF_HOST_SOURCE_ROOT`).
   No GitHub API, no LLM — procedural and local, per *platform-function-never-depends-on-
   a-client*. Best-effort: any failure → not recognized (fails safe). Because `main`
   advances **only** via the protected merge queue (AGENTS.md §3; deployment.md), a SHA on
   the trunk provably passed CI + the merge queue + PR review.
2. **Direct-merge platform predicate** (`isDirectMergePlatformWork`): `scopeKind` is
   `platform`/`common`, AND no Build Studio build, AND no linked `DigitalProduct`, AND no
   linked product objective. Demand-driven feature work fails this (it carries a build,
   product, or objective) and keeps the full lifecycle.
3. **A design spec is present** — an injectable check, default non-blocking (absence of a
   spec *corpus* on a runtime is not absence of a spec, and the PR review is the design
   review for this class); an install may inject a strict scanner to require one.

When recognized, the fact-builder (`projectBacklogItemReadiness`) coerces the design/plan
lanes (research, canonical-design, spec-approval, objective-baseline, artifact-author,
architecture-review, plan, plan-review, plan-coverage, traceability) to `pass`, and the
terminal transition marks delivery + acceptance + objective-reconciliation satisfied —
**except** a real reconciliation `conflict`/`malformed`, which is never waved through.
`evaluate.ts` stays a pure state→verdict function; recognition is applied as fact-states,
matching the established "adapters set states, evaluate stays pure" contract.

## What is preserved

- **Independence and the full lifecycle for demand-driven work** — the predicate is tight
  and fails safe; anything with a build/product/objective keeps every gate.
- **Real conflicts still block** — an objective-baseline conflict or malformed
  reconciliation is never recognized away.
- **Evidence, not provenance** — the merge is verifiable evidence the code gates ran; the
  gate reads that evidence rather than trusting who asked.
- **`evaluate.ts` purity** — no new profile, no gate arithmetic change.

## Impacts

- **Blast radius:** the completion gate for direct-merge platform items only; bounded by
  the predicate. No schema change; no change to demand-driven completion. Reversible
  (delete the recognition branch).
- **Timing (honest):** self-upgrade deploys are batched (below the 10-PR threshold), so
  this goes live with the next release batch, not the same day. Once live, re-running
  completion closes the stranded items (and every future direct-merge platform item)
  automatically.
- **Rubber-stamp risk:** low — the "review" being trusted is CI + the merge queue + PR
  review, which are real gates, not an internal shortcut.

## Research & Benchmarking

- **GitHub required-reviewers + protected merge queue** (industry default): merging to a
  protected branch *is* the completion gate — CODEOWNER review + status checks are enforced
  by the forge. DPF adopts the *shape* (the merge is the gate) for platform work while
  keeping the initiative lifecycle for demand-driven features where outcome reconciliation
  matters. We reject the GitHub PR API as the signal (network + token dependency) in favor
  of local trunk reachability against the source mount.
- **Trunk-based development / "merged to main = done"** (Google, DORA): mainline is the
  source of truth; work is complete when it lands on trunk behind the gate. DPF mirrors
  this for maintainer work and layers the tighter predicate so it does not leak to customer
  features.
- **Kubernetes admission vs. reconciliation**: an admission controller gates *entry*; a
  reconciler trusts declared state once admitted. The merge queue is the admission
  controller here — once a change is admitted to trunk, re-litigating its design at
  completion is redundant for platform work. We adopt the "gate at admission, trust at
  completion" split.

## Alternatives rejected

- **Keep the full lifecycle for all items.** Rejected — strands finished platform work
  indefinitely; the kernel scored it negatively on operator toil.
- **Build a reviewer-on-by-default drive to auto-enact the lifecycle** (EP-4614F35E's other
  half). Real and complementary, but heavyweight for platform-maintenance work and slow to
  land; this recognition is the correct calibration for the direct-merge class and resolves
  it directly.
- **GitHub PR API as the merge signal.** Rejected — external dependency; local trunk
  reachability is offline-capable and client-independent.

## Tests

`backlog-terminal-transition.test.ts` — recognizes direct-merge platform work (relaxes
delivery + acceptance + reconciliation) and does NOT recognize demand-driven work with a
linked DigitalProduct. `entry-adapter.test.ts` — `recognizeMergeThroughGates` coerces the
design/plan lanes to pass with zero receipts, and is inert without the flag. 346 backlog
tests green; typecheck clean.
