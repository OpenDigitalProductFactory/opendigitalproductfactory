---
status: active
---

# Proactive Review Drive — the room drives its own review to done

**Date:** 2026-09-02 · **Supersedes (in part):** the "recovery is advisory / never auto-dispatch" invariant of `2026-08-23-initiative-readiness-traversal-repair-design.md`, `2026-08-25-initiative-readiness-reviewer-packet-design.md`, and `2026-09-01-completion-readiness-recovery-design.md`, for rooms at full proactivity.

## Problem — finished work strands as "open"

Work that is merged, live, and CI-green cannot reach `done`. The `initiative-readiness.v2`
completion gate requires an independent **spec-approval** receipt (which mints the
`OBJECTIVE_BASELINE`), plus plan-review, delivery, and acceptance receipts. For
direct-merge work — the CLI surfaces, and any PR that lands through the merge queue —
none of these are ever produced, and completion refusal is **advisory only**: it
returns a reviewer packet and stops, "never auto-dispatching, never opening a default
coworker." So the work misreports as open forever. (`docs/superpowers/specs/2026-09-01-work-formula-runtime-conformance-design.md` already records this: direct-merge closure "is neither auto-routed nor an explicit operator step, so finished work misreports as open.")

This was reproduced first-hand on EP-WORKROOM-CLOSEOUT. Walking a merged BI toward `done`
hit three structural walls, in order:

1. **The completing caller holds no receipt grants.** A CLI session's token carries
   `backlog_write`, not `initiative_evidence_write` / `initiative_design_review`. It
   cannot record *any* receipt — not even the author-side research step. (By design: the
   author must not self-attest.)
2. **The only dispatch surface fails from a non-UI context.** `request_coworker →
   AGT-WS-REVIEW` (the sole coworker pre-granted the review scopes) **times out** from an
   external CLI, registering no handoff — the "missing threadId" friction.
3. **The completion path is a baseline catch-22.** It escalates `baseline-not-found` and
   returns `reviewerRoutes: []`, because it demands the objective baseline that
   spec-approval would mint. Review is designed for **claim/design time**, not completion;
   merged-direct work has no such window.

The fix is not a new reviewer system. The platform already has the actuation engine — the
**room's proactivity drive**. What is missing is the wire between the readiness gate
(which knows a review is due and who is eligible) and that drive.

## Substrate we build on (do not reinvent)

