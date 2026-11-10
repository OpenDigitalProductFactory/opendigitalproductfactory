---
title: Design-stage platform reviewer
status: active
backlog_item: BI-9CCB88C4
---

# Design-stage platform reviewer

Backlog: BI-9CCB88C4. Workroom: WC-31D0DE6C.
Atomic extension of the PIR steward (BI-AA47C672) so an owed design-spec,
spec-approval, or architecture-review packet reaches an in-platform reviewer
when the author-assistant carrier cannot send it.

**Research:** [2026-11-06-design-stage-platform-reviewer.md](../research/2026-11-06-design-stage-platform-reviewer.md)
(chosen option D + room-key D2). WWMD DI-3C73211052BB is the architecture
decision; this spec does not re-open it.

## Evidence and boundary

On origin/main `b65bb53582ef3f90393bc51c46c18d289f2ddfab`, three facts
together stall design-stage dispatch:

1. `apps/web/lib/mcp/independent-review-request.ts` L94–97 refuses
   `registrationKind === "credentials"`.
2. `apps/web/lib/auth/oauth-tokens.ts` L145–146 still treats that token as
   current execution authority, so `firstLiveConnection` selects it.
3. `dispatchReviewerRequest` in
   `apps/web/lib/backlog/initiative-readiness/server-reviewer-dispatch.ts`
   L487–527 calls `routeToPlatformReviewer` only when `!connection`, and
   `parsePlatformReviewPacket` admits only
   `gate === "post-implementation-review"` plus
   `record_initiative_post_implementation_review`.

Live packet IRD-36A98513 on BI-015012AA (design-spec, AGT-132, blob
`284b05dabc5e22224792f829de15daf251fdcca3`) was refused from this Grok
credentials client. The PIR fallback never ran.

This item is the locally owned capture of that reproduction. Peer-owned
BI-30EB6898 names the same steward-lane remainder; do not triage or claim
it here. Do not implement BI-015012AA in this change.

## Design grounding

Extend the existing PIR steward rather than a parallel lane:

- `apps/web/lib/backlog/initiative-readiness/platform-review-room.ts`
- `apps/web/lib/backlog/initiative-readiness/server-reviewer-dispatch.ts`
- `apps/web/lib/backlog/initiative-readiness/completion-review-issuer.ts`
- `apps/web/lib/mcp/standing-connection.ts`
- `apps/web/lib/work-management/platform-review-shape.ts`
- `apps/web/lib/tak/initiative-readiness-tool-grants.ts`
- `apps/web/lib/work-management/readiness-review-stages.ts`
- `docs/architecture/initiative-readiness-runbook.md`

No new table, MCP tool, grant, or reviewer role. Token-bound
`request_coworker` from a credentials client stays refused. The writer
admits a run only for a packet the platform issued, re-derived now, whose
reviewer is in-platform, holds the packet's lane grant, and is not a
delivery actor.

## Objectives and acceptance

**OBJ-1:** When the authoring assistant has no consent-bound carrier, an
owed design-spec, spec-approval, or architecture-review packet is handed
to the platform reviewer the same way PIR is today.

**OBJ-2:** A credentials client still cannot call token-bound
`request_coworker`; existing PIR and consent-bound dispatch stay intact.

**OBJ-3:** After merge and canonical-runtime deploy, BI-015012AA's current
design-spec packet is dispatched without a consent-bound Claude or Codex
session.

| AC | Objective | Criterion |
| --- | --- | --- |
| AC-1 | OBJ-1 | When the authoring assistant's standing connection is credentials-kind or missing, an owed design-spec / spec-approval / architecture-review packet is handed to the platform reviewer the same way PIR is today; a test asserts the writer admits only that platform-issued packet and refuses forged, stale, or self-review packets. |
| AC-2 | OBJ-2 | Token-bound `request_coworker` from a credentials client remains refused; existing PIR and consent-bound dispatch tests stay green; the run holds only the packet's tools. |
| AC-3 | OBJ-3 | After merge and canonical deploy, BI-015012AA's current design-spec packet is dispatched without a consent-bound Claude/Codex session. |

## Chosen design

### 1. Credentials rows are not `request_coworker` carriers

`firstLiveConnection` already receives `toolName`. When that name is
`request_coworker` and `row.oauthClient?.registrationKind === "credentials"`,
skip the row. Do not change `isCurrentOAuthExecutionAuthority`. Grok
credentials connections keep carrying other writes.

`dispatchReviewerRequest` then sees `!connection` and already calls
`routeToPlatformReviewer`. Consent-bound rows remain first, matching the
existing PIR test "keeps the author's live connection first".

### 2. Admit three design-stage gates on the PIR steward

Replace the single `PLATFORM_REVIEW_GATE` check with a closed gate table.
PIR rows stay byte-compatible.

| Gate | Writer | Grant | Stage evidence | Work shape | Room key | Capsule |
| --- | --- | --- | --- | --- | --- | --- |
| post-implementation-review | `record_initiative_post_implementation_review` | `initiative_design_review` | `pir-receipt` | `platform-post-implementation-review@1.0.0` | `platform-review:<itemId>` | `WC-PIR-<id>` |
| design-spec | `record_initiative_design_review` | `initiative_design_review` | `spec-approval-receipt` | sibling of PIR, same grants plus this writer | `platform-review:design-spec:<itemId>` | `WC-DSR-<id>` |
| spec-approval | `record_initiative_design_review` | `initiative_design_review` | `spec-approval-receipt` | same sibling | `platform-review:spec-approval:<itemId>` | `WC-SAR-<id>` |
| architecture-review | `record_initiative_architecture_review` | `initiative_architecture_review` | `architecture-review-receipt` | sibling with this writer and grant | `platform-review:architecture-review:<itemId>` | `WC-ARR-<id>` |

