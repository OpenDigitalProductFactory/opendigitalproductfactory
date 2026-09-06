# Archetype campaigns: portable test scope and recovery gap analysis

Status: proposed acceptance scope, 2026-09-06. Audience: external contributors and
development operators. This document does not activate a campaign or grant reset,
peer-write, business-policy or reviewer authority. All cases below are **not run**.

## Portable contract and local ownership

Use this path, a source commit, and the stable `ACR-*` case IDs below when reviewing
or implementing this scope. Backlog items, epics, organization identity and their
priorities belong to the adopting organization's network and operating model.
A PR must explain the behavior and acceptance criteria without requiring access
to that network's database. Local work IDs are neither global requirements nor
portable dependencies. Do not create another installation's work from those IDs.

Keep the private mapping from case IDs to local epics/items, hub identity,
installation identities, workrooms and evidence paths outside the reinstall's
wipe zone. Record the source commit and artifact digest in that mapping. Resolve
each local item's origin before editing it; a federated mirror is read-only.
Source artifacts preserve intent and test scope. They are not a backlog backup,
an approval receipt or proof of delivery. Historical work IDs elsewhere in the
repository require owner resolution; failure to find one locally is not global
absence. This document introduces no shared backlog registry or new runtime API.

The [catalog inventory](archetype-campaign-catalog.json) records all 107 leaves in
25 categories at its pinned catalog revision. It contains discovery entries only,
with no local work IDs, customer facts or claimed test results. Compare it with
the current source catalog whenever starting a campaign; do not freeze coverage
at this historical count.

## Existing implementation and gaps

Inspection baseline: source `50df2161c9324bf98d692848b24ef32cf22a1085`.
These are source observations, not results on a restored installation.

| Concern | Existing source / observed gap | Required evidence |
|---|---|---|
| Scenario execution | [Exercise harness](archetype-exercise-harness.md), [playbook](archetype-exercise-playbook.md), `scripts/harness/archetype-exercise.mjs` and restaurant adapter exist. Documented admin/API exercises do not establish every public and worker-role journey. | Actual actor, visible action and authorized persisted readback for each required handoff; capability gaps remain explicit. |
| Sync | `apps/web/lib/queue/functions/demand-reconciliation.ts` schedules work sync; `apps/web/lib/federation/work-page.ts` emits origin-owned records and excludes mirrors. | Verify both required directions. Inbound pull health alone cannot prove the hub acknowledged development-origin work or can restore it after development database loss. Preserve no-echo ownership rules. |
| Scope parity | `packages/db/src/federated-work-contract.ts` carries item archetype scope; its epic contract omits structured category/leaf/tag scope. | Round-trip epic and item scope separately, with explicit field comparisons. |
| Recovery bundle | `packages/db/scripts/capture-backlog-bundle.ts` and `packages/db/src/backlog-recovery-bundle.ts` select some scope fields but omit category/leaf/tag arrays. | Repair and prove field parity before calling recovery complete. Include completed work when its feedback/evidence history is required; default active-only capture is insufficient for that claim. |
| Sync health | `apps/web/lib/federation/work-sync-read-model.ts` reports inbound synchronization. | Separate connectivity, inbound freshness, outbound acknowledgment and demonstrated recoverability. |
| External checkpoints | Host reset automation inspected during research can advance after instructions or unsuccessful verification; its stored cycle and export path were historical. Host details remain private. | Bound every transition to a current receipt, verified target and artifact; a failed verification cannot complete or erase a run. |
| Planning coverage | The fixture plan referenced in local work, `docs/superpowers/plans/2026-08-22-veterinary-archetype-acceptance-fixture.md`, was absent at this source baseline. | Locate an immutable owner-approved artifact or have its existing owner produce/review the missing plan before activation. This is an unresolved dependency, not an invented approval. |
| Audience | [External planning boundary](../architecture/external-planning-reference-boundary.md) already separates private planning from product claims. Indexing a reset document alone does not establish where it renders. | Identify and inspect the exact reported surface before changing routes or claiming a UI fix. |

## External campaign protocol

Use existing workrooms, environment leases, scenario adapters and evidence stores.
The external agent controls the campaign; the instance owns authorized business
operations, synchronization, leases and receipts. Ordinary workers see their
business tasks. Authorized development administrators may inspect truthful
readiness, run identity and recovery status. Detailed host build/reset procedures
remain contributor/operator instructions. Do not infer a user's permissions from
which business archetype they use.

