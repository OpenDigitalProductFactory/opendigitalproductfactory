---
status: active
---

# Same-organization work sync implementation plan

**Backlog:** BI-FF8A57EF (also closes BI-D92A50F4)
**Design:** `docs/superpowers/specs/2026-08-23-zero-touch-organization-federation-design.md` §5.2, §5.3, and the §5.11 amendment landed with this plan.

## What was measured before writing a line

On the development install (192.168.0.200) paired with the production install
(192.168.0.152), 2026-09-02:

- One trusted `same-org-peer` link; exchange enabled both sides (`POST /api/v1/federation/demand` answers 401, not 404, on both).
- Outbound: 327 of 327 open items projected as `demand-envelope` mirrors, every one acknowledged. On the peer they sit on `/ops/demand` as adoptable demand — not in its backlog.
- Inbound: zero `FederatedRecordMirror` rows with `canonicalSide = peer`. Nothing from the production backlog had ever landed, in any form.
- `FEDERATED_RECORD_TYPES` declares `backlog-item` and `epic`; a repo-wide search finds no producer, and `dispatchDueDemand` filters to the three demand types.
- The stance briefing said "Peer — none / Work sync — none" because `USABLE_LINK_STATES` held `active|approved`, states `resolveLinkTrust` never produces (BI-D92A50F4).

## Sequence

1. Fix the usable link state to `trusted`, typed against `TrustState`; correct the fixtures that hid it; add the regression test.
2. Add the wire contract `@dpf/db/federated-work-contract` (page shape, validation, origin marker helpers) with tests.
3. Serve `GET /api/v1/federation/work` (private-mesh, trusted same-org link only, paged, share-safe selection in `lib/federation/work-page.ts`) with tests.
4. Pull in `lib/federation/work-sync.ts`: full-inventory pull per link, upsert `Epic` then `BacklogItem` with the origin's semantic ids and marker, provenance in `FederatedRecordMirror`, retire on a complete read, conflict on a locally owned id; tests for every branch.
5. Run it as a second step of the existing five-minute `federation/demand-reconciliation` job; update the job catalog purpose.
6. Exclude mirrors from every place that would fork them: demand projection, demand share picker, channel sharing, the triage drain.
7. Show it: `WorkSyncPanel` on `/ops/demand` over `work-sync-read-model.ts` (per link: mirrored counts, last copy, conflicts).
8. Docs: spec amendment, `docs/operations/federated-demand-channels.md`, user guide.
9. Gates, PR, merge queue, release, self-upgrade on both installs, live verification that each backlog shows the other's items.

No migration: `FederatedRecordMirror.recordType` is a free string and the two new types were already declared.

## Governed traceability

- Requirement: spec 2026-08-23 §8 acceptance 4 and 5
- Verification: `packages/db/src/federated-work-contract.test.ts`, `apps/web/lib/federation/work-page.test.ts`, `apps/web/lib/federation/work-sync.test.ts`, `apps/web/app/api/v1/federation/work/route.test.ts`, `packages/db/src/installation-peer-pairing.test.ts`
- Contract: `dpf.work-sync/1`
- Flow: `/ops/demand` backlog sync panel; `federation/demand-reconciliation` scheduled job

## Design grounding

- Existing specs/plans reviewed: `2026-08-23-zero-touch-organization-federation-design.md`, `2026-08-22-installation-identity-and-agent-stance-design.md`, `2026-08-08-purpose-aware-installation-ecosystem-productivity-design.md`, `2026-08-21-purpose-aware-backlog-recovery-design.md`, `2026-07-19-federated-demand-network-design.md`.
- Current code substrate reviewed: `packages/db/src/federated-record-sync.ts`, `apps/web/lib/federation/demand-{reconciliation,delivery,digest,exchange,read-model}.ts`, `apps/web/lib/install/instance-stance.ts`, `packages/db/src/installation-peer-pairing.ts`.
- Source of truth: `FederationLink` (pairing), `FederatedRecordMirror` (provenance and canonical side), `BacklogItem` / `Epic` (the mirrored rows themselves).
- Decision: extend the binding spec with a pull transport for the two work record types (§5.11) rather than adding them to the push outbox. Reason: a development companion must converge on production regardless of production's outbox health, and the observed failure was invisible from the receiving side.