- **Proactivity is a drive level the room owns**, not the coworker's — `PROACTIVITY_LEVELS
  = ["quiet","balanced","assertive"]`, with an action boundary `["advise","propose",
  "preauthorized"]` (`apps/web/lib/proactivity/proactivity-types.ts`). "The room owns
  drive, not the coworker" (BI-87C9C91C). **Full proactivity = `assertive` level +
  `preauthorized` boundary.**
- **The drive already dispatches.** `resolveDrivePlan` (`apps/web/lib/work-management/
  drive-resolution.ts`) walks a room's work-shape stages and returns a `DriveAction`. Its
  set already includes **`dispatch_agent`**; it already accepts `reviewDue`,
  `independentEvaluatorPrincipalRef`, and `independentApproverPrincipalRef`. A stage whose
  accountable principal is an **agent** returns `action:"dispatch_agent"` (drive-resolution.ts:275);
  a **role/person** stage returns `action:"attention"` (raised to a human, not executed).
- **`autonomous-action` is the sole mode that permits acting** (`autonomy-envelope.ts`),
  reached at the `preauthorized` boundary.
- **The reviewer packet + eligible reviewer already exist** —
  `resolveInitiativeReviewerRecovery` builds a `request_coworker` packet for the exact
  eligible non-author reviewer; `AGT-WS-REVIEW` ("change-reviewer") is pre-granted
  `initiative_design_review` (`packages/db/data/agent_registry.json`). Independence is
  enforced (reviewer principal ≠ artifact author) and is **not** relaxed here.

## Design — connect the gate to the drive

A room at full proactivity **drives its own review to done**. Concretely:

1. **Readiness review gates become drive stages.** When a room's backlog item has unmet
   readiness review codes (`SPEC_APPROVAL_REQUIRED`, `CANONICAL_DESIGN_REQUIRED`,
   `PLAN_REVIEW_REQUIRED`), the room's work-shape carries a corresponding review stage.
   The stage's **accountable principal is the eligible NON-AUTHOR reviewer** the readiness
   router already resolves:
   - **human authored the artifact** → the reviewer is the thread agent `AGT-WS-REVIEW` →
     the stage is an *agent* stage → drive returns **`dispatch_agent`**.
   - **an agent authored it** → the reviewer is a human role → the stage is a *role* stage
     → drive returns **`attention`** (routes to the human to review).

   This author-flip is exactly the split `resolveDrivePlan` already makes for free — we
   only supply the review stage and its non-author principal.

2. **A server-side runner executes `dispatch_agent` with the room's authority.** The drive
   tick (the room's server-side runner, not any CLI session) invokes the reviewer packet
   dispatch as the room — carrying the review scopes the room is entitled to — so the
   reviewer thread runs and records `record_initiative_design_review` under *its* principal.
   This dissolves walls 1 (grants) and 2 (CLI timeout): the dispatch never depends on the
   completing caller's token or interactive session.

3. **Stage order mints the baseline before completion.** The drive walks design-spec →
   spec-approval (mints `OBJECTIVE_BASELINE`) → plan-review as ordered stages, so the
   baseline exists before the completion gate reads it — dissolving wall 3.

4. **Merge-through-code-gates establishes code delivery; acceptance follows the
   objective evidence.** Proposed clarification, BI-4CCE50E0 (2026-09-06): the
   reachable squash commit and green required checks establish delivery. A check
   satisfies acceptance only for the objective and artifact version it actually
   evaluated. Runtime, UI, business arithmetic and policy objectives retain their
   corresponding evidence requirements. A CI-green reservation form whose booking
   never reaches the host must not close as accepted. Docs-only objectives may be
   covered by the relevant document checks and review. Reuse the initiative
   objective/receipt mapping; no second approval system. The non-author review in
   step 1 remains required. This clarification requires owner review before changing
   the completion gate; it is not an instruction to bypass or invalidate receipts.

5. **FAIL is first-class.** A reviewer's fail records findings and holds the item; it never
   silently passes and never needs a separate human approval to be recorded. Full
   proactivity drives the review to a *verdict*, not to a rubber-stamp.

**Default posture.** Platform-development rooms default to `assertive` / `preauthorized`
for the review stages — reviewer-on-by-default. Lower-trust or customer-facing scopes can
sit at `balanced` (the review is staged as `attention`/`propose` — teed up, one action to
run) or `quiet` (staged, not driven). The level is the room's, tunable, reversible.

## What this reverses, and what it preserves

**Reverses:** "recovery is advisory / never auto-dispatch." At `assertive`/`preauthorized`,
the room dispatches the reviewer on its own.

**Preserves, unchanged:**
- **Independence** — reviewer principal ≠ artifact author; the author-flip *depends* on it.
- **Never a *default/generic* coworker** — the drive dispatches the *exact eligible*
  reviewer the router selected (`AGT-WS-REVIEW` or the named human role), never a generic
  one. The invariant was about *genericness*, not *automation*; genericness stays banned.
- **Evidence, not provenance** — the gate still reads receipt fields; it does not care that
  the drive, rather than a human, initiated the dispatch.

## Impacts

- **Integrity: unchanged.** Independence and the receipt contract are untouched; only
  *initiation* moves from human to room.
- **Capacity: bounded, real.** One reviewer dispatch per review stage per room, only when
  no independent review exists and only at `assertive`. Not every completion everywhere —
  gated by the room's level.
- **Rubber-stamp risk: the load-bearing risk.** Full proactivity makes the internal
  reviewer's depth matter. Mitigations: the reviewer must record specific findings against
  the artifact; a shallow pass is a review-quality defect tracked against `AGT-WS-REVIEW`,
  not a governance escape hatch; `record_semantic_review_outcome` telemetry already
  measures reviewer precision and can gate trust.
- **Blast radius.** New seam between the readiness resolver and the drive runner; the
  completion gate learns to read a merge as delivery/acceptance for direct-merge rooms.
  No schema, independence, or receipt-writer change. Fires only for rooms at `assertive`.

## Research & Benchmarking

- **GitHub required reviewers + auto-merge** (industry default): a PR cannot merge until a
  CODEOWNER approves; merge is then automatic. DPF adopts the *shape* (review is a gate the
  system drives, not a manual afterthought) but binds it to **initiative** identity (the
  design/spec, not just the diff) and to a non-author **independence** rule GitHub does not
  enforce. We reject treating the code diff alone as the reviewed artifact — the design of
  record is what mints the baseline.
- **Kubernetes operators / reconciliation controllers**: a controller drives an object
  toward its declared desired state, taking bounded actions each tick. DPF's room drive is
  exactly this pattern for work; this spec extends "desired state" to include *reviewed*,
  with `resolveDrivePlan` as the reconcile loop. We adopt the tick-bounded, level-gated
  action model (already present) and add the review stage.
- **Temporal / Airflow human-in-the-loop tasks**: a workflow can pause for an approval task
  and auto-route it to an assignee. DPF's `attention` action is this; the delta is that at
  full proactivity the *agent-reviewer* branch does not pause — it dispatches. We keep the
  human branch (`attention`) for agent-authored work, matching the HITL pattern where the
  author cannot self-approve.

## Evidence depth amendment — proposed, BI-4CCE50E0

The reviewer names each objective, artifact/run version, assertion, observation and
supporting source. Policy-dependent findings cite the applicable revision and exact
section; numerical findings use independent recomputation. Missing or conflicting
evidence remains unresolved. A wrong citation does not become correct because the
verdict matches. Reuse existing reviewer packets and receipt fields, with bounded
repair/review attempts and retained failures. Reviewer count and model confidence
are not acceptance evidence. See [research §4](../research/2026-09-06-astra-business-verification-review.md#4-testing-and-review-increments).

## Alternatives rejected

- **A new "auto-reviewer" service.** Rejected: duplicates the room drive and the reviewer
  packet. Single source of truth is the drive.
- **Weaken independence / self-approval for direct-merge work.** Rejected: destroys the
  only integrity guarantee; the author-flip exists precisely to avoid it.
- **Auto-route only (never dispatch).** This is the `balanced` posture, kept as an option —
  but the founder chose full proactivity as the default, so `assertive` dispatch is the
  default, not the ceiling.

## Delivery — dogfood on EP-WORKROOM-CLOSEOUT

The four stranded closeout BIs (BI-9FF39058, BI-33E1E5D7, BI-154689E7, BI-75565393) are the
first work this capability closes: their rooms, at full proactivity, drive their own
spec-approval (via `AGT-WS-REVIEW`, since a human authored the spec) and read PR #4946's
merge as delivery/acceptance — reaching `done` without a hand-built receipt chain.
