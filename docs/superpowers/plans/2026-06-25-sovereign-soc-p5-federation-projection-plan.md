# Sovereign SOC — P5 federation projection of detections/cases

- **Date:** 2026-06-25
- **Spec:** [2026-06-24-sovereign-soc-siem-design.md](../specs/2026-06-24-sovereign-soc-siem-design.md) §5 (Topology B)
- **Epic:** EP-SOVEREIGN-SOC — **BI-A1267C56** · composes EP-MSP-FEDERATION

## Goal

Topology B (sovereign-peer): the MSP receives a consented, minimized projection of detections/cases — **the sovereignty boundary is the normalized detection, not the raw log.**

## Composes (not rebuilds) the merged egress gate
- `packages/db/src/projection-serialization.ts`: `projectEstatePayload` (allow-list + forbidden-field guard), `assertNoExcludedEgress` (negative-egress proof), `toCloudEvent` — and `FederatedRecordMirror` (the minimized projection store).

## This pass (DONE)
- `apps/web/lib/security/federation-projection.ts`:
  - `SECURITY_PROJECTION_CONTRACT` — only the case + detection SUMMARY slices cross; investigation `timeline` + `evidence` + raw are excluded.
  - `projectSecurityCase` / `buildSecurityCaseCloudEvent` — produce exactly what crosses the link, with the negative-egress proof.
  - `projectSecurityCaseToMirror` — persist the minimized projection as a `FederatedRecordMirror` (idempotent on link+type+caseKey). **Fails closed**: refuses to persist if the negative-egress proof is non-empty.
- Tests: `federation-projection.test.ts` — proves the case summary crosses while timeline + evidence stay local, the projection passes the negative-egress proof, and only allow-listed fields cross.

## Remaining wiring (needs a peer deployment to exercise)
The cross-deployment HTTP send (`POST /api/v1/federation/project`) + receive ingest ride the existing federation enroll/trust routes; they require two DPF deployments to test end-to-end, so they are the federation-transport follow-on. The projection minimization + mirror — the sovereignty-critical, provable core — is complete here.

## Verified
web typecheck clean; federation-projection tests green.
