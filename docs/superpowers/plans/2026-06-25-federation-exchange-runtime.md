# Implementation Plan — Federation Exchange Runtime

**Date:** 2026-06-25
**Parent spec:** `docs/superpowers/specs/2026-06-24-managed-services-delivery-and-cross-org-federation-design.md`
**Parent plan:** `docs/superpowers/plans/2026-06-24-managed-services-delivery-and-cross-org-federation-plan.md`
**Epic:** `EP-MSP-FEDERATION` (runtime wiring, post-merge)

Makes Topology B (sovereign-peer federation) actually exchange data over the merged
substrate. Flag-gated by `DPF_FEDERATION_EXCHANGE_ENABLED` (default off).

## R3 — receiving half (this slice)

The complete inbound contract: a peer DPF can push to us, authenticated by the
peer-issued `dpflink_` token, and we turn it into local records.

- **`lib/auth/federation-link-token.ts`** — resolve a `dpflink_` bearer → FederationLink;
  dual-approval gate (`canExchangeOverLink`): exchange requires a fully trusted link.
  Mirrors `edge-node-token.ts`.
- **`lib/federation/exchange-handlers.ts`** (DB-injected, unit-tested):
  - `handleIncomingIncident` (B3): peer incident → `FederatedRecordMirror` (peer
    canonical, `reconcileMirror` idempotency/conflict) + a local `ServiceTicket`.
  - `handleIncomingProposal` (B4): MSP proposal → re-routed through OUR consent gate
    (`routeRemediationProposal`, customer-allows-auto default off, §15.4) →
    `FederatedRemediationProposal` (proposed / rejected).
- **`lib/federation/client.ts`** — outbound `postToPeer` + `sendIncidentToPeer` /
  `sendProposalToPeer` (CloudEvents envelope). Injected `fetchImpl` for tests. The
  peer token is a CALLER input here (see R4 storage gap).
- **Routes** `POST /api/v1/federation/{incident,proposal}` — flag-gate + link auth +
  handler. Receiving is complete and deployable.

Boundary stubs (intentional — separate substrate, not yet built):
- **Control-runner execution** (EP-CTRL-5E21A4): a proposal lands as `proposed`;
  the MSP never gains standing execute rights. Approved-execution wiring is deferred.
- **Attention Surface posting** (EP-ATTENTION-SURFACE): `attentionItemRef` stays null
  until that surface lands.

## R4 — outbound half + agent loop (next)

- **Peer-token storage**: the outbound client needs the peer-ISSUED link token. That
  is a secret-at-rest (encrypt, not hash, since we must replay it) — add an encrypted
  `peerTokenEnc` column on `FederationLink` + the enroll-acceptor flow that stores it.
- **Outbound triggers**: when R1 creates a correlated incident on a `managed-by`
  estate, push it to the managing peer (`sendIncidentToPeer`). When the MSP agent
  produces a proposal, `sendProposalToPeer`.
- **In-org agent loop (A4)**: operate-orchestrator diagnoses incidents and produces
  remediation proposals (reusing `remediation-authority`).
- **Approval relay + execution**: customer approval → relay to MSP; approved actions
  execute on the customer's own control runner (when EP-CTRL-5E21A4 lands).

## Verification

- Pure handlers + client: vitest (DB / fetch injected).
- Routes: `tsc --noEmit`. Two-instance end-to-end is the founder's live test once the
  outbound half (R4) lands.
