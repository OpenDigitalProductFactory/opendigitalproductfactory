---
status: draft
---

# Production Authority and Development Companion — Implementation Plan

**Date:** 2026-10-27

**Umbrella:** `BI-CCE04F19` (xlarge, decomposed) under `EP-E1F1DB58`

**Design:** [Production Authority and Development Companion Installations](../specs/2026-10-27-production-authority-development-companion-design.md)

**Status:** Draft. Plan coverage is recorded after the design's independent spec approval mints the `BI-CCE04F19` scope baseline. No implementation starts before then, or before plan review.

## 1. Outcome

the operator PROD install is the authority for its estate. The Windows install becomes its attested development companion. With the full plan delivered:
- **Guidance and budget:** the companion decides and funds work under production's signed, expiring guidance and budget envelope.
- **No double work:** the two installations never hold a claim on the same item at once.
- **Shared threads:** threads on either installation converse in rooms whose membership the home installation decides.
- **Identity:** production issues the agent identities both installations trust.

## 2. Phases and backlog coverage

| Key | Deliverable | Backlog item | Depends on | Design | Acceptance |
| --- | --- | --- | --- | --- | --- |
| P0a | Outbox head-of-line fix (PR #6633) | `BI-26E3B9C9` | — | §2.3 | its own |
| P0b | Preview clone no longer carries production identity (PR #6635) | `BI-8F9A3499` | — | §2.3 | its own |
| P0c | Attested peer environment class | `BI-0716C8A8` | — | §3 | its own |
| P0d | First-hop delegation intersection | `BI-FD00E416` | — | §3 (authority is an intersection) | its own |
| P1 | Derived authority/companion relationship; repair stale paired reference | `BI-B50BE189` | P0c | §3, §8 | AC-PAC-16 |
| P2 | Re-purpose the Windows install (operator steps 1–5) | `BI-981AE847` | P1 | §8 | AC-PAC-15, AC-PAC-16 |
| P3 | Guidance snapshot: WWWD | `BI-1B165D02` | P1 | §4.1–4.3 | AC-PAC-01, AC-PAC-02, AC-PAC-04 (guidance) |
| P4 | Budget envelope, companion funding binding, local limit, spend reports | `BI-32EB31FD` | P3 | §4 | AC-PAC-03, AC-PAC-04 (budget), AC-PAC-05 |
| P5 | Claim register in a private coordination repository, with fencing | `BI-30EDDB7F` | P1; operator D1 | §5 | AC-PAC-06 to AC-PAC-09 |
| P6 | Organization boundary on what crosses | `BI-3E31B240` | — | §2.3, §10 | its own |
| P7 | Estate GAID namespace, continuity, signed identity documents | `BI-7E73D523` | P0c | §7.1–7.2 | AC-PAC-13, AC-PAC-14 |
| P8 | Cross-install rooms and threads | `BI-0F8CEAD4` | P7, P0d | §6 | AC-PAC-10 to AC-PAC-12 |
| P9 | Identity-document token exchange (later) | `BI-1EBF7C93` | P7 | §7.3 | its own |
| P10 | Overlay for when production travels | `BI-80658CD3` | operator overlay setup | A2A design §18 | its own |

**Coverage decision: decomposed.**
- Each row ships and verifies independently.
- P0a–P0d and P6 are standalone repairs.
- P3 delivers value before P4.
- P5 and P7 do not depend on each other.

**Parallel lanes.** These can run at the same time: P0a–P0d; P5; P6; P7.

**Thinnest path to the operator's first working loop:** P0c, then P1, then P2, then P3, then P5. At that point the companion follows production guidance and the two installs no longer double-work an item. P4, P7 and P8 follow.

Related live items to reconcile, not duplicate:
- `BI-2641F34A`, claim integrity;
- `BI-636A11B3`, auto-claim;
- `BI-6B02FEE5`, lease-guard parity;
- `BI-4CA4FCE5`, room primitives (delivered);
- `BI-3F21C4D5`, local room mechanics;
- `BI-7245485A`, federated MCP identity challenge;
- `BI-50136281`, companion funding fails closed.

## 3. Phase detail

Every phase starts with a failing test reproducing the gap at the cited line on `origin/main`.

- **P1:** stance resolver input gains the peer's attested class and estate match. The relationship appears in the stance briefing and on Connections. The paired reference is stored as an installation DID, with a stale-reference detector.
- **P2:** the operator acts at the Windows machine. The agent prepares exact steps, reads the result through peer posture, and records evidence. No credential is handled by an agent.
- **P3:** adds:
  - a `guidance-snapshot` record type and validator in `packages/db/src`;
  - JWS signing with the installation key;
  - a manifest hash check and version/expiry handling;
  - resolver changes in `apps/web/lib/decision-perspective/material.ts` with narrowing-only merge;
  - removal of the platform-profile fallback on a companion.
- **P4:** adds:
  - envelope fields in the snapshot;
  - companion funding binding issuance on the authority, and its projection;
  - enforcement in `investment-balance-server.ts` admission and the model-routing cost meter;
  - a `spend-report` outbox record and authority reconciliation into showback.
- **P5:**
  - a claim-ref client, using git over HTTPS to the configured private repository with the installation's deploy credential, which the operator provides;
  - signed claim records;
  - integration in `claimWorkCapsuleScope` and `assertBacklogWorkroomClaimAvailable`;
  - fence propagation into PR metadata and evidence;
  - PR-health and evidence-intake fence checks;
  - inventory display.
- **P7:**
  - issuer namespace registration and `AuthorityBinding` field;
  - GAID minting and migration with continuity records;
  - JWS identity documents, trust bundle and status list;
  - companion verifier;
  - mapping to `ensureFederatedRoomPrincipal`.
- **P8:**
  - `dpf.room.*` event families and validators;
  - home membership publisher;
  - mirror authorization, which fixes `mirrorFederatedRoomMessage`;
  - proposal flow;
  - thread binding through `TaskRun.contextId`;
  - tool changes;
  - `roleKind` fix.

## 4. What the operator must provide

| # | Item | Needed for |
| --- | --- | --- |
| D1 | A private coordination repository for claims (private GitHub repository or self-hosted GitLab), plus a deploy credential per installation | P5 |
| D2 | Presence at, or remote access to, the Windows install for re-purposing | P2 |
| D3 | The funding owner's first budget envelope for the companion (amount per bucket and period) | P4 |
| D4 | Overlay account or Headscale server (A2A design §22 D1) | P10, and any cross-network use while production travels |

## 5. Verification

- **Prerequisites only:** contract and unit tests per phase, covering signatures, version and expiry, narrowing merge, fencing, membership authorization and namespace migration.
- **Acceptance:** functional, on both physical installations (design §12). A worktree-only pass is a source checkpoint, not acceptance.
- **Unverified at plan time:** the Windows install's declared class, purpose, served version, Edge status and PowerShell hosts (design §2.3).

## 6. Rollback

- Each record type is versioned and ignored by an installation that does not know it.
- A companion with no valid snapshot reports "no organization guidance" and funds nothing. That is safe, not open.
- Claims degrade to unconfirmed local claims.
- Rooms fall back to local-only.
- The previous GAIDs stay resolvable through continuity records.

## 7. Coverage receipt

Pending. It will be recorded with `record_plan_backlog_coverage`, decision `decomposed`, after spec approval mints the `BI-CCE04F19` baseline.
