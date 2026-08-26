---
status: active
---

# Estate intelligence bundle — evidence, routing, tooling, commons

**Backlog item:** BI-B19C41B8 (umbrella)
**Also delivers:** BI-654EE2E9, BI-E72BA4CD, BI-57C27DE1
**Date:** 2026-08-11
**Follows:** #4198 (fingerprint wiring), #4201 (AI-gate calibration). This bundle
fixes the layer that live use revealed underneath those: discovery evidence,
model routing, coworker tooling, and the shared fingerprint commons.

## Design grounding

Each fix extends existing substrate — no new tables/enums/contracts:
- Discovery: extends `discovery-promotion-policy` gates + `discovery-reconcile`.
- Routing: extends `cost-ranking` (adds the ignored capability-tier signal).
- Tooling: hardens the `authorized-surface-runtime` failure message.
- Commons: adds a pure privacy-boundary module consumed by `device-investigation`.

## Fix 1 — Evidence-based discovery (BI-B19C41B8)

A /24 sweep enumerated every address and promoted a "LAN Host 192.168.0.N" product
per IP — 256 phantoms with no MAC (never answered) plus 55 Docker-bridge rows —
burying real devices and feeding coworkers false counts.

- `hasObservationEvidence()` (promotion-policy): a host is a device only with a
  MAC / vendor / hostname / ports, or a trustworthy source (UniFi/mDNS/SNMP). A
  bare ARP row with no MAC is a phantom.
- Promotion evidence gate: a real-estate host with `hasObservationEvidence: false`
  is skipped (`no_observation_evidence`, terminal-structural — no quality issue).
- `shouldDemotePromotedProduct()` + reconcile: demote products whose every linked
  entity is infra OR an unevidenced phantom; evidenced devices are kept.
- On-boot `reconcilePhantomProductsOnBoot` self-heals the existing phantoms.

## Fix 2 — Routing prefers the tier the operator configured (BI-654EE2E9)

Claude/Codex (frontier, free) tied local qwen (adequate, free) on success-probability
alone, and the stable sort silently kept local — the scorer ignored capability tier.
- `cost-ranking`: free / quality branches now weight success-probability by a
  capability-tier multiplier (frontier 1.0 → basic 0.4), so a free frontier
  endpoint outranks a free adequate one.

## Fix 3 — A coworker tool failure is not "empty" (BI-E72BA4CD)

`surface_open` returned "No Authorized Surface matches" for a populated node, and a
weak model reported the node empty.
- The `surface_not_found` failure message is now self-describing: a tooling/
  authorization gap, explicitly NOT evidence that the data is empty; report the
  surface could not be loaded.

## Fix 4 — Privacy-scrubbed commons contribution (BI-57C27DE1)

Common knowns should grow the shared catalog so they never need AI — with a hard
privacy boundary.
- New `fingerprint-commons-contribution`: `buildCommonsFingerprint` is the SOLE
  constructor of a contribution; it emits only a generalizable `{vendor,
  deviceClass}` and returns null for proprietary/unidentified/incomplete, never
  reading IP/host/MAC/serial. `assertNoIdentifiers` is defense-in-depth.
- `device-investigation` attaches the scrubbed contribution to its result.
- Remaining slice (documented, not in this PR): the cross-install ingestion POST
  and the human-confirmation trigger. The privacy boundary — the load-bearing,
  safety-critical part — is complete and tested here.

## Verification
- 355 db discovery/module tests, 104 routing tests, 21 coworker-surface tests,
  db typecheck — all green; full sandbox gate before merge.

## Backlog coverage
- Decision: decomposed
- Parent: BI-B19C41B8
- Receipt: cmspi9ar50lp001qrccd2e3h2
- Dependencies: none
- Deliverable -> BI mappings:
  - evidence-based discovery -> `BI-B19C41B8`
  - routing tier preference -> `BI-654EE2E9`
  - coworker tool-failure guard -> `BI-E72BA4CD`
  - commons privacy boundary -> `BI-57C27DE1`
