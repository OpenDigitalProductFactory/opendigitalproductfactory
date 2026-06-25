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

## R4 — outbound half (landed in this slice)

- **Peer-token storage (LANDED)**: encrypted `peerTokenEnc` column on `FederationLink`
  (AES-256-GCM via credential-crypto — we must replay the token, not hash it) + migration.
- **Outbound enrollment (LANDED)**: `enrollWithPeer` redeems a peer's invitation,
  creates our side of the link (`role = inverse` of the peer's), and stores the
  peer-issued token encrypted. Error paths unit-tested; success path typecheck-validated.
- **Outbound push building block (LANDED)**: `pushIncidentsToManagingPeer` — when we are
  the managed-by side of a trusted link, push our incidents to the managing peer
  (`sendIncidentToPeer`, idempotent via a payload hash the peer reconciles). DB + fetch
  injected; unit-tested.

## Genuine remaining boundaries (need other epics or two-instance design)

- **Dual-approval RELAY**: a link only reaches `trusted` when both sides approve AND the
  peer-approval is relayed to flip our `approvedAtPeer`. That relay is a two-instance
  protocol best designed + verified against two live installs — not built blind here.
  Until it lands, the push building block stays dormant (no trusted managing link).
- **Control-runner execution** (`EP-CTRL-5E21A4`): approved remediation executes on the
  customer's own runner — owned by that epic. Proposals stay `proposed`.
- **Attention-Surface approval UI** (`EP-ATTENTION-SURFACE`): where above-band proposals
  surface for human approval — owned by that epic.
- **LLM agent diagnosis (A4)**: operate-orchestrator producing proposals via the coworker
  runtime (vs. the deterministic authority-band path already built).
- **Connect-to-peer admin button**: a small form on the `/platform/federation-links`
  surface (R2) to call `enrollWithPeer` — follow-up once R2 merges.

## Verification

- Pure handlers + client: vitest (DB / fetch injected).
- Routes: `tsc --noEmit`. Two-instance end-to-end is the founder's live test once the
  outbound half (R4) lands.
