---
status: draft
---

# Delivery outcome scorecard implementation plan

**Backlog item:** `BI-69803ACC`  
**Workroom:** `WC-FB38E81D`  
**Design:** `docs/superpowers/specs/2026-09-04-delivery-outcome-scorecard-design.md`

> **For agentic workers:** execute this plan one independently reviewable backlog item at
> a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation,
> `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success
> claim, and `dpf-pr-with-dco` for handoff.

## Design grounding

- Parent contract: `2026-09-03-local-first-agentic-delivery-throughput-design.md` §9.
- T3 amendments: `2026-09-04-t3-code-source-delta-review.md` §§3.8–3.9 and §6.
- Baseline: `2026-09-04-flow-efficiency-adversarial-fixture-baseline.md`.
- Source of truth: existing Workroom/activity/runtime/queue/task/telemetry records.
- UI host: existing `/build/work` route family and report-kit.
- Decision: derive `DeliveryOutcomeObservation@1`; add no persistence or event stream.

## Backlog coverage

- Decision: atomic
- Parent: BI-69803ACC
- Receipt: blocked-by: the retained published plan head 8b1c16a3bae11d9f88f540c68ff661fccfd09a78 is older than the active room head f6a115435b2d00a82db2128c8d1418ff564623af; native plan-artifact-invalid requires a provider-readable current head after the exact-head publication gate. Implementation admission IRD-B1C2308E56A7 remains separate evidence.
- Rationale: the pure projection, bounded source adapter, and operator screen are one
  observable contract. Projection-only code does not satisfy the operator outcome;
  presentation without the projection would create a second calculation authority.
- **Coverage state:** medium-shape implementation admitted by `IRD-B1C2308E56A7`
  on 2026-10-29, using the recorded inherited objective baseline. The older
  large-shape draft's missing-baseline prerequisite is superseded for this
  existing medium unit. This is admission, not delivery or acceptance evidence.
- Dependencies: BI-7C1F43E3 (Phase 1 baseline); no unfinished source change is
  required. The separate seven-day observation may populate later cohorts but does not
  block the scorecard contract.

| Deliverable | BI | Requirements | Contract | Flow | Verification | Independent? |
|---|---|---|---|---|---|---|
| Outcome projection, bounded adapter, and Build Work scorecard | BI-69803ACC | OBJ-DOS-001..004; AC-DOS-001..008 | design §§Projection contract, UI contract | raw facts → observation → cohort → report-kit view | focused unit/UI tests, typecheck, prose/style guards, route sweep, protected CI | No — one integrated operator outcome |

## Change-impact contract

The Workroom contract is resolved for 12 claimed paths. Before implementation:

- resolve graph-linked/colocated tests for the Work page, Work Control panel/action,
  projection, read model, and scorecard component;
- preserve `/build/work`'s current ≤237-word arrival baseline and net visible-word delta ≤0;
- keep every new module below 800 lines;
- run `pnpm run check:prose-lint:test`, `pnpm run check:prose-lint`, and
  `node scripts/check-style-drift.mjs`;
- generate/check the doc index and any route-derived artifacts named by preflight;
- include Design Grounding and qualifying UX-fit evidence in the PR.

## Phase 1 — contract tests (RED)

**Files:**

- `apps/web/lib/delivery-outcomes/projection.test.ts`
- `apps/web/lib/delivery-outcomes/projection.ts`

Write fixtures for complete, incomplete, stale, failed-source, parent/child, and duplicate
run identities. Assert observation version, valid-pair p50/p90, incomplete counts,
first-pass three-state semantics, verified-result rules, separate token/spend fields,
inclusive/exclusive deduplication, and stable Workroom evidence links. Run the focused
test and capture intended failures before implementation.

## Phase 2 — pure projection (GREEN + refactor lane)

Implement the smallest import-light projector. Centralize percentile/sample accounting,
duration pairing, nullable sums, and source-state aggregation there; the UI may format
but never recalculate. This consolidation is the campaign's bounded refactoring share.
Run the focused projection suite until green.

## Phase 3 — bounded source adapter (RED/GREEN)

**Files:**

- `apps/web/lib/delivery-outcomes/read-model.test.ts`
- `apps/web/lib/delivery-outcomes/read-model.ts`
- `apps/web/lib/actions/work-capsules.ts`

Write mocked-delegate tests first. Assert a 30-day cutoff, deterministic sort, explicit
`take` ceilings, no external network call, latest-successful-per-source PR snapshot use,
and partial/failed source preservation. Then load only fields required by the projector
from existing Workroom, activities, runtime verifications, queue events, task hierarchy,
adapter runs, tool executions, and contributor snapshots. Return the scorecard beside
the existing Work Control payload without altering write paths.

## Phase 4 — accessible scorecard (RED/GREEN)

**Files:**

- `apps/web/components/build/delivery-outcomes/DeliveryOutcomeScorecard.test.tsx`
- `apps/web/components/build/delivery-outcomes/DeliveryOutcomeScorecard.tsx`
- `apps/web/components/build/work-control/WorkControlPanel.test.tsx`
- `apps/web/components/build/work-control/WorkControlPanel.tsx`
- `apps/web/app/(shell)/build/work/page.tsx`

Write render tests for ready, empty, partial/stale, and failed-source states; semantic
headings/tables; `Unavailable` values; record links; and compact narrow-safe structure.
Render the default Work Control view unchanged in shape with a compact outcomes entry,
and branch server-side to the detailed scorecard for `?view=outcomes`. Use report-kit,
theme tokens, no motion, no client polling, and no local calculation fork.

## Phase 5 — functional and protected verification

1. Run focused projection, adapter, component, Work Control, and page tests.
2. Run web typecheck and the resolved prose/style guard obligations.
3. Run `pnpm run pregate:preflight`; regenerate only named derived artifacts.
4. Obtain UX-fit review and exercise default and outcome views at desktop and narrow
   widths with keyboard and assistive semantics against a leased preview/runtime.
5. Record semantic review against the exact base/head/tree/diff identity.
6. Run the exact-head local gate. If infrastructure makes it inconclusive, record that
   state exactly; never infer PASS. Protected PR and merge-group checks remain mandatory.
7. Commit with DCO, push, open one non-draft PR, run `pnpm pr:health`, resolve the full
   review tail, and merge through the queue.
8. Record merge/runtime/acceptance evidence and reconcile AC-DOS-001..008 before closing
   `BI-69803ACC` and `WC-FB38E81D`.

## Rollback

Revert the single PR. The query adapter and UI disappear; existing source records are
unchanged because there is no migration or scorecard writer.

## Current implementation checkpoint — 2026-10-29

The original branch and Workroom remain the delivery carrier. Source-local tests
cover the pure projection, visibility-before-aggregation adapter, default-route
shortcut and server-rendered query view. Those checks do not establish a
protected gate, deployment or live acceptance.

Refactoring consolidates nullable totals, sample accounting, source degradation,
and ancestry deduplication in the projector. The renderer formats the resulting
observations and does not own metric calculations. Existing queue math is reused.

UX prototype: `D:/DPF-temp/delivery-scorecard-prototype.html`, illustrative data.
Advisory UX engagement: `CE-9B25256C` (requested; no completed critique claimed).
The existing route/report-kit composition is retained. `DI-F7D029136168` records
the considered arrangements but returned low confidence and declined all options;
it is not a UX approval. The agent's actual choice of the existing-design local
view was recorded with `resolvedBy=agent`; the native ledger classifies matching
the ranked option as `followed`, while the declined recommendation remains.
Browser measurements, route sweep and independent
acceptance remain separate required evidence.

See the design's source reconciliation for every currently unavailable metric.
Do not close the item or claim the full acceptance criteria from source tests.

## Attribution correction — 2026-10-31

Current executor/chat identity does not establish exclusive historical run ownership.
Usage qualifies through recorded direct build identities or descendant build identities
reached from the Workroom's explicit TaskRun root. Buildless thread-only rows remain
unattributed; no cost split or cohort-local uniqueness is inferred. Tool counts require
explicit task ancestry. Potential attribution gaps, failed/truncated run sources, and
failed/truncated descendant history withhold affected totals and mark coverage partial.
Qualified run identities remain inspectable; unavailable totals do not become zero.
The original acceptance criteria and pending architecture choice remain unchanged.

## Phase-report convergence — 2026-10-31

The bounded refactoring lane replaces the existing bespoke BuildPhaseCostCard
with report-kit DataTable inside its sole BuildProgressOperationalPanel consumer.
The old component is deleted; no feature is relocated to evade the budget.
Preserve empty hiding, canonical phase order with unknown-phase fallback, active
indication, seconds precision, input/output/call figures, and the conditional
total row. Missing estimates stay unavailable; estimates remain separate from
subscription fees and invoices. The existing message provider carries the viewer's
optional numeric-format locale; /build supplies the workrooms namespace and the
resolved locale. Shared formatDuration gains an opt-in seconds mode while its
default behavior is unchanged. No BuildStudio prop forwarding is needed.

Claimed source includes the old card, operational panel and its test, /build
page, existing locale context/provider, and shared datetime helper/test. Behavior
regressions first failed for the named table and seconds mode. Source measurement
under the unchanged cap is 70 components and 16,294 lines, down from 16,296.
Retightening may only lower that budget and must preserve owner and expiry.
This measured convergence needs no budget increase; the previous exception
question is not an approval. Independent review, served desktop/narrow behavior,
UX capture and the protected build/release gates still apply to the final delta.