1. Select one observed business outcome and its local delivery owner. Enumerate
   the current catalog and retain a baseline home for every leaf; no leaf may
   disappear from coverage because it has no users or automated adapter yet.
2. Ground operating modes, people, authority, offers, locations, time, capacity,
   money or mission, policies and outside-system ownership. Label starter
   assumptions and provenance; obtain operator feedback before treating them as
   facts. Freeze normal-day, bad-day and periodic-cycle expectations.
3. Admit one runtime scenario initially. Record source and served build identities,
   environment authority, lease, test sinks, seed/clock and budgets. Isolate source
   work in governed worktrees. Never infer runtime identity from a source checkout.
4. Exercise the public-to-worker journey and inspect persisted outcomes. Preserve
   first failures, capability gaps and independent expected values.
5. Map failures to existing owners; review a bounded implementation slice and its
   dependencies. Preserve independent design/reviewer authority. Reserve roughly
   one fifth of affected implementation estimates for demonstrated consolidation
   of scenario, checkpoint or recovery adapters, with behavior preserved.
6. Implement through the established delivery gates. Re-exercise the original
   failure against the exact served version; retain original and repair evidence.
7. Validate the result with actual users. Record affected organizations/users,
   frequency, impact and confidence, leaving unknown values unknown. Update local
   priorities from that evidence rather than from catalog size or demo appeal.
8. Retain the run packet outside the wipe zone and resume from its last verified
   receipt. Routine iterations use bounded fixture cleanup. Full reinstall is a
   separate authorized recovery exercise and must satisfy its own readiness gate.

The private run packet includes campaign/run ID; portable case IDs and source
commit; local owner mapping; archetype/mode/variant and scenario revision;
provenance; seed/clock and personas; source/served version; environment and lease;
expected assertions; actions, observations and authorized readback; evidence
locations/digests; checkpoint/verdict; first failure and retry history; budgets;
and the next accountable action. Do not place credentials or personal data in
shared fixtures or PRs. These are document fields, not deployed schema additions.

## Recovery field matrix and readiness

Establish three separate guarantees: hub-origin work is available on a fresh
development member; development-origin work is durably recoverable; and campaign
evidence permits continuation. A running sync job establishes none by itself.
Capture a current durable bundle before any authorized teardown and demonstrate
restore in an isolated permitted environment. Never loosen no-echo behavior to
make mirrored rows writable. Design any recovery/reclaim path explicitly.

| Data | Pre-capture and post-restore comparison |
|---|---|
| Identity and ownership | Installation/hub identity, origin namespace, local versus mirrored ownership; no accidental adoption of another origin. |
| Inventory | Exact selected item/epic IDs and counts across pagination, including required completed/deferred history; explicit exclusions. |
| Business meaning | Titles, bodies, status, priority, effort, triage and occurrence metadata; documented defaults are not silently substituted. |
| Archetype scope | Scope kind/rationale, category IDs, leaf IDs and lifecycle tags for both epics and items. |
| Relationships | Epic membership, dependencies, deferrals, linked source artifacts and the local mapping to portable case IDs. |
| Revision integrity | Source revisions/timestamps, per-record canonical field digest, capture manifest/digest and durable acknowledgment; counts alone cannot pass. |
| Evidence and resume | Required activities, decision/approval references and external run artifacts resolve with digest integrity, or missing/unrecoverable evidence blocks continuation. |
| Protected work | Confidential/restricted/local-only records excluded from sharesafe federation have a separately protected capture/restore path. No wider sharing to satisfy parity. |

Select an explicit supported field set before capture and compare the same
canonical serialization after restore. Report unsupported fields as gaps rather
than ignore them. Keep a resumable failure checkpoint and the prior durable
capture when connectivity, pagination, ownership, artifact resolution or parity
fails. The controller must verify resolved absolute destructive target paths
against an explicit manifest and retain existing confirmation requirements.

## Stable acceptance cases

Case IDs survive local backlog changes. Append new IDs; do not reuse an ID for a
different meaning. A changed expectation increments the scope revision. Every case
starts **not-run**; these are test specifications, not an executable test suite.
The adopting run records pass, product-fail, infrastructure-inconclusive or not-run,
with evidence and denominators. Deliberately incorrect outcomes must be rejected
by the assertions. Unavailable infrastructure cannot become a product pass.

