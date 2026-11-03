---
status: draft
---

# Cross-instance communication in the originating Workroom

Backlog: **BI-0F8CEAD4**. Workroom: **WC-B2EF4840**. Delivery shape: large.
Source inspected: `origin/main` at `36b46866870694dab1763e691862da38dc577e76`.

This refines the room deliverable in the [production authority design](2026-10-27-production-authority-development-companion-design.md), section 6 and AC-PAC-10 through AC-PAC-12. It retains home-owned membership, sovereign application, existing federation transport and the estate identity prerequisite. The [dialog broker design](2026-10-27-agent-dialog-broker-design.md) owns addressed delivery and execution adapters. This document supplies the exact Workroom boundary and the acceptance contract for the operator's reproduced failure; it approves no implementation or production configuration change.

## Problem and observed evidence

On November 2, 2026, the Mac chat working on local inference needed an answer from Windows-origin BI-9BEB3D56, WC-150C55A7. The Mac could see the federated backlog item but had no local Workroom for it. A Windows artifact named an external Codex session, without a verified connected host or dispatch destination. A local Codex message attempt returned `No Codex thread found`.

The operator opened the Windows portal. Its normal room UI showed WC-150C55A7, its human coordinator and external Codex contributor, with Codex already allowed to contribute. A handoff posted at 6:35 p.m. America/Chicago persisted after reload. That establishes storage only: dispatch, recipient read, acknowledgment and a reply remain unproved. The original room's pending author answer and all earlier unknown review, action and budget histories remain unchanged. A generic Mac room-access refusal establishes neither Windows non-membership nor room absence.

The implementation gap is independently visible in the named source:

| Existing owner | Current behavior and missing connection |
| --- | --- |
| `apps/web/lib/work-management/federated-room.server.ts` | Admit and mirror primitives exist. HTTP ingress is a documented follow-up. The mirror writer assumes admission upstream and does not check it itself. |
| `apps/web/app/api/v1/federation/demand/route.ts` | The inbox dispatcher handles existing event families; it does not route room membership, proposals, posts or receipts. |
| `apps/web/lib/federation/demand-delivery.ts` | Durable delivery exists, with explicit offline, authorization and dead-letter handling. Room records need admission into this owner. |
| `apps/web/lib/work-management/workroom-agent-access.server.ts` | Admission is for an exact Workroom, including the acting human and assistant, active membership, narrowing and clearance. Case-wide messaging cannot authorize a sibling room. |
| `apps/web/lib/mcp/packs/room-messaging-pack.ts` | Room post/read use a case key. The cursor read is already implemented; it is not the missing remote dispatch or receipt. |
| `apps/web/lib/work-management/post-work-item-comment.ts` | Writes canonical messages and human mention notifications. Agent mention metadata does not prove a delivery consumer ran. |
| `packages/db/prisma/schema/work-coordination.prisma` | WorkItemMessage has delivery/read/response scalars. A scalar cannot identify separate recipients. |
| `apps/web/lib/workroom-runtime/codex-app-server-adapter.ts` | Supports room-supervised provider sessions. An external session reference alone does not register a desktop wake adapter. |

## Objectives and acceptance

**OBJ-ROUTE:** An admitted person or assistant on either paired instance reaches the existing home Workroom from its recorded work identity, without finding a chat title or creating a second room.

**OBJ-DELIVERY:** Both ends can distinguish local storage, home acceptance, destination persistence, recipient acknowledgment and reply, with durable correlation and safe retries.

**OBJ-AUTHORITY:** Communication preserves the exact room, person, assistant and cross-instance authority boundaries, including after revocation and recovery.

**OBJ-CONTINUITY:** The room remains usable when a client is absent; supported execution adapters can resume only their registered work context.

