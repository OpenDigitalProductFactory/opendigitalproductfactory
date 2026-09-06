---
status: draft
---

# Instance identity to development-companion readiness

This plan implements the proposed development-companion increment of the
[identity declaration design](../specs/2026-08-22-installation-identity-declaration-surface-design.md#development-companion-continuation-proposed-implementation-increment-2026-09-06).
Objective: `OBJ-COMPANION-001`. Acceptance: `AC-COMPANION-001` through
`AC-COMPANION-007`. Contract references: `CON-COMPANION-IDENTITY`,
`CON-COMPANION-TRUST`, `CON-COMPANION-READINESS`. Flow: `FLOW-COMPANION-SETUP`.

Status: implementation candidate; independent design/architecture review, objective
baseline, plan review and immutable live backlog coverage remain required before
code. Source revision inspected: `061eeeee8c7`. No step below is marked delivered.
Local ownership and receipts live in the adopting organization's workroom/database;
this source document deliberately contains no organization-local work IDs.

## Delivery boundary

One vertical delivery slice connects existing identity, discovery/trust and sync
services to a truthful continuation in the existing surface. Internal phases below
are not independently useful releases: publishing a UI that calls a partial pull
"ready" is specifically excluded. Preserve the wider topology work's managed,
channel and community requirements as later existing-owner scope; this slice
implements the operator-requested development companion without reviving the
superseded universal journey-compiler program.

If inventory proof needs an independently shippable federation protocol change,
map it to that domain's existing owner and obtain its reviewed contract/coverage
before implementing that dependency. The vertical slice must remain blocked on
unproven inventory rather than invent acceptance or silently reduce its scope.

## Phase 1: shared continuation and identity binding

Extend `apps/web/lib/installation-journey/installation-identity-view.ts` with a
shared continuation projection composed with the activation-orchestrator boundary.
Keep the decision core testable with injected identity, candidate, link and sync
facts. Read canonical intent via `operating-intent.ts`; effective environment
precedence remains in its current owner. Reuse `identity-change-impact.ts` revision
semantics, extending evidence binding explicitly if the existing preview token
does not describe the required persisted identity revision.

Before Red, claim exact code/test paths and read the workroom change-impact contract.
Add every returned test impact and guard obligation; unresolved advice requires
broader verification. Current documentation-only impact calls for regenerated
doc-index, host preflight, exact-tree runtime gate for code and PR health at merge.

Verification: `VER-COMPANION-001`, `006`, `007`. Table-driven tests cover all effective
environments, confirmed/suggested/shadowed identity, paired/unpaired/ambiguous
references, and parent revision changes. Deliberately supply old-parent evidence
and prove readiness is rejected. A missing source stays unknown, never zero/ready.

## Phase 2: canonical candidate, trust and synchronization integration

Reuse `apps/web/lib/actions/federation-links.ts` (`startNearbyPairingAction` and
its polling/confirmation paths), `federation/nearby-candidates.ts`,
`organization-membership.ts` and trusted-link projection. Resolve a selected
candidate/link to actual parent installation identity with caller authorization.
Do not accept arbitrary URL fetches from a UI-provided name or bypass existing
endpoint policy. Declaration and connection retain separate action authority.

Extend the existing reconciliation and `work-sync-read-model.ts` consumer boundary
to expose completion proof for the selected inventory. Validate what
`federated-work-contract.ts`, `work-page.ts` and `work-sync.ts` actually carry;
inbound freshness alone is insufficient. Preserve no-echo and origin ownership.
If required records/epic metadata/references cannot round-trip or a peer contract
cannot prove the selected inventory, return the explicit unresolved set and block
readiness. Do not add a synthetic completed checkpoint as a substitute.

Verification: `VER-COMPANION-002` through `006`. Cover expired candidate,
self/foreign/ambiguous selection, denied action, pending/refused trust, missing
token, bad certificate, unreachable peer, incomplete pagination, wrong origin,
same counts but different fields and parent change during a pull. Confirm existing
same-org/member reconciliation runs without a browser or external agent present.

## Phase 3: existing identity surface continuation

Extend `apps/web/components/workspace/InstallationIdentityPanel.tsx` and its tests
to render the shared continuation after a confirmed declaration. Reuse the
federation-link and organization-join components' supported contracts; extract
shared UI only when it removes actual duplicated behavior. Ordinary business and
standalone development setup omit this branch. Present the selected parent,
current stage, actionable reason and one primary permitted next action. Identity
saved is a distinct outcome from development ready.

Verification: `VER-COMPANION-004`, `006`, `007`. Component tests assert order,
failure/retry/resume, back/reload, changing selection and stale-response suppression.
Real UI acceptance uses the actual installation administrator and a denied worker
role, keyboard, mobile, light/dark branding and failure focus/announcements. Verify
MCP and human views agree on identity/readiness using actual authorized readback.

## Verification and rollout

Use `dpf-tdd` for runtime changes. Classify worktree dependencies before executing
tests; a source-only checkout cannot supply compile/Prisma/browser evidence.
Use the governed shared nonproduction environment for runtime gates. Before
publication: source preflight, relevant tests/type checking, exact-tree semantic
review and required runtime gate. Before merge: PR readiness/health and bot findings.
No tests have been run for this implementation candidate.

First integration fixture: disposable new development companion of a test parent,
with known master selection. Demonstrate skip paths, same-org discovery, trust,
paginated sync, final authorized work readback, failed peer and resumed run. Parent
production records remain read-only. A full teardown/reinstall requires separate
authorization and captured recovery evidence; it is not needed to prove UI ordering.

Reserve roughly 20% of affected implementation effort for merging duplicate
identity/status/candidate projections and retry code into their canonical owners.
Record concrete removed duplication and consumer parity; do not fabricate refactors
to meet a quota. Avoid changing OAuth grants, trust rules or global sync semantics.

Rollback: revert the continuation/projection increment while preserving existing
intent, links and work; ignore unsupported new evidence safely. Never delete a
parent relationship's records or revoke its link merely because setup is reclassified.

## Backlog coverage

Coverage decision proposed: atomic vertical slice, with phases 1–3 sharing one
business acceptance boundary. Any independent federation protocol prerequisite
requires separate existing-owner mapping before that decision can be accepted.
The local workroom records the owning topology item and the exact source blob.
Coverage receipt: **not yet recorded**. This plan is not implementation-ready until
the server validates its immutable artifact, objective mappings and live coverage.
