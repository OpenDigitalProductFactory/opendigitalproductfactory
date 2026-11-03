---
status: draft
---

# Exact Workroom peer communication delivery plan

Backlog: **BI-0F8CEAD4**. Workroom: **WC-B2EF4840**. Shape: large.
Design: [originating Workroom communication](../specs/2026-11-02-exact-workroom-peer-communication.md).
Base: `36b46866870694dab1763e691862da38dc577e76`.

For agentic workers: execute the existing backlog ownership and admission for each prerequisite before this item. Source tests and documentation do not close the requested runtime outcome.

## Admission before implementation

1. Preserve and reuse the parent design's home-owned-room decision. Obtain independent approval of this exact-WC refinement, architecture/data/security review, canonical plan coverage and plan review through the server-issued routes. Current child readiness has no inherited baseline or coverage. Do not manufacture parent inheritance or treat its completed documentation PR as runtime delivery.
2. Resolve the owning initiative's recorded hold on P7/P8 after its first loop. The new communication objective does not silently waive that admission. Reuse the existing items BI-7E73D523, BI-FD00E416, BI-B45BBD8A and BI-31C1FDEC; do not duplicate their work or take ownership without a governed claim/handoff.
3. Bind the operator-selected existing founder-funded shared-platform allocation to this Workroom before funded review or execution. Retain original uncertain review and budget histories. No new provider, allowance, grant, credential or restart authority is implied.
4. Claim exact runtime edit paths and read the resulting changeImpactContract before Red. The current docs-only contract resolves two Markdown paths, requires regenerating `apps/web/lib/docs/doc-index.generated.json`, and has no testImpact or guardObligation entries. Runtime claims must replace this observation with their actual test and guard obligations.

## Atomic implementation sequence

All steps below deliver one behavior under BI-0F8CEAD4: an admitted peer conversation in an existing exact Workroom with truthful delivery and reply. Helpers or a stored post are internal checkpoints, not independently accepted substitutes. Prerequisite identity, authorization, standard method binding and dispatcher capabilities stay in their existing separate BIs.

| Step | Existing surface to extend | Required evidence |
| --- | --- | --- |
| S1: Address and admission | Work-sync provenance; `workroom-agent-access.server.ts`; room tool pack and authorized surface resolver | Failing then passing tests for origin resolution, mandatory home WC qualifier, case/WC mismatch, sibling isolation and paired human/assistant denial. Cover every old case-feed reader so it cannot reveal exact-WC content. |
| S2: Signed home membership and room events | `federated-room.server.ts`; existing federation envelope/contract and inbox dispatcher | Authenticated event tests for monotonic membership, invalid signature/origin, missing/expired state, revoked link, cross-org refusal and home admission of queued proposals. |
| S3: Durable content and outbox | WorkItemMessage; FederatedRecordMirror; `delivery-queue.ts`; `demand-delivery.ts` | Transaction and integration tests at message/outbox commit, matching replay, changed-key conflict, peer timeout and recovery. Preserve existing quarantine and dead-letter behavior. |
| S4: Attributable receipts and replies | Canonical per-recipient message checkpoint, Workroom activity history and participant projection | Per-recipient monotonic receipt tests, unauthorized ack refusal, duplicate/out-of-order receipts, stable WC/replyTo correlation and atomic concurrent updates. Run 180-day telemetry cleanup and restart: retained messages preserve canonical receipt state. Verify retention/deletion and disclosure before implementation. |
| S5: Governed portal/MCP and adapter use | Existing room authorized surfaces, tools and dialog-broker dispatcher; room-supervised runtime | Both surfaces expose the same route/status. Bind exact WC to TaskRun/session, resource, cursor and notification routes; sibling subscribers and sessions receive no notification or turn. Verify registered supervised session turn/reply; arbitrary desktop executorRef returns unsupported. Communication remains usable while that client is offline. |
| S6: Canonical two-instance qualification | Governed shared nonproduction lease, then canonical release/upgrade path | Execute VER-PEER-01 through VER-PEER-06 with exact source/runtime identities. Record both sides' persisted event/receipt/reply ids. Only actual two-host outcomes count as function. |

Affected unit tests and package typechecks run in a managed compile-ready worktree. Heavy build/runtime tests use the shared governed environment; never stand up a private live image from this worktree. Reuse valid evidence, complete independent review, DCO/protected queue publication and canonical deployment, then update the live item's status through its governed completion transition.

## Two-instance verification matrix