| Acceptance | Objectives | Observable statement |
| --- | --- | --- |
| AC-PEER-01 | OBJ-ROUTE | From a mirrored BI, an admitted caller resolves the authenticated origin instance, original case and exact home WC; the operation creates no replacement Workroom and requires no chat-title search. |
| AC-PEER-02 | OBJ-ROUTE, OBJ-AUTHORITY | Two Workrooms sharing a case remain separate: membership, reads, writes, receipts, replies, cursors, subscriptions, notifications and execution turns for one never authorize access to its sibling. |
| AC-PEER-03 | OBJ-DELIVERY | A Mac-to-Windows message reaches the addressed home WC through the supported federation interface, and a Windows reply returns to the originating Mac WC with the original message and conversation correlation. Repeat in the opposite home direction. |
| AC-PEER-04 | OBJ-DELIVERY | Each recipient's state distinguishes queued, home-accepted, destination-stored, acknowledged and replied, plus unavailable, denied and delivery-failed outcomes; a saved comment or HTTP success alone never reports recipient acknowledgment. |
| AC-PEER-05 | OBJ-DELIVERY, OBJ-AUTHORITY | Repeating the same authenticated request after a timeout creates one canonical message and one logical delivery per recipient. Reusing its key with changed content, destination or recipient set refuses without mutation. |
| AC-PEER-06 | OBJ-DELIVERY, OBJ-CONTINUITY | With the peer unavailable, a permitted post remains visibly queued. Recovery delivers it once; source and destination worker restarts at commit and acknowledgment boundaries lose no accepted message and create no duplicate. |
| AC-PEER-07 | OBJ-AUTHORITY | Missing, removed, narrowed, expired or insufficient-clearance human or assistant membership refuses access without exposing room content; federation visibility and a trusted link alone never admit a principal. |
| AC-PEER-08 | OBJ-AUTHORITY | Spoofed sender/origin, mismatched WC/case, stale or reordered membership state, altered signed payload, revoked link and cross-organization use refuse before application. A home revocation rejects an already queued sender proposal and prevents egress to a removed recipient even after home acceptance. |
| AC-PEER-09 | OBJ-CONTINUITY | An offline external client can later read and explicitly acknowledge its pending room messages under current admission. No desktop client is required for storage, routing, receipts or replies. |
| AC-PEER-10 | OBJ-CONTINUITY, OBJ-DELIVERY | A registered supervised session receives one addressed turn and returns a correlated reply in the same bounded assignment. An arbitrary desktop session with only an executorRef reports wake unsupported; it is never reported resumed. |
| AC-PEER-11 | OBJ-AUTHORITY, OBJ-DELIVERY | Receipt and reply writes authenticate the actual recipient and recheck admission. Another principal cannot acknowledge on its behalf, an old event cannot roll back later state, and telemetry cleanup plus restart preserves the retained message's canonical receipt state. |
| AC-PEER-12 | OBJ-ROUTE, OBJ-CONTINUITY | Portal and MCP expose the same address and state. Unknown origin, ambiguous legacy room address, unsupported protocol or adapter, offline peer and authorization denial are distinguishable where disclosure permits; unauthorized callers retain the non-enumerating refusal. |

AC-PEER-01/02/03 refine AC-PAC-10. AC-PEER-07/08/11 refine AC-PAC-11. AC-PEER-05/06/09 refine AC-PAC-12. The remaining rows close the observed delivery-evidence and external-adapter ambiguities under the dialog broker scope.

## Address and authority contract

Decision **DI-897436A8C281** recommends retaining the approved case `contextId` and requiring an exact home WC qualifier. It was recorded as an agent decision, with no commandment conflict. Its qualitative scores are engineering judgments, not measured product results.

The address is the tuple `{ homeInstallationDID, contextId, homeWorkroomId }`. The existing context form remains `dpf-room:<homeInstallationDID>:<caseKey>`; `homeWorkroomId` is the semantic WC identity on that instance. Neither a display title nor a bare session id is an address. Resolve the origin from the authenticated federation/work-sync crosswalk. An unverified path, user-supplied URL or room title cannot select the peer or attach credentials.

Every membership event, proposal, accepted post, receipt and reply binds all three address fields. The same tuple binds TaskRun/session dispatch, subscriptions, notifications, resource identifiers and read/ack cursors; a case context alone can never choose the execution or notification recipient. The home verifies the case/WC association. Legacy case-only callers may use the existing local case feed; they cannot read exact-WC messages through it. A legacy cross-instance address lacking an exact WC is refused as incomplete before content is fetched. Sibling WC lookup never falls back to the first match.

Admission remains an intersection of current token scope, grants, human capability, human membership, assistant membership, room policy, clearance, signed peer identity and projection contract. Local Principal ids remain local. The existing federated principal mapping resolves an authenticated foreign subject; a matching name, agent slug or private GAID does not merge people or assistants. The home owns exact membership and its monotonic version. Mirror state cannot grant more than the home or its own local narrowing permits.

The receiver validates the trusted same-estate link and authenticated envelope before resolving a mirrored actor or applying a message. An expired or missing membership snapshot is unavailable, never permission to continue. The home rechecks current sender membership and delegation on every proposal, including retries queued before revocation. It also reauthorizes every recipient immediately before each egress attempt, including an accepted message held while the destination was offline. Revocation suppresses that recipient's queued payload and records a content-free denied outcome. Destination delivery and read recheck current local admission. Peer reads use an authorized projection and never a direct database connection.

