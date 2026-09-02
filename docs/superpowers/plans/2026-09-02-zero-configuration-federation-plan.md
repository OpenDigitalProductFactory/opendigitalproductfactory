---
status: active
---

# Zero-configuration federation implementation plan

**Epic:** EP-ZERO-CONFIG-FEDERATION
**Design:** `docs/superpowers/specs/2026-09-02-zero-configuration-organization-federation-design.md`

## Slice 1 — remove every seam that failed on 2026-09-02 (this PR)

1. `durable-state.ts`: portal-owned `<state dir>/federation/` with `identity.json` and `peers.json`, private atomic writes, absent/unwritable directory tolerated. Base compose mounts it read-write at `/dpf-federation`.
2. `demand-identity.ts`: the file wins; the database row is a cache. Without a file, the database identity is used and persisted. An undecryptable private key keeps the ids peers hold and mints a fresh keypair.
3. `peer-ledger.ts`: write every non-revoked link (inbound hash, peer token in clear, approvals, identity facts); absorb at boot, recreating links a fresh database lacks. Idempotent; never overwrites.
4. `link-supersession.ts`: one non-revoked same-organization link per peer; older ones revoked `superseded-by:<linkId>`.
5. `boot-reconcile.ts`: identity → absorb → supersede → ledger at boot (`instrumentation.ts`), and supersede → ledger on every federation tick.
6. Remove every `DPF_FEDERATION_EXCHANGE_ENABLED` gate; compose passthrough kept one release as a no-op defaulting on.
7. Scheduled self-upgrade uses the manual rule: only hard blockers skip; soft signals drain (BI-A9F04B91).
8. Tests for each module and the behaviour changes; operations doc.

## Slice 2 — membership-proof pairing (§5.6)

Signed enrolment statement with the member's authority certificate, chain verified against the pinned organization root at the message layer; link born trusted on both sides; `authority_portal_url` in the join package; boot-time enrolment with the authority; introductions over the trusted link.

## Slice 3 — health line (§5.7) and schema-derived validator bounds

## Governed traceability

- Requirement: spec §7 acceptance 1–5 (slice 1), 6 (slice 2)
- Verification: `durable-state.test.ts`, `peer-ledger.test.ts`, `link-supersession.test.ts`, `demand-identity.test.ts` (durable cases), `self-upgrade.test.ts` (scheduled drain), federation route tests (no flag)
- Contract: `identity.json` / `peers.json` schema v1
- Flow: portal boot; `federation/demand-reconciliation` tick

## Design grounding

- Existing specs reviewed: `2026-08-23-zero-touch-organization-federation-design.md`, `2026-08-22-installation-identity-and-agent-stance-design.md`, `2026-08-22-governed-installation-teardown-design.md`, `2026-07-19-federated-demand-network-design.md`, `2026-08-08-purpose-aware-installation-ecosystem-productivity-design.md`.
- Substrate reviewed: `demand-identity.ts`, `enrollment.ts`, `outbound.ts`, `federation-link-token.ts`, `nearby-pairing-service.ts`, `organization-trust-anchor*.ts`, `self-upgrade.ts` precheck, `quiescence.ts` blockers, `docker-compose.yml` state mount, `install-state.v2.schema.json`, `uninstall-dpf.sh`.
- Source of truth: `<state dir>/federation/identity.json` (identity), `FederationLink` + `peers.json` (links), organization root under `<state dir>/pki` (membership).
- Decision: new binding spec that supersedes the open "remaining slice" of the 2026-08-23 design; identity and peers move to the state directory the installer already preserves rather than adding installer flags or schema fields to `install-state.json`.
