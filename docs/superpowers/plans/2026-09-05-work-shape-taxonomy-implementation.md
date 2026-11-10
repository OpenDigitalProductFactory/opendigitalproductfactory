---
status: active
---

# Work-shape taxonomy — implementation plan

**Backlog item:** `BI-B5C8FEFC` (parent) under `EP-129D11FD`  
**Design:** `docs/superpowers/specs/2026-09-02-work-shape-taxonomy-and-proportional-gates-design.md`  
**Kernel rulings:** design §5 (four of five ruled 2026-09-03; decision 2 defaults to human-only until the founder rules)  
**Readable summary:** https://claude.ai/code/artifact/2d1ae8f8-9fb8-44ea-b1f0-4783f7c27bb5

**For agentic workers:** execute this plan one independently reviewable backlog
item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green
implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate
before any success claim, and `dpf-pr-with-dco` for handoff. By the design's own
rules, the first slice claimed against this plan should be claimed **with a
declared shape**; until slice 2 lands the claim cannot ask, so state the shape in
the Workroom objective.

## Current state

- Two sizing systems do not talk: `initiative-readiness.v2`
  (`apps/web/lib/backlog/initiative-readiness/`) tiers by risk kind and ignores
  size; the Build Studio matrix (`apps/web/lib/explore/build-process-matrix.ts`)
  tiers by type × size × sensitivity. Completion requirements are unconditional
  across profiles (`evaluate.ts:107-115`), so a merged one-afternoon fix cannot
  close (`BI-B3AB7FC9`, PR #4999; also `BI-28E8CB88`, `BI-F0715C9C`, `BI-3AE38A1F`).
- The Workroom already carries a versioned activity shape (`workShape`, registry
  in `apps/web/lib/work-management/work-shapes.ts`; scope-claim persistence;
  `readWorkShapeClaim`), accepted by `create_workroom` and `adopt_worktree` but
  not by `claim_backlog_item_for_work`. `derive-workroom-shape.ts` deliberately
  returns null for delivery activity kinds. The delivery shape is the missing
  fifth axis, not a new concept (design §3.0).
- The kernel can rule but cannot seal a record on this install:
  `principle_decide` returns `ledger.recorded=false, profile-not-provisioned`
  (`BI-218EC195`). A ruling nothing can cite is advice; the plan sequences the
  ledger repair first.
- Reviewer capacity for large-shape gates is fragile (`BI-8B8731EE`).

## Atomic deliverables and backlog coverage

Each row is one clean revert. Order is the dependency order; slices 4 and 5 can
proceed in parallel once slice 3 has landed.

| # | Backlog item | Deliverable | Design | Depends on |
|---|---|---|---|---|
| 0 | `BI-218EC195` | Fallback decision profile carries a version; the ledger seals kernel rulings (branch `fix/ledger-fallback-profile-version`, in gate) | §5.1 | — |
| 1 | `BI-B90F7CBB` | Five `delivery-*@1.0.0` registry entries: stages, evidence, stop conditions, budgets, collaboration shape | §3.0, §4 | — |
| 2 | `BI-02470C7E` | `workShape` on the claim; `deriveDeliveryShape`; `work_shape_required` refusal with pick list; skill + hook tell the agent to ask | §3.3, §3.4 | 1 |
| 3 | `BI-B269FC72` | Readiness v3: requirements keyed by (shape, sensitivity, target); completion shape-conditional; item-body baseline for small/medium | §4, §5 rulings 3–5 | 1, 2 |
| 4 | `BI-AFE8BB73` | Delivery evidence is the trunk: merge reachability from Workroom `headSha`, then the linked PR | §4 | 3 |
| 5 | `BI-F2FEC1EB` | Break-fix expedite lane: `declare_break_fix`, 48h PIR receipt, WIP-1 budget, frequency signal on Right Now | §4, §5 ruling 1 (ruling 2 pending) | 1, 3 |
| 6 | `BI-D03BE728` | Shape on the Workroom header (extend `WorkroomShape.tsx`) and backlog item, declared/derived; Build Studio matrix keyed by (shape, sensitivity); kernel principle + runbook + AGENTS.md line | §3.3, §6.5, §6.7 | 2, 3 |

Objective baseline for the parent: the design's §4 gate table and §5 rulings.
Acceptance for the parent: a small fix claimed with a declared shape closes on
merge with no spec, plan, or reconciliation receipt; a large item still owes all
of them; a break-fix declared by a human closes on its PIR receipt and is refused
when a second break-fix is declared while one is open.

## Phase 0 — ledger seals rulings (`BI-218EC195`)

Touched files: `apps/web/lib/onboarding/ensure-org-decision-perspective-profile.ts`
(+ test), migration `20260905020000_backfill_fallback_decision_profile_version`.

Verification: `principle_decide` on the live install returns
`ledger.recorded=true` with a decision id after `/ops/self-upgrade` applies the
migration. Second half (route `in_platform_coworker` decisions to the org's own
perspective profile) stays on the item as follow-up; it is BI-HDLEMP-01 territory.

## Phase 1 — RED then GREEN: the registry (`BI-B90F7CBB`)

Touched files: `apps/web/lib/work-management/work-shapes.ts` (or a sibling
`delivery-shapes.ts` registered in the same registry), `registry` tests.

RED: tests resolve each `delivery-*@1.0.0`, validate the definition contract,
assert every merge/deploy/authority stage is a `governed-decision` advance, and
refuse a malformed reference at normalization. GREEN: add the five entries per
design §3.0. No schema change; no dispatch, schedule, or roster.

## Phase 2 — RED then GREEN: the claim asks (`BI-02470C7E`)

Touched files: `apps/web/lib/mcp/packs/work-capsules-pack.ts`,
`apps/web/lib/work-capsules/claim-backlog-item-handler.ts`,
`apps/web/lib/work-capsules/governed-work-claim.ts`,
`apps/web/lib/backlog/initiative-readiness/profiles.ts` (`deriveDeliveryShape`),
`packages/dpf-skill-pack/skills/dpf-worktree-per-session/SKILL.md`,
`packages/dpf-skill-pack/hooks/workroom-claim-guard.mjs`.

RED: declared → persisted as the `workShape` scope claim with `source: declared`;
derived-confident → persisted with `source: derived` and the signals;
ambiguous → `work_shape_required` refusal carrying the five-shape pick list;
unattended caller with no derivable shape → stop + attention to the owner;
unclassified → `large` + `high`; `xlarge` never enters implementation.
GREEN: implement against the existing closed-enum-plus-refusal pattern
(`triage_backlog_item` / `effortSize`). Do not add an elicitation primitive.

## Phase 3 — RED then GREEN: readiness v3 (`BI-B269FC72`)

Touched files: `apps/web/lib/backlog/initiative-readiness/{evaluate,types,entry-adapter}.ts`
and tests; `readiness-guidance.ts` next-action text per shape.

RED: policy-table tests per (shape, sensitivity, target) including: small +
low completes on delivery + runtime check; medium owes an independent
acceptance receipt (ruling 3); small + high owes large gates (ruling 4);
pre-taxonomy null shape keeps today's profile behaviour and never blocks a done
item (ruling 5); break-fix owes a PIR receipt within 48h.
GREEN: key the requirement tables by shape; make `OBJECTIVE_BASELINE_REQUIRED`
satisfiable by an item-body acceptance baseline for small/medium; scope
`OBJECTIVE_RECONCILIATION_REQUIRED` to large/xlarge; bump the policy version.

## Phase 4 — delivery evidence is the trunk (`BI-AFE8BB73`)

Touched files: `apps/web/lib/backlog/backlog-terminal-transition.ts`
(`defaultResolveMergeDelivery`) and tests.

Read the Workroom `headSha`, then the item's linked PR merge SHA when no room
recorded one; a SHA reachable from `origin/main` with green required checks
satisfies `DELIVERY_EVIDENCE_REQUIRED` for every shape. Keep the manifest path
as fallback and the evidence-lane honesty from `BI-28E8CB88`.

## Phase 5 — the expedite lane (`BI-F2FEC1EB`)

Touched files: work-capsules pack (`declare_break_fix`), the PIR receipt writer,
claim-time WIP budget check, `apps/web/lib/platform-runtime/workforce-activity.ts`
and `WorkforceNowShell.tsx` (break-fix share on the governance card, with a
measured ux-fit manifest).

Declarer recorded and never the PIR reviewer; default declaring authority
human-only until the founder rules decision 2; a missed PIR flips the item to
input-required and blocks the declarer's next declaration; share above 20% in a
rolling week is a finding.

## Phase 6 — visibility and the matrix (`BI-D03BE728`)

Touched files: `apps/web/components/workspace/workroom/WorkroomHeader.tsx` and
`WorkroomShape.tsx` (extend, do not duplicate), backlog item surfaces,
`apps/web/lib/explore/build-process-matrix.ts`, kernel principle
`gates-proportional-to-shape`, `docs/architecture/backlog-and-planning-runbook.md`,
one line in `AGENTS.md` §5, and the delivery-shape half of `BI-C8C4031C`'s page.

## Completion gate for the whole plan

1. Unit and policy tests green for every slice; `pnpm --filter web typecheck`
   clean; local-CI gate passed per slice.
2. Live-install acceptance on the reference install after `/ops/self-upgrade`:
   claim a small bug with no `workShape` → refusal with the pick list; re-claim
   with `delivery-small@1.0.0` → Workroom header shows the shape declared; merge
   → item closes without a spec or plan receipt. Declare a break-fix → PIR owed;
   second declaration refused.
3. `principle_decide` records a decision id on the live install (Phase 0).
4. Parent `BI-B5C8FEFC` closes against the §4 table as its objective baseline
   with the acceptance above as its evidence, through the v3 policy this plan
   delivers — not through the v2 gauntlet it replaces.

## Traceability

Four-way trace per deliverable, verbatim tokens the coverage record cites
(`record_plan_backlog_coverage` requires every ref to appear in this plan;
requirement ids are the design's `OBJ-*` objectives and verification ids its
`AC-*` acceptance rows, section 1.1 of the design).

| Deliverable key | Backlog item | requirementRefs | contractRefs | flowRefs | verificationRefs |
|---|---|---|---|---|---|
| ledger-seals-rulings | `BI-218EC195` | OBJ-SEALED-RULINGS | spec:5.1 | plan:phase-0 | AC-LEDGER-RECORDS |
| delivery-registry | `BI-B90F7CBB` | OBJ-SHAPE-TAXONOMY | spec:3.0 | plan:phase-1 | AC-SMALL-CLOSES-ON-MERGE |
| claim-asks | `BI-02470C7E` | OBJ-SHAPE-TAXONOMY | spec:3.3 | plan:phase-2 | AC-CLAIM-ASKS-FOR-SHAPE |
| readiness-v3 | `BI-B269FC72` | OBJ-PROPORTIONAL-GATES | spec:4 | plan:phase-3 | AC-LARGE-KEEPS-GATES, AC-HIGH-SENSITIVITY-RAISES, AC-PRE-TAXONOMY-UNTOUCHED |
| delivery-from-trunk | `BI-AFE8BB73` | OBJ-DELIVERY-TRUNK | spec:4 | plan:phase-4 | AC-SMALL-CLOSES-ON-MERGE |
| expedite-lane | `BI-F2FEC1EB` | OBJ-EXPEDITE-AUDITED | spec:4 | plan:phase-5 | AC-BREAK-FIX-PIR |
| visibility-and-matrix | `BI-D03BE728` | OBJ-SHAPE-TAXONOMY, OBJ-PROPORTIONAL-GATES | spec:3.3 | plan:phase-6 | AC-CLAIM-ASKS-FOR-SHAPE, AC-PRE-TAXONOMY-UNTOUCHED |

## Backlog coverage

- Decision: decomposed
- Parent: `BI-B5C8FEFC`
- Receipt: blocked-by: no initiative scope baseline exists for BI-B5C8FEFC (spec-approval by an independent reviewer has not been recorded) and the portal could not reach the repository provider to issue the reviewer packet (2026-09-05 03:00Z); record_plan_backlog_coverage refused with traceability-incomplete
- Rationale: each child is one clean revert with its own tests; the ledger repair goes first so the first shaped claim binds to a sealed kernel verdict rather than an advisory one.
- Dependencies: BI-218EC195 -> `BI-218EC195` (none); delivery-registry -> `BI-B90F7CBB` (none); claim-asks -> `BI-02470C7E` (BI-B90F7CBB); readiness-v3 -> `BI-B269FC72` (BI-B90F7CBB, BI-02470C7E); delivery-from-trunk -> `BI-AFE8BB73` (BI-B269FC72); expedite-lane -> `BI-F2FEC1EB` (BI-B90F7CBB, BI-B269FC72); visibility-and-matrix -> `BI-D03BE728` (BI-02470C7E, BI-B269FC72)