## Message, transport and receipt contract

Extend the existing room event family on the federation outbox/inbox. Keep membership, proposed and home-accepted messages from the parent design; add a versioned room receipt event under the same contract owner. Do not create another queue, session ledger or message store.

The canonical message and its transport evidence bind:

- source event id and authenticated source instance;
- stable request key scoped to authenticated source and sender, with an immutable digest binding the complete destination address, content and resolved recipient set;
- sender GAID, acting and delegating principal provenance, and the home admission version;
- addressed recipient principal refs, with optional verified session operating-state qualifiers;
- canonical message id, replyTo message id, original source WC and conversation correlation;
- outcome, evidence timestamp, current recipient, and transport attempt identity.

Use WorkItemMessage for content and the authoritative versioned per-recipient receipt checkpoint in its structured payload, FederatedRecordMirror and its existing WorkQueue delivery for transport, and WorkroomParticipant for participant state. The append-only Workroom activity log holds attributable receipt history, not the only durable receipt fact: its enforced 180-day telemetry retention is shorter than a retained conversation may require. Each accepted receipt atomically updates the message checkpoint and appends its activity under concurrency control. Later history cleanup cannot erase or downgrade that checkpoint; after restart it reconstructs current state without old telemetry. Receipt provenance is retained with the message under its governing retention/deletion policy, without retaining purged message content in telemetry. Data review must verify that policy and cleanup behavior before implementation.

Exact-WC fields belong in the existing versioned structured payload and every read/filter path must enforce them. Scalar deliveredAt/readAt/respondedAt may be compatibility projections only when their meaning is defined; they cannot substitute for per-recipient evidence. Before implementation, data review must validate bounded recipient count, indexes, JSON query behavior, atomic checkpoint updates, transaction boundaries and disclosure across every existing reader; source-local schema presence is not that review.

Persist the message, recipient set and durable outbox intent atomically in the owning database. A crash after commit must be recoverable by the existing delivery sweep even if its accelerator was lost. Retry preserves the event id and payload digest. At the destination, validate and apply in a transaction with the existing unique mirror/message identity; a matching replay returns its original result. A changed replay refuses. An accepted home message carries home sequence and membership version; an out-of-order event waits for required home state rather than inventing membership.

State is per recipient and evidence-backed:

| State | Evidence required |
| --- | --- |
| queued | Source transaction persisted its outbox intent. |
| home-accepted | Home admission and canonical message transaction committed. |
| destination-stored | The addressed destination committed its authorized mirror and returned the correlated receipt. |
| acknowledged | The authenticated recipient explicitly acknowledged that message after receiving it. A fetch or a notification attempt does not count. |
| replied | A permitted reply references the original message and recipient identity. |
| unavailable | Peer, membership freshness or supported adapter is unavailable; pending delivery evidence remains visible. |
| denied | The authoritative admission/authorization check refused; retries cannot bypass it. |
| delivery-failed | The existing bounded retry/dead-letter policy reached its terminal result, with reason and recovery owner. |

These are proposed projection semantics, not a new parallel lifecycle enum. Receipt events append evidence; projection is monotonic, so a delayed storage receipt cannot erase an acknowledgment or reply. A message may have different outcomes for different recipients. Acknowledgment proves receipt, not that an agent followed the request or that the underlying repair succeeded.

Preserve existing federation failure handling. An unreachable peer retains queued work and last-attempt information. Authentication failure and revoked trust remain authorization/trust outcomes, with the existing quarantine behavior; they are never repaired by an alternate credential or endpoint. Payload validation failures cannot be retried as a less restrictive format.

## Execution and product surfaces

The [dialog broker](2026-10-27-agent-dialog-broker-design.md) remains the owner of native wake, addressed delivery and supervised runtime dispatch. Communication works through the room even with no execution adapter. An adapter advertises supported operations and a registered, authenticated instance/session route; executorRef alone supplies neither.

The supported Codex candidate is the existing room-supervised app-server adapter. It can inject or resume work it owns under existing execution authority. No supported route was found for injecting into an arbitrary Windows Codex desktop chat. Return `unsupported` for that request and offer the pending message through the room. A future desktop adapter needs separate verified capability and authority; installing one is outside this scope.

