---
status: active
---

# Workrooms for human operators

Backlog: BI-65D75876. Workroom: WC-24AD64E1. Delivery shape: medium.
This is a refactor of the existing inventory, extending the portal UX spine,
2026-08-24-workroom-portfolio-convergence and 2026-08-05-workcapsule-liveness-and-reaper-ws9.

## Outcome and boundaries

The nontechnical operator can distinguish progressing work from waiting, find
the accountable person and the supported next step, and reach the existing case
without processing session identifiers or expiry mechanics. Reuse the single
liveness classifier, automatic reaper, room accountability batch loader,
recorded drive state and report-kit. No new status persistence, recovery engine,
permission change or resume/takeover/delete action. The reaper keeps its existing
grace, held-session and unmerged-branch protections.

## Prototype and research

Prototype: `docs/ux-fit/2026-10-13-workrooms-human-operations-prototype.html`.
Built before this plan and implementation, with working native disclosures and
anchor links. Browser file-URL rendering was refused by security policy; no
alternate hosting or browser workaround. Its source is reviewable, but it is not
rendered UX proof. Actual route verification remains required after delivery.
Advisory specialist engagement: CE-CAA092BD, UX Design Critic.

Benchmarks:
- [GOV.UK task lists](https://design-system.service.gov.uk/components/task-list/):
  adopt short task names and grouped, sentence-case status; reject a linear
  completion wizard for independently running rooms.
- [Primer disclosure](https://primer.style/product/ui-patterns/progressive-disclosure/):
  adopt labelled secondary detail; do not hide the primary next action.
- [GitLab boards](https://docs.gitlab.com/user/project/issue_board/): adopt bounded
  lists and visible blocked work; reject another board and parallel status model.

WWMD DI-B79D1F597C08 recommends `refactor-existing-inventory` over
`add-separate-dashboard` and `rename-live-only` with high confidence. Cost axes
were scored as magnitudes; lower human cognitive load is better.

## Acceptance (quoted from the live item)

- AC-1: Default page separates demonstrably working, waiting and attention from retained history; leases alone never imply progress. Counts label bounded reads honestly.
- AC-2: Each actionable room names its recorded accountable person or honestly says unassigned, and gives a supported next step without inventing automatic recovery.
- AC-3: Lease timers, UUIDs, branches and diagnostic metrics are hidden behind labelled disclosures; keyboard and narrow viewport remain usable.
- AC-4: Repeated held causes are summarized once with affected room count and honest recovery guidance, preserving every case link and original evidence.
- AC-5: One existing inventory/read model serves unscoped and portfolio views. Compact loading and deferred history/diagnostics reduce default payload or rendered content with measured before/after evidence; no per-room DB queries or timer refresh.
- AC-6: Existing expiry grace/reaper safety and active holder protections remain unchanged and are tested; outcomes needing a person have an accountable recovery path.
- AC-7: Affected tests, typechecks, proportional guards, protected PR/merge, canonical deployment and actual desktop/narrow browser happy path prove delivery.

## Atomic implementation

One deliverable, `human-operations`, covers AC-1 through AC-7. Loading,
classification, accountable-owner presentation, disclosure and grouped recovery
must move together: a view without trustworthy state or ownership would repeat
the original harm. Test and doc changes are verification of that same deliverable.

1. Preserve liveness decisions; expose an optional compact portal projection,
   internal row identity and recorded drive facts, without leaking raw JSON.
2. Reuse `loadRoomAccountabilityBatch` once per inventory, not per room. Use
   recorded drive reasons/actions for human guidance, not a fabricated worker.
3. Refactor `WorkroomInventory` into Needs attention / Working now / Waiting;
   native labelled disclosures hold history and technical metrics. Retain the
   existing live-workrooms-heading anchor and case key encoding.
4. Group `HeldWorkroomsList` by recorded cause; name the shared problem once,
   keep affected-room links and evidence in a disclosure. Never suggest changing
   ownership as a cure for unavailable result writeback.
5. Move portfolio diagnostics out of the first decision surface. Use compact
   client row objects and render history only after it is requested.
6. Update the operator guide; measure rendered words, rows/controls and serialized
   payload with the same fixture before/after. Test real states and failure paths,
   batch query bounds, empty content and link reachability. Run existing liveness
   and reaper safety tests without changing their expected safety policy.

## Contracts, flow and verification

- Requirements: AC-1..AC-7 above.
- Contracts: existing liveness-inventory, room-workforce batch accountability,
  workroom-drive-hold, case-key and report-kit. Existing authorized route remains.
- Flow: inventory → action-priority group → case detail → Work Cases parent.
- Verification: inventory/held/section/page tests, accountability/liveness/reaper
  tests, affected typechecks, design/style/prose guards, native review and protected
  merge queue; canonical served-SHA preflight then desktop/narrow route traversal,
  disclosure and no overflowing/hidden primary action.
- Budget: predominantly refactoring; retire raw diagnostic columns and repeated
  status/explanation rendering. No external dependency, persistent model or new
  global navigation. No data migration; new human-oriented projections remain
  presentation adapters to canonical source state.
- UX fit: owning area Improve & Deliver; existing route family /ops/workrooms and
  portfolio Work views; nontechnical operator persona; local/contextual layer.
  Evidence options and exact changed UI files will be committed in the UX manifest.

## Live plan coverage

Before implementation, publish this immutable plan and record governed atomic
coverage for BI-65D75876, with requirementRefs AC-1..AC-7, contractRefs listed
above, flowRefs inventory-to-case, verificationRefs tests-and-live-path. Receipt
identity is recorded in the Workroom; this paragraph does not claim a receipt.
