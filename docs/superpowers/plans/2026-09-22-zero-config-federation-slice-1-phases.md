# Zero-Config Federation Slice 1 — Phased Implementation Plan

**Design:** [`docs/superpowers/specs/2026-09-02-zero-configuration-organization-federation-design.md`](../specs/2026-09-02-zero-configuration-organization-federation-design.md)
**Epic:** EP-ZERO-CONFIG-FEDERATION

> **Status: executed.** This plan is written after delivery, and says so. Both phases below shipped in PR #4998 and the releases that followed. It exists because the delivered work needs live backlog coverage — each independently shippable phase mapped to a filed item — and the design's slice list (§6) was written as prose rather than as a coverage table. Nothing here is a forecast; the verification column records what was actually observed on the live pair.

**Goal:** Two installations of one organization stay paired across teardown, reinstall and upgrade, with no flag, no approval click and no token that can go stale.

**Architecture:** Installation identity and the peer ledger live in portal-owned files under the federation state directory, mounted read-write by the base compose file. The file wins over the database row, and the ledger is absorbed at boot, so a fresh database rebuilds the same trusted links. A reconciliation pass keeps exactly one non-revoked link per peer. The scheduled self-upgrade drains on soft activity signals instead of skipping outright.

---

## Phase 1 — Durable identity, peer ledger, link supersession, upgrade drain

**Backlog item:** BI-DF5F045F · **Merged:** PR #4998 (branch `feat/zero-config-federation`) · **Independently shippable:** yes

Server-side only, no new UI. These belong together because each one removes a seam that failed on the same night: identity that did not survive a reinstall, a ledger that a fresh database could not rebuild, duplicate links to one peer, and a scheduled upgrade that never ran.

- [x] `<state dir>/federation/identity.json` and `peers.json`, portal-owned and mounted read-write at `/dpf-federation` by the base compose file; the file wins over the database row
- [x] Ledger absorbed at boot, so a fresh database shows the same trusted links
- [x] Exactly one non-revoked same-organization link per peer, older ones revoked `superseded-by:<linkId>`
- [x] Scheduled self-upgrade drains on soft signals instead of skipping (closes BI-A9F04B91)

**Traced refs.** Contracts: `apps/web/app/api/v1/federation/work/route.ts`. Flow: `apps/web/lib/queue/functions/demand-reconciliation.ts`. Acceptance: AC-STATE-DIR-REINSTALL, AC-LEDGER-ABSORBED, AC-LINK-COLLAPSE, AC-SOFT-ACTIVITY-DRAINS. Objectives: OBJ-DURABLE-IDENTITY, OBJ-ONE-LINK-PER-PEER, OBJ-UNATTENDED-UPGRADE.

**Verification:** the development and production installs have stayed paired across every release since 2026-09-06; `link_6c0361010d474467` is still trusted and syncing on 2026-09-22, and the work-sync mirror reports 2,152 items copied minutes ago.

## Phase 2 — Retire the exchange flag

**Backlog item:** BI-006A04FE · **Merged:** PR #4998 · **Independently shippable:** yes

Every federation capability sat behind `DPF_FEDERATION_EXCHANGE_ENABLED`, defaulting to off, appearing nowhere in the product and raising no error when it blocked something. An operator could complete the whole connection flow, see it report success, and have nothing work.

- [x] The gate removed from the approval relay, demand exchange, demand reconciliation, incident exchange, introductions, proposals, the outbound approval relay and the demand-reconciliation queue job
- [x] The compose variable no longer gates anything and no longer defaults to off

**Traced refs.** Contracts: `apps/web/app/api/v1/federation/work/route.ts`. Flow: `apps/web/lib/queue/functions/demand-reconciliation.ts`. Acceptance: AC-NO-EXCHANGE-FLAG. Objectives: OBJ-NO-CONFIGURABLE-SEAM.

**Verification:** on `main` at 2026-09-22 the only remaining mentions of `DPF_FEDERATION_EXCHANGE_ENABLED` are one test-teardown line and the compose entry, which now defaults to `1`. No route, action or job reads it.

---

## Coverage

| Phase | Deliverable | Backlog item | Objectives served | Acceptance verified |
| --- | --- | --- | --- | --- |
| 1 | Durable identity, peer ledger, link supersession, upgrade drain | BI-DF5F045F | OBJ-DURABLE-IDENTITY, OBJ-ONE-LINK-PER-PEER, OBJ-UNATTENDED-UPGRADE | AC-STATE-DIR-REINSTALL, AC-LEDGER-ABSORBED, AC-LINK-COLLAPSE, AC-SOFT-ACTIVITY-DRAINS |
| 2 | Exchange flag retired from every gate | BI-006A04FE | OBJ-NO-CONFIGURABLE-SEAM | AC-NO-EXCHANGE-FLAG |

Every acceptance criterion in the design's section 8 manifest is covered above: AC-STATE-DIR-REINSTALL, AC-LEDGER-ABSORBED, AC-LINK-COLLAPSE and AC-SOFT-ACTIVITY-DRAINS by phase 1, AC-NO-EXCHANGE-FLAG by phase 2.

Slices 2 and 3 of the design (`§6`) are covered by their own plan, [`2026-09-22-portal-mediated-membership-phases.md`](2026-09-22-portal-mediated-membership-phases.md).