Evidence kinds are the existing map in
`readiness-review-stages.ts`. Design-spec has no receipt kind of its own.
Do not add `design-spec-receipt`. Do not reuse `WC-PIR-*` for a non-PIR
gate.

`reviewerIneligibility` reads the grant from
`INITIATIVE_READINESS_LANES[writer].grant`. Architecture-review therefore
requires `initiative_architecture_review` on the named reviewer; PIR and
design-spec keep `initiative_design_review`. No grant is widened.

`parsePlatformReviewPacket` admits a packet only when gate, writer, and
itemId match one row of the table. Any other packet stays `not-applicable`.

### 3. Writer admission stays the PIR checks, keyed per room

`loadPlatformReviewRunAuthority` already refuses: not a platform review
run, run not executing, room not bound, packet not issued, packet not
server-issued, packet targets another agent, reviewer delivered the item,
delivery actors unavailable, packet no longer owed.

Generalize the run parser so a drive task
`workroom-<capsule>-<shapeKey>` matches the gate's capsule prefix and
shape, not only `WC-PIR-` + `platform-post-implementation-review`.
`issuedPackets` for PIR stays `issuedPostImplementationReviewPackets`.
Design-stage packets re-derive from the design-phase recovery routes for
the same issuer, in a leaf module that does not import the dispatcher.

The run's mandated tools are exactly the packet's writer plus
`record_workroom_evidence`. The receipt repository's trunk and
delivery-actor checks apply unchanged.

### 4. Runbook

The PIR paragraph in
`docs/architecture/initiative-readiness-runbook.md` currently ends
"Design-stage reviews keep their author carrier." Replace that sentence
with: when the author-assistant carrier is missing or credentials-kind,
the same steward takes design-spec, spec-approval, and architecture-review
packets in per-gate rooms; token-bound `request_coworker` from a
credentials client stays refused.

## Ordered implementation and verification

1. FLOW-RED / VC-CARRIER: add a failing dispatch test — a credentials-kind
   standing connection for the author-assistant is treated as no carrier,
   so an owed design-spec packet is handed to `routeToPlatformReviewer`.
   Add a failing parser/writer test — a design-spec packet is admitted;
   a forged activity, a stale packet, and a self-review (delivery actor)
   are refused. Observe the failures before changing production code.
2. FLOW-FIX / VC-STEWARD: skip credentials rows for `request_coworker`;
   generalize packet parse, room key, capsule, shape, grant, evidence, and
   `issuedPackets` per the table. Keep PIR capsule ids and room keys
   unchanged.
3. FLOW-VERIFY / VC-REGRESSION: existing
   `server-reviewer-dispatch.platform-reviewer.test.ts` and
   `platform-review-room.test.ts` stay green. A credentials
   `authorizeCoworkerRequest` case still denies independent review.
   Run the affected unit tests and `pnpm --filter web typecheck`.
4. FLOW-DOCS / VC-RUNBOOK: update the initiative-readiness runbook
   sentence in the same PR. Cross-link this spec and BI-9CCB88C4.
5. FLOW-SHIP / VC-LIVE: DCO-signed non-draft PR, merge-queue, wait for
   canonical-runtime deploy. AC-3 is live proof that BI-015012AA's
   current design-spec packet is dispatched (platform-reviewer outcome or
   an in-platform `WC-DSR-015012AA` room with a platform-issued packet)
   without a consent-bound Claude/Codex session. Do not self-PIR. Do not
   call `request_coworker` from this credentials client to force AC-3.

## Compatibility and non-goals

- No new Prisma model, MCP tool, or grant catalog entry.
- No change to `independent-review-request.ts` credentials refusal.
- No change to `PLATFORM_WORK_SCOPE_KINDS`.
- data-review, ux-fit-review, security-review, compliance-review,
  domain-review, and plan-review stay on their current carriers.
- ARTIFACT_AUTHOR_REQUIRED on BI-015012AA is a separate residual.
- BI-015012AA OSM leaf stays on `feat/osm-leaf` and is not implemented
  here.
- Peer-owned BI-30EB6898 is not mutated.

## Risk and rollback

A credentials skip that is not limited to `request_coworker` would strand
legitimate Grok writes; the skip is tool-name gated and unit-tested.
Admitting a non-table gate would widen the non-token writer path; the
parser stays a closed table. Mixing design-spec into `WC-PIR-*` would
bind the wrong writer; per-gate rooms prevent that.

Rollback is a signed revert of this atomic change. In-flight `WC-DSR-*` /
`WC-SAR-*` / `WC-ARR-*` rooms become ineligible on the previous code the
same way a closed PIR room already does; they are not deleted. PIR rooms
and consent-bound dispatch are unchanged, so revert restores the previous
design-stage stall without breaking PIR.

## Backlog coverage

One atomic deliverable maps to BI-9CCB88C4. Carrier skip, steward
generalization, tests, and runbook sentence are internal sequencing, not
independently shippable changes.

References: AC-1, AC-2, AC-3; OBJ-1, OBJ-2, OBJ-3; FLOW-RED, FLOW-FIX,
FLOW-VERIFY, FLOW-DOCS, FLOW-SHIP; VC-CARRIER, VC-STEWARD, VC-REGRESSION,
VC-RUNBOOK, VC-LIVE; CT-CARRIER, CT-GATE-TABLE, CT-WRITER.

Live coverage is recorded against the immutable plan artifact before
implementation; this text is not a receipt.