| ID | Trigger and expected result | Adverse control / proof | Owner seam |
|---|---|---|---|
| ACR-001 | Enumerate the current archetype catalog; every unique leaf maps to a local epic/baseline and scenario discovery entry. | Add a leaf or omit a mapping: coverage check exposes the gap without auto-creating foreign work. | Archetype coverage |
| ACR-002 | Select a company mode; distinguish confirmed facts, assumptions and external authority. | Missing/conflicting policy yields a named unresolved decision, not invented terms. | Business grounding |
| ACR-003 | Public intent creates exactly the correct domain record and worker handoff; authorized reload confirms it. | Double submission, lost response, stale page and private-field probe preserve correctness and privacy. | Storefront/intake |
| ACR-004 | Normal/bad/periodic variants use independent capacity and financial/mission assertions. | Compete for last capacity, cancel once, inject wrong total; no over-allocation or false reconciliation. | Domain adapters |
| ACR-005 | Worker can complete the task by keyboard and narrow-screen list with clear focus, status age and errors. | Actual worker role, denied role and signed-out paths; admin success alone cannot satisfy worker acceptance. | UI and role access |
| ACR-006 | Verdict cites exact artifact, policy revision/section and evaluated assertion. | Plausible answer with wrong citation, click-only output and deliberate wrong result fail their criteria. | Verification/review |
| ACR-007 | Failed run is retained; bounded repair replays it on the new served version. | Timeout, budget exhaustion or reviewer unavailability stops with explicit next action and preserves first-pass denominator. | Review/resume |
| ACR-008 | Current hub-origin work appears after isolated member restore with complete field parity. | Broken connection, partial page, missing epic or tag blocks recovery readiness. | Federation/recovery |
| ACR-009 | Member-origin work survives member database loss through a proven durable recovery path. | Hub's ordinary origin-only export cannot masquerade as recovery of its member-origin mirrors; no ownership rewrite. | Federation/identity |
| ACR-010 | Bundle restores the field matrix, required history and evidence links with matching digests. | Same row count but changed scope/body/relationship or missing external artifact fails parity. | Capture/restore |
| ACR-011 | Protected/local-only records recover through authorized protected storage. | Sharesafe exclusion is explicit; parity never grants wider disclosure. | Recovery/privacy |
| ACR-012 | Controller advances install/configure/verify only after current evidence succeeds for declared targets. | Printed instructions, stale capture, wrong directory, failed verify or crash cannot complete/reset the checkpoint. | External controller |
| ACR-013 | External procedure stays with operator/agent; authorized admin sees status; worker sees business work. | Inspect actual route/index/search/role reach before changing visibility; indexing alone proves no rendered defect. | Audience boundary |
| ACR-014 | Another installation can understand scope and review a PR without resolving originating local IDs. | An unavailable local BI does not imply missing implementation; local mapping cannot rewrite source requirements or import foreign work. | Artifact portability |
| ACR-015 | Feedback prioritizes the next slice with distinct observed and fixture evidence. | No-user leaves remain discoverable/unassessed; pilot success does not claim all-archetype acceptance. | Coverage/feedback |

Start with a business whose users can give feedback; restaurant and pet rescue
provide contrasting rehearsal examples, followed by trades and rental where
confirmed user demand warrants them. These examples do not cap catalog coverage.
Use three execution tiers: changed-workflow checks per slice, broader category
sentinels at an explicitly scheduled cadence, and full catalog coverage reporting.
This document creates no scheduled automation. Each tier declares selected and
unrun cases, cost/time ceilings, retention and coverage denominator.

## Analysis disposition and implementation handoff

The gap analysis is documented; runtime recovery and business acceptance remain
unproven. Independently shippable successor scopes are: recovery metadata parity;
member-origin recovery without ownership corruption; truthful sync/recovery
health; receipt-bound external checkpoints; scenario/role adapter coverage; and
audience verification on the identified surface. Each receives a local owner via
the private mapping and the existing delivery process before implementation.
The missing fixture plan remains a blocking dependency for its execution owner.
No current campaign, source presence or local planning completion substitutes for
independent approval and outcome reconciliation on the adopting installation.

Related: [Astra research](../superpowers/research/2026-09-06-astra-business-verification-review.md),
[operating-model evidence contract](../architecture/archetype-operating-model-audit.md#outcome-evidence-and-exception-probes),
[acceptance plan](../superpowers/plans/2026-06-06-archetype-acceptance-test-plan.md).
