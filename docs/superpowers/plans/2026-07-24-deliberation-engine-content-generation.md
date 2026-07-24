# Deliberation engine — branch content generation (BI-7B6B3C5C)

**BI:** BI-7B6B3C5C — "Plan-phase deliberation engine never generates branch content → 100% insufficient-evidence → build/self-upgrade runaway."
**Related spec:** [`docs/superpowers/specs/2026-04-21-deliberation-pattern-framework-design.md`](../specs/2026-04-21-deliberation-pattern-framework-design.md) (pattern framework), [`docs/superpowers/specs/2026-05-24-activity-quiescence-protocol-design.md`](../specs/2026-05-24-activity-quiescence-protocol-design.md) (the drain this unblocks).
**Sibling shipped:** BI-12E24186 (PR #3516) — the operational blast-radius fix (empty loops auto-discount from the self-upgrade drain + health verdict). That is the *symptom* containment; this plan is the *cause*.

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Problem (verified in the substrate)

`apps/web/lib/queue/functions/deliberation-run.ts` runs each branch through `routeEndpointV2` to **pick** an endpoint/model, marks the `TaskNode` `completed`, but **never invokes the model** — the code says so at line ~285: `// content is NOT yet generated — endpoint calls happen when the route decision is invoked by the caller.` No caller invokes it. So every branch's `recommendation` is empty, `synthesizer.ts` sees `withRec.length === 0`, and returns `insufficient-evidence` for 100% of runs (963 of ~972 lifetime; 411 in one day when a build batch got stuck in `plan`).

Upstream of that, `apps/web/lib/deliberation/orchestrator.ts` **receives the artifact content but drops it**: the create path takes `content: unknown` (line ~328) yet the branch-facing signature has `_content?: unknown` (line ~334, underscore = unused). The comment at line ~235 already flags "the artifact under deliberation is table stakes." So the subject-matter never reaches the branches even if we wired the call.

The fix infrastructure exists: `apps/web/lib/inference/routed-inference.ts` exports `routeAndCall(messages, …)` → `callWithFallbackChain` into every adapter. Branches need messages (role instructions + artifact content); that function does the rest.

## Design constraint — this flips on live inference cost

Today a deliberation is a ~0.3s no-op. Wiring real calls means: (branches per run: 3–4) × (every ideate/plan gate + every explicit `start_deliberation`) × real tokens/latency. Without a throttle this is the same shape that produced 411 empty runs/day — except now each one is a *paid* multi-model call. **Enabling it is a business/WWWD decision (cost posture), gated on operator go — not a silent flip.** Phase 3 (budget + throttle) is therefore a hard prerequisite of Phase 2 shipping enabled, and the feature ships behind a flag defaulting OFF.

## Phases

### Phase 1 — Thread the artifact content to the branch (no model call yet)
- **Deliverable:** the artifact `content` passed to `orchestrateDeliberation` reaches each branch's request contract instead of being dropped as `_content`. Persist the subject on `DeliberationRun.metadata` (or the branch `TaskNode.requestContract`) so the runner has it.
- **Files:** `apps/web/lib/deliberation/orchestrator.ts` (stop dropping `_content`; thread it), `apps/web/lib/deliberation/request-contract.ts` (`buildBranchRequestContract` accepts the subject), `packages/db/prisma/schema.prisma` only if a new column is needed (prefer `metadata` JSON to avoid a migration).
- **Verification (functional):** unit test — orchestrate a run with a known artifact string; assert the branch `requestContract` (or run metadata) contains it. No behavior change to consensus yet (still insufficient-evidence), so no runtime regression.

### Phase 2 — Assemble the prompt and call the model (behind a flag, default OFF)
- **Deliverable:** in `runDeliberation`'s worker-branch loop, build `messages` = role recipe/persona (author/reviewer/skeptic/debater from `extractRoleRecipes`) + the artifact content (Phase 1), call `routeAndCall`, capture the response as the branch `recommendation` + full text on the `TaskNode`, and feed real `branchArtifacts` to `synthesizeDeliberation`. Gate the whole call path behind `DELIBERATION_LIVE_INFERENCE` (default OFF → current no-op behavior preserved).
- **Files:** `apps/web/lib/queue/functions/deliberation-run.ts` (the branch loop + `branchArtifacts` build), `apps/web/lib/deliberation/synthesizer.ts` (only if recommendation parsing needs a normalizer).
- **Verification (functional):** with the flag ON in a test, mock `routeAndCall` to return distinct recommendations → assert consensus reaches `consensus`/`partial-consensus`/`no-consensus` (not `insufficient-evidence`) per the synthesizer rules. With the flag OFF → unchanged (insufficient-evidence, no call made). One live end-to-end run on the shared sandbox against a real local model (Docker Model Runner) confirming a plan gate can now advance.

### Phase 3 — Budget + throttle (prerequisite for enabling Phase 2)
- **Deliverable:** enforce `DeliberationRun.budgetUsd` (currently `branchBudgetUsed` is always 0 — wire real per-call cost from the adapter result) and add a per-build backoff: after N consecutive `insufficient-evidence`/failed deliberations on the same build in a window, stop auto-firing (exponential backoff), so a genuinely broken subject can't run up cost. This is the cause-side complement to BI-12E24186's symptom-side auto-discount.
- **Files:** `apps/web/lib/queue/functions/deliberation-run.ts` (budget accounting + halt), the proactive spawn path that re-fires plan deliberations (backoff), reuse the empty-loop signal already added in `quiescence.ts` (BI-12E24186) as the "this build is looping" source of truth.
- **Verification (functional):** unit test — a run exceeding `budgetUsd` halts remaining branches (`budgetHalted=true`); a build over the backoff threshold is not re-fired. Confirm the BI-12E24186 verdict stops appearing once Phase 2+3 make real deliberations succeed (self-disabling, as designed).

## First independently shippable slice
**Phase 1** ships alone with zero runtime behavior change (content is threaded but unused until Phase 2's flag flips) — a safe, reviewable first PR. Phase 2 lands flag-OFF (still safe). Only enabling the flag — after Phase 3 — carries cost, and that enablement is the operator's explicit go.

## Risks & rollback
- **Blast radius:** the deliberation engine feeds the whole decision/Build-Studio gate system. A bad prompt or parse could flip many gates from "always insufficient-evidence" (today's safe-but-useless state) to "wrong consensus." Mitigation: flag-gated; default OFF; the synthesizer already refuses to fabricate consensus from zero branches, so a partial failure degrades to today's behavior, not to a false pass.
- **Cost runaway:** the exact failure mode BI-7B6B3C5C caused, now paid. Mitigation: Phase 3 budget + backoff is a hard gate on enabling; ship OFF.
- **Rollback:** flip `DELIBERATION_LIVE_INFERENCE` OFF → instant return to the current no-op stub; no schema rollback needed (Phase 1 uses `metadata` JSON, additive).
- **Rollout:** enable on one install (this one) with a low `budgetUsd` cap and Docker Model Runner (local, no marginal $) first; watch the health-verdict stop firing and plan gates advance before widening.

## Definition of done (BI-7B6B3C5C acceptance)
A plan-phase deliberation produces real author/reviewer/skeptic output, reaches a consensus state, and a Build Studio plan gate can advance on it — with budget enforced and the per-build backoff preventing runaway — all reproducible on the shared sandbox against a local model, flag ON.