The originating room header and mirrored work item offer **Open originating room** and **Send update** when authorized. Message rows show per-recipient state and **Reply**; an unavailable recipient shows the recorded reason and the supported recovery action. The assistant uses the same governed resolver/post/read/ack paths. No user must find a chat title, paste a token or inspect a filesystem artifact. The portal displays opaque provenance only in details. Both surfaces recheck current access on every action.

## Dependencies, admission and scope limits

The existing implementation prerequisites remain live work:

| Item | Owned prerequisite |
| --- | --- |
| BI-7E73D523 | Estate-scoped agent identity, continuity and verified identity documents; required before cross-install addressing. |
| BI-FD00E416 | First-hop delegation authority intersection; still full origin authority at the inspected ref. |
| BI-B45BBD8A | Authenticated federation A2A envelope/ingress and remote correlation. |
| BI-31C1FDEC | Addressed delivery and supported local wake consumer in the dialog broker. |
| BI-0F8CEAD4 | This exact-room home/mirror transport, receipts, reply and two-instance qualification. |
| BI-ADB5CC1C | Standard A2A dialog method binding; owned separately and not duplicated here. |

The approved parent plan holds P7/P8 after its first loop. The operator's new request establishes the communication objective; it does not silently erase that sequencing or the identity/security prerequisites. Resolve the recorded phase admission through the owning initiative before runtime work. Current child readiness has no inherited coverage; a completed parent documentation item does not prove its runtime children delivered. Obtain independent design, architecture, data and security review, valid coverage and implementation admission. The operator selected the existing founder-funded shared-platform allocation on November 2; its governed binding is still required. This selection grants no new paid reviewer budget or provider.

Excluded: BI-9BEB3D56's architecture-debt disposition, the local-inference/native-engine repairs, identity or grant merging, arbitrary desktop control, cross-organization deployment, new subscriptions, host restarts and production flag changes. The original room is a regression reference, not permission to send further messages into it. Use a dedicated admitted qualification room on both instances for test traffic; any final original-room verification must be separately authorized.

## Research & Benchmarking

Primary sources checked November 2, 2026. These are documented/source contracts; no comparator was exercised on two machines.

| Comparator | Pattern adopted | Pattern rejected or limited |
| --- | --- | --- |
| [T3 Code v0.1.6 remote access](https://github.com/pingdotgg/t3code/blob/v0.1.6/docs/user/remote-access.md) and [peer architecture](https://github.com/pingdotgg/t3code/blob/v0.1.6/docs/internals/remote.md) | Linked environments route and message remote threads with durable parent/result correlation. Use server-owned instance identity and restart recovery. | T3 owns those threads and provider sessions. Its link modes do not establish DPF room admission or arbitrary external desktop wake. Adopt the routing behavior, not a dependency. |
| [Matrix server-server API](https://spec.matrix.org/latest/server-server-api/) | Room events require authenticated origin, event identity and authorization against room state. | Retain DPF's already chosen single home rather than Matrix's symmetric state-resolution machinery. |
| [Slack conversations.replies](https://docs.slack.dev/reference/methods/conversations.replies/) | A reply is anchored to a specific conversation and original message; reads are paginated under access scopes. | Thread existence or a returned history page does not establish a DPF recipient acknowledgment or execution. |
| [Microsoft Teams proactive messaging](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages) | A saved conversation route is usable only with the app's requisite access to that destination. | A display name or a filesystem session reference is not a destination or authorization. No Teams integration is added. |

[CloudEvents 1.0.2](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md) supplies event identity by source and id; duplicate delivery must preserve identity. [A2A](https://a2a-protocol.org/latest/specification/) supplies context/message/task correlation. The separately owned A2A binding negotiates its supported version; this DPF room profile does not claim conformance by adopting method names. Existing envelope/signature and projection contracts govern the wire.

## Architecture alignment and rollback

Reviewed the [deployment contracts](2026-05-09-deployment-contracts.md): identity and API governance stay in Authority Core; install wrappers share the same runtime contract; private data leaves only through the existing federation projection. This change adds no host path, port, transport service, identity issuer or provider. Organization and Principal remain canonical identities. The source files above are extension points, not new owners.

The implementation must remain behind the existing A2A feature gate until both instances pass qualification. Unknown event versions return a supported incompatibility result and preserve outbox evidence. Rolling back the feature returns the UI to local communication with remote pending/unavailable states; it does not delete messages, receipts, membership history or mutate grants. Do not replay a terminal denied event under a new identity. No migration is approved by this draft.
