# GAID-Federated Work Room Participants — Implementation Plan (BI-4CA4FCE5)

**Epic:** EP-WORKROOM-COMMS (Phase 2) · **Date:** 2026-08-14 · **Scope:** platform (WWMD)
**Design of record:** `docs/superpowers/specs/2026-08-12-work-room-multi-agent-communication-substrate-design.md` §5 · **Kernel:** DI-A92A7184020F (intra-first; Phase 2 follows Phase 1)
**Builds on:** the federated GAID/A2A coordination substrate (`2026-08-08-federated-a2a-gaid-coordination-design.md`, `2026-08-11-a2a-coordination-layer-design.md`).

Let an external agent/person from another install join a room — GAID-identified, outcome-scoped, never carte-blanche — with sovereignty preserved: their join/posts are MIRRORED in via the federation envelope, never a direct remote write. Room membership stays PRN-based; the sovereignty boundary lives in the ingress/mirror layer.

## Slice delivered (this PR) — the sovereignty-preserving "apply" primitives

Conservative first slice: **same-org, trusted links only, behind `DPF_FEDERATION_A2A_ENABLED` (off by default)**. No migration (all new values ride existing free-string columns).

- **Foreign GAID → local mirrored principal** — `ensureFederatedRoomPrincipal({foreignGaid, issuer, displayName})` (principal-linking.ts): a `Principal(kind:"external-agent")` carrying a `gaid` alias with the **foreign** issuer namespace (never the empty INTERNAL_ISSUER, so it can't collide with a local agent's GAID). This is the local identity a room admits by PRN.
- **Sovereignty gate (pure)** — `evaluateFederatedRoomAdmission({a2aEnabled, linkTrusted, sameOrg})`: deny-by-default; all three required. Tested.
- **Admit primitive** — `admitFederatedRoomParticipant(...)`: gate → mint mirrored principal → `appendRoomPolicyParticipant` (admit the mirrored PRN, outcome-scoped to that one room) → persist `WorkItem.evidence`. `linkTrusted`/`sameOrg` resolved by the caller from the federation link auth.
- **Mirror inbound posts** — `mirrorFederatedRoomMessage(...)`: an inbound federated post becomes an external `WorkItemMessage` (`senderType:"external"`, `channel:"a2a"`, GAID in `structuredPayload`), idempotent on the peer event id — the human external-channel-ingress pattern applied to A2A. Never a direct remote write.

## Follow-ups (deliberately deferred — noted in the design)

- **HTTP CloudEvent ingress dispatch** — add `dpf.room.participant-joined` / `dpf.room.message-posted` to the federation inbox dispatch (`api/v1/federation/…`), landing a `FederatedRecordMirror(recordType:"room-*")` then calling these apply primitives. Depends on peer-side event emission.
- **RFC 9421 device signature + `peerSigningPublicKey` pinning + an A2A-readiness bit on `FederationLink`** (spec §4.3, §9) — a migration + enrollment-handshake change. This slice runs on **token-trust only**; label it the **"A2A-shaped DPF federation profile,"** not "A2A compliant."
- **Cross-org** projection-contract egress minimization + signed commitments (spec §8.2, §11) — first slice is same-org, deny cross-org.
- Typed `senderGaid`/`senderPrincipalId` columns and a `WorkRoomParticipantView.kind` policy marker — kept in `structuredPayload` / derived from the mirrored `Principal.kind` to avoid migrations.