All cases begin with a dedicated, admitted qualification room and named principals on both installations. Creating or admitting those principals/rooms, enabling a production flag, changing trust or sending into the original repair room each retains its required authority. No arbitrary original-chat message is part of a test fixture.

| Verification | Acceptance covered | Procedure and pass evidence |
| --- | --- | --- |
| VER-PEER-01 | AC-PEER-01, AC-PEER-03, AC-PEER-04, AC-PEER-12 | Start from the mirrored item. Resolve its original exact WC; post through MCP, observe home/destination persistence in the normal portal, explicitly ack as the recipient and reply. Verify original message/reply correlation and each per-recipient state from the source. Repeat with the other instance as home. |
| VER-PEER-02 | AC-PEER-02, AC-PEER-07, AC-PEER-11 | Use a sibling WC and unadmitted, observer-only, narrowed and removed identities. Try post/read/ack/reply and cursor replay from each; subscribe and register a supervised sibling session. No denied content, notification, turn or existence details leak. Another recipient cannot forge acknowledgment. |
| VER-PEER-03 | AC-PEER-05, AC-PEER-06, AC-PEER-11 | With a permitted fault injection, lose the HTTP response after destination commit; replay the same key. Then alter its body/destination/recipient set. Recover source/destination workers at each commit/ack boundary. Count exactly one canonical message and logical delivery per recipient; changed replay refuses. Run telemetry cleanup plus restart and verify retained per-message receipt checkpoints reconstruct current state. |
| VER-PEER-04 | AC-PEER-06, AC-PEER-08, AC-PEER-09 | Make the test peer unavailable through the supported test interface. Queue a post; revoke the sender at the home; restore connectivity and verify refusal. Separately accept a message at the home, remove its offline recipient, then restore connectivity: no queued content leaves for that recipient. Still-admitted participants deliver once; reordered membership never restores revoked access. |
| VER-PEER-05 | AC-PEER-08, AC-PEER-12 | Through the authenticated negative-test interface, supply spoofed origin/GAID, altered signature, wrong WC/case, stale/expired state, unsupported version and cross-org input. Each fails at its declared boundary without a mirror/message write. |
| VER-PEER-06 | AC-PEER-09, AC-PEER-10 | Disconnect the external client, deliver into the room, reconnect and explicitly ack/reply under current authority. Separately dispatch to a registered supervised session and verify the same assignment resumes. An unregistered desktop session reports unsupported without claiming wakeup. |

Capture source commit, served image identity on each side, instance DIDs, exact WC addresses, membership versions, event/request keys, message/receipt/reply ids, statuses and timestamps, with test secrets excluded. Record latency from actual evidence; no SLA or wake result is inferred from a stored timestamp. Functional checks remain unrun until those interfaces and environments are available.

## Backlog coverage

**Status: pending.** No coverage receipt is claimed. The server must bind the immutable plan to an independently approved current scope baseline, then validate this atomic mapping:

| Key | Backlog item | Requirement refs | Contract refs | Flow refs | Verification refs |
| --- | --- | --- | --- | --- | --- |
| P8 | BI-0F8CEAD4 | OBJ-ROUTE, OBJ-DELIVERY, OBJ-AUTHORITY, OBJ-CONTINUITY | AC-PEER-01 through AC-PEER-12 | S1, S2, S3, S4, S5, S6 | VER-PEER-01 through VER-PEER-06 |

External prerequisites: BI-7E73D523 (identity), BI-FD00E416 (delegation intersection), BI-B45BBD8A (authenticated ingress), BI-31C1FDEC (addressed dispatch). BI-ADB5CC1C owns standard A2A methods separately. The parent initiative retains its first-loop admission and original coverage history. A rejected coverage request is a blocker to source implementation, never a Markdown substitute for admission.

## Risks, rollback and stop condition

The highest risks are sibling-room disclosure through an old case reader, colliding foreign identities, an ack attributed to the sender, and a crash between content and outbox writes. The corresponding negative and recovery cases are required before the feature gate is enabled. Mixed runtime versions return incompatibility and preserve pending evidence.

Rollback disables remote delivery at its existing gate and preserves messages, receipts and pending transport history. Local room use continues; no grants or identities are broadened and no terminal denied event is replayed under a new key.

This task is complete only when admitted delivery, recipient acknowledgment and reply work in both directions on the two supported instances, offline/recovery and denied-access cases pass, and canonical publication/deployment evidence is recorded. If prerequisite admission, funding or review is unavailable, preserve the signed source branch and exact governed refusal, keep BI-0F8CEAD4 unfinished, and report the named owner/action needed to resume. The original local-inference and architecture-debt tasks retain all their independent gates.
