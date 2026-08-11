# Discovery estate fidelity — repair + self-healing automation

**Backlog item:** BI-BAF38ED3
**Date:** 2026-08-11
**Source of truth (extends, does not replace):**
`docs/superpowers/specs/2026-04-25-discovery-fingerprint-contribution-pipeline-design.md`,
`docs/superpowers/specs/2026-04-25-discovery-taxonomy-gap-triage-design.md`,
and the existing `docker-origin` containment substrate.

## Design grounding

- **Searched substrate first.** The fingerprint layer (spec §4 layer 0), the
  device-class rules (`data/discovery_fingerprints/rules/estate-foundational-devices.json`),
  the `docker-origin` containment helpers, and the `inventory-enrichment-backfill`
  boot pattern already exist. This is a **wiring + reconcile** change, not a new
  contract: no new tables, enums, or capabilities.
- **Decision:** extend the canonical pipeline (one shared attribution-inputs
  loader used by all ingestion paths) rather than fork per-path logic; extend the
  existing docker-origin containment into the inventory view model rather than add
  a new "internal" concept.

## Problem (measured on a live install, 719 InventoryEntity rows)

1. Consumer/IoT devices (Whirlpool, Amazon Echo, Nest, Ubiquiti, TP-Link, an Apple
   laptop) were filed under `foundational/compute/servers` and named only
   `OUI-vendor + IP`; `identityStatus`/`catalogIdentityId` NULL on all 719.
2. Root cause: `fingerprintAttribution` short-circuits on empty `fingerprintRules`,
   and two of three ingestion paths (`persistSubmittedDiscoveryRun`,
   `apps/web/lib/actions/discovery.ts`) never loaded the rules — so every host fell
   to the coarse `host -> /servers` rule at 0.98 confidence.
3. DPF's own self-scan footprint (~255 rows: containers, docker host, bridge nets)
   was blended into the managed estate.

## Phases

### Phase 1 — Wire the fingerprint layer into every ingestion path
- New `packages/db/src/discovery-attribution-inputs.ts`:
  `loadDiscoveryAttributionInputs(db)` — the single loader for taxonomy nodes +
  active fingerprint rules (extracted from `discovery-runner.ts`).
- Call it from all three normalize sites: `discovery-runner.ts` (refactor),
  `persist-submitted-discovery-run.ts` (edge-node), `actions/discovery.ts` (UniFi).
- Coverage: regression test in `persist-submitted-discovery-run.test.ts` — a
  Whirlpool host fingerprints to the appliance node, not `/servers`.

### Phase 2 — Demote the coarse host→servers rule
- `discovery-attribution.ts`: a `host` defaults to `/servers` **unless** it is an
  `isUnidentifiedNetworkSweepHost` (OUI/MAC evidence, no OS signal, no fingerprint
  match) — those route to `needs_review` instead of a false-confident server.
- Corroborated compute hosts (OS/platform signal) and bootstrap host-collector
  hosts keep the servers default.

### Phase 3 — Contain DPF-instance internals
- `apps/web/lib/consume/discovery-data.ts`: partition `isDockerOriginEntityKey`
  rows out of the managed estate (`ungrouped`/`totalCount`) and expose a single
  `dpfInstance` containment summary.
- `SubnetGroupedInventoryPanel.tsx`: render one "This DPF instance" contained card.

### Phase 4 — Idempotent self-healing backfill (on upgrade, all installs)
- New `packages/db/src/discovery-attribution-backfill.ts`:
  `backfillDiscoveryAttribution({ dryRun })` re-runs the fingerprint layer over
  persisted rows; diff-only writes (idempotent), skips contained internals,
  applies the Phase-2 demotion. `dryRun` previews impact with no writes.
- `apps/web/lib/onboarding/backfill-discovery-attribution-on-boot.ts` +
  `instrumentation.ts`: fire-and-forget on boot, non-fatal, quiet once healed —
  so this install and every upgraded install self-heal with no operator action.

## Verification
- Unit: 6 backfill + 2 attribution + 1 edge-node persist regression tests; full
  `packages/db/src/discovery*` suite green (330 tests).
- Live dry-run (read-only) against the install DB: 59 devices re-identified, 37
  demoted, ~255 contained (estate 719 → ~464).

## Explicitly out of scope (follow-ups)
- **Fingerprint-rule / vendor coverage growth** (Google, Espressif, LG Innotek,
  Roku, Sonos, …): the identity heal is bounded by the 13 shipped rules. Peer
  parity needs broader coverage — tracked separately.
- **Regular UniFi/SNMP polling cadence**: richer device identity from the UniFi
  controller depends on it running more than once. Separate connection-scheduling
  work.
- Populating `technicalClass` from `resolvedIdentity.deviceClass` (needs a
  normalize→persist field thread; deferred to avoid divergence).

## Coverage
- Parent: BI-BAF38ED3
- Decision: extend canonical pipeline + docker-origin containment (grounding above)
- Receipt: this plan + PR
- Dependencies: none blocking
- Follow-ups -> new BIs for rule-coverage growth and UniFi polling cadence
