---
title: Design-stage platform reviewer research
date: 2026-11-06
status: chosen
backlogItem: BI-9CCB88C4
workroom: WC-31D0DE6C
---

# Design-stage platform reviewer — research (BI-9CCB88C4)

Medium research for a fix. This note is the design choice: named-ref
reproduction, options considered, the option chosen. It does not approve
implementation.

**WWMD already chose the architecture.** DI-3C73211052BB (2026-10-27,
platform-development, high confidence): in-platform steward lane. This note
does not re-score that. It records how this install reproduces the gap and
which local extension of the PIR steward satisfies AC-1/AC-2/AC-3.

**Parent steward:** BI-AA47C672 / PR #6707,
[`platform-review-room.ts`](../../../apps/web/lib/backlog/initiative-readiness/platform-review-room.ts).
**Peer remainder (do not mutate):** BI-30EB6898, federated origin
`inst_5825a80201e7476e978622b78dcd04ba`. This item is the locally owned
capture of the defect observed here.
**Runbook:** [initiative-readiness-runbook.md](../../architecture/initiative-readiness-runbook.md)
(last sentence of the PIR paragraph: "Design-stage reviews keep their author
carrier.").
**Commandment:** [platform-function-never-depends-on-a-client](../../founder-kernel/wiki/principles/platform-function-never-depends-on-a-client.md).

## Problem

An owed design-stage review does not run when the authoring assistant's only
standing connection is a credentials-registered OAuth client, and the
platform's own reviewer will not take that packet.

Live reproduction 2026-11-06 on this install, item BI-015012AA, room
WC-11DD9FFD, branch `feat/osm-leaf` head
`bf4cf71b789dbe4af969f554a16af79177fb1582`, bound 08-29 spec blob
`284b05dabc5e22224792f829de15daf251fdcca3`. Packet IRD-36A98513 named
AGT-132 for gate `design-spec`. `request_coworker` with that packet
unchanged returned `independent_review_request_denied` / "The connection's
authorization is no longer current."

## Named-ref reproduction

Worktree `fix/design-stage-platform-reviewer` at origin/main
`b65bb53582ef3f90393bc51c46c18d289f2ddfab` (2026-11-06). The same three
facts hold on this SHA:

1. **Credentials clients cannot request independent review.**
   `apps/web/lib/mcp/independent-review-request.ts` lines 94–97 refuse when
   `token.oauthClient?.registrationKind === "credentials"`. Live call from
   this Grok `dpfoc_` client hit that branch. Token refresh does not change
   registration kind.

2. **The dispatcher still treats that token as a live carrier.**
   `apps/web/lib/auth/oauth-tokens.ts` lines 145–146 allow a credentials
   token with no `authorityBindingId`. `findStandingConnection` /
   `firstLiveConnection` (`apps/web/lib/mcp/standing-connection.ts` lines
   50–52) skip only `!isCurrentOAuthExecutionAuthority`. The Grok
   credentials row is therefore selected. `dispatchReviewerRequest`
   (`apps/web/lib/backlog/initiative-readiness/server-reviewer-dispatch.ts`
   lines 484–527) then `governedExecuteTool("request_coworker")` on it and
   records `refused`.

3. **The PIR steward never sees the packet.**
   `routeToPlatformReviewer` runs only when `!connection` (same file, lines
   487–493). A credentials connection is truthy, so the fallback is skipped.
   Even if it ran, `PLATFORM_REVIEW_GATE = "post-implementation-review"`
   (`platform-review-room.ts` line 54) and `parsePlatformReviewPacket` lines
   107–109 require that exact gate plus
   `record_initiative_post_implementation_review`. A design-spec packet
   returns `not-applicable`. The runbook states the exclusion in words:
   "Design-stage reviews keep their author carrier."

Result on the live install: a Grok-authored large item cannot obtain
independent design-spec unless a consent-bound Claude or Codex session
carries it. That is a client dependency for a platform guarantee.

## Causes ruled out (by live calls, not by reading)

| Hypothesis | How it was run | Verdict |
| --- | --- | --- |
| Access token expired | Refreshed the Grok MCP token; same denial, same `registrationKind` | Ruled out |
| Token missing `initiative_design_review` | Token scopes include it; denial text is "authorization is no longer current", which maps to the credentials branch, not grant intersection | Ruled out as the dispatch miss. Agent grant on AGT-EXT-GROK still does not include that grant; that is a separate residual, not this BI |
| No packet issued | `get_backlog_item` recoveryGate=design-spec returned IRD-36A98513 with `reviewerRoutes[]` and bound blob 284b05da | Ruled out |
| PIR steward already admits design-spec | `parsePlatformReviewPacket` on this SHA requires PIR gate+writer; PIR tests only cover `post-implementation-review` | Ruled out |
| Local unpaid item already covers it | `search_knowledge` / `query_backlog`: BI-30EB6898 is peer-owned (`peer_owned_item` on triage); BI-54A4AC9D retired duplicate; BI-AA47C672 done PIR-only; BI-3A462B04 done consent-bound dispatch | Ruled out. Filed BI-9CCB88C4 |
| Missing standing connection | `isCurrentOAuthExecutionAuthority` allows the credentials row; dispatcher selected it and recorded `refused`, not `no-author-connection` | Ruled out |

The failing-then-passing unit test is the first implementation step
(`dpf-tdd`), not this research receipt. The defect is proven on the named
SHA by the live MCP refusal plus the three cited branches.

## Options considered

### A. Relax the credentials refusal so this client can call `request_coworker`

Let a `dpfoc_` credentials OAuth client carry independent review. Rejected.
WWMD DI-3C73211052BB scored it down: it would undo the deliberate
credentials-client refusal in `independent-review-request.ts`. Independent
review is a consent-bound act. AC-2 of this item forbids it.

### B. Record a human sign-in fallback

Keep dispatch on the author carrier; tell the operator to reconnect Claude
or Codex. Rejected. The commandment test fails: the review would not run on
an install with no consent-bound client. WWMD rejected a recorded fallback
for the same reason.

### C. Borrow a requesting-user Claude/Codex connection for Grok-authored rooms

Build Studio already prefers AGT-EXT-CLAUDE / AGT-EXT-CODEX on the
`requesting-user` carrier. Flip Grok-authored delivery rooms onto that
carrier when the author-assistant connection is credentials-kind. Rejected
as the chosen architecture. It still depends on some other client's
standing OAuth, and it mixes author identity with a different assistant's
token. WWMD chose the in-platform steward, not a cross-client hitch.

### D. Skip credentials as a `request_coworker` carrier, then extend the PIR steward

Two local edits to the existing lane:

1. In `firstLiveConnection`, when `toolName === "request_coworker"`, skip a
   row whose `oauthClient.registrationKind === "credentials"`. Other tools
   keep using credentials connections. `dispatchReviewerRequest` then sees
   `!connection` and already calls `routeToPlatformReviewer`.
2. Admit owed `design-spec`, `spec-approval`, and `architecture-review`
   packets the same way PIR is admitted today: platform-issued packet,
   in-platform reviewer, the packet's lane grant, not a delivery actor,
   re-derived at write time. PIR identity (`platform-review:<itemId>`,
   `WC-PIR-*`, `platform-post-implementation-review`) stays byte-compatible.

Chosen. Matches DI-3C73211052BB. Matches AC-1/AC-2. After merge and
canonical deploy, AC-3 is live proof on BI-015012AA's current design-spec
packet.

## Comparables

| Comparator | Adopt | Reject |
| --- | --- | --- |
| [OAuth 2.0 RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749#section-4.4) client_credentials | A credentials client acts as itself. Independent review stays on authorization-code / consent-bound clients, or on a platform-issued packet that never uses that token. | Treating client_credentials as a person's review-request authority. |
| [Kubernetes controllers](https://kubernetes.io/docs/concepts/architecture/controller/) | The control plane reconciles owed state on its own schedule. A laptop operator can accelerate; it is not the thing that makes the reconcile happen. | A new controller framework. Reuse the Workroom drive + ScheduledAgentTask path PIR already uses. |
| [GitHub required status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) | Required reviews run on the host, not on the author's workstation. | GitHub's identity model. DPF already has in-platform reviewers and packet admission. |
| Existing PIR steward (BI-AA47C672, BI-099A0BA3) | Platform-issued packet, `PLATFORM_REVIEW_ISSUER_ID`, in-platform reviewer, lane grant, not a delivery actor, re-derive at write. One room per (item, gate). | One room per item for every gate. PIR rooms already exist as `WC-PIR-*` with a PIR writer and PIR shape. |
| [NIST AI RMF Govern](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf) | Automated actors stay on a named human owner (the Foundational portfolio accountable person already owns PIR rooms). | New authority or a platform-held service account. |

## Room-key sub-choice (under D)

**D1. Reuse `WC-PIR-*` / `platform-review:<itemId>` for design-stage packets.**
Rejected. Live PIR rooms exist. The PIR shape mandates
`record_initiative_post_implementation_review`. Reviewer binding is
one-per-room. An item can owe design-spec now and PIR after merge.

**D2. Per (item, gate) rooms; PIR identity unchanged.** Chosen.

| Gate | Writer | Grant | Stage evidence | Room key | Capsule |
| --- | --- | --- | --- | --- | --- |
| post-implementation-review | `record_initiative_post_implementation_review` | `initiative_design_review` | `pir-receipt` | `platform-review:<itemId>` | `WC-PIR-<id>` |
| design-spec | `record_initiative_design_review` | `initiative_design_review` | `spec-approval-receipt` | `platform-review:design-spec:<itemId>` | `WC-DSR-<id>` |
| spec-approval | `record_initiative_design_review` | `initiative_design_review` | `spec-approval-receipt` | `platform-review:spec-approval:<itemId>` | `WC-SAR-<id>` |
| architecture-review | `record_initiative_architecture_review` | `initiative_architecture_review` | `architecture-review-receipt` | `platform-review:architecture-review:<itemId>` | `WC-ARR-<id>` |

Evidence kinds come from the existing map
`INITIATIVE_GATE_STAGE_EVIDENCE_KIND` /
`REVIEW_STAGE_EVIDENCE_BY_GATE` in
`apps/web/lib/work-management/readiness-review-stages.ts`. Design-spec has
no receipt kind of its own; the same design-checklist reviewer records it
at spec-approval evidence. Do not add `design-spec-receipt`.

**D3. Replace the PIR shape with a new family.** Rejected. Net-new
substrate. PIR rooms, tests, and drive task ids (`workroom-WC-PIR-…-platform-post-implementation-review`)
already ship. Add sibling shapes for the two non-PIR writers; keep the PIR
shape.

## Implementation shape (not this commit)

1. Skip credentials rows in `firstLiveConnection` only for
   `request_coworker`. Existing PIR "live connection first" tests stay
   green for consent-bound rows.
2. Generalize `parsePlatformReviewPacket` to the four gates in the table.
   Writer, grant, shape, evidence, room key, and capsule follow the gate.
   `reviewerIneligibility` reads the packet's lane grant from
   `INITIATIVE_READINESS_LANES`, not the PIR constant.
3. `issuedPackets` for design-stage re-derives from the design-phase
   recovery routes for the same issuer (leaf file, no dispatcher import).
   PIR keeps `issuedPostImplementationReviewPackets`.
4. Tests first: credentials carrier skipped → platform-reviewer for a
   design-spec packet; writer admits only the platform-issued packet;
   forged / stale / self-review / delivery-actor refused; PIR and
   consent-bound dispatch tests unchanged; `request_coworker` from a
   credentials context still denied.

## Out of scope

- BI-015012AA OSM leaf implementation.
- data / ux-fit / security / compliance / domain / plan-review steward
  widening.
- ARTIFACT_AUTHOR_REQUIRED on BI-015012AA (DCO alias vs Process Overseer
  `createdByPrincipalId`).
- Relaxing credentials `request_coworker`.
- Mutating peer-owned BI-30EB6898.
- Changing `PLATFORM_WORK_SCOPE_KINDS` or Grok internal clearance.
- New Prisma models, new MCP tools, new grants.

## What this research does not establish

Independent acceptance of BI-9CCB88C4 waits for merge, canonical-runtime
deploy, and AC-3 live proof that BI-015012AA's design-spec packet is
dispatched without a consent-bound Claude/Codex session. This Grok
credentials client still must not call `request_coworker` for that packet.
Native semantic review remains a shadow publication unless a later policy
change requires it.
