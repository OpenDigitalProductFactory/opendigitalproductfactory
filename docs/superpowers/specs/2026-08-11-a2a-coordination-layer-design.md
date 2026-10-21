# Cross-Install A2A Coordination — DPF Testing and MSP Operations Spine

**Original date:** 2026-08-11

**Revised:** 2026-08-15; 2026-10-21 (cross-network, prod/non-prod trust, disconnected operation, validation recipes — §18–§24)

**Status:** Architecture-reviewed design of record (2026-08-15); the 2026-10-21 revision awaits independent spec approval; implementation incomplete

**Backlog:** `BI-AD9ABD38` under `EP-E1F1DB58`; first proof `BI-BCF474E7`

**Decision:** `DI-5ACBF7782FF2` — extend the existing federated-A2A substrate; do not move collaboration into Edge or create an MSP-specific transport
**Decisions (2026-10-21):** `DI-656436759566` — cross-network transport (§18); `DI-13CEFD0A8156` — prod/non-prod trust (§19); `DI-259D82329EF4` — receiver execution through validation recipes (§20)
**Builds on:** [Federated A2A Coordination with GAID](2026-08-08-federated-a2a-gaid-coordination-design.md), [Work Room multi-agent communication](2026-08-12-work-room-multi-agent-communication-substrate-design.md), [Federated Demand Network](2026-07-19-federated-demand-network-design.md), and [RemoteAction Edge dispatch](2026-06-26-remote-action-edge-auth-and-dispatch-design.md)

## 1. Executive decision

DPF will use one composed spine for collaboration across installations:

```text
human or AI intent
        |
        v
A2A task + federated Work Room       collaboration and task semantics
        |
        v
FederationLink + GAID + device trust sovereign identity, transport, and policy
        |
        +-----------------------+
        |                       |
        v                       v
local coworker work       Edge RemoteAction
reasoning + evidence      authorized host inspection/action
        |                       |
        +-----------+-----------+
                    v
TaskRun / WorkCapsule / messages / artifacts / receipts
```

The layers have separate authority:

- **A2A and Work Rooms coordinate work.** They identify eligible coworkers, carry tasks/messages/artifacts, and preserve a shared outcome context.
- **FederationLink is the sovereign wire.** It authenticates the peer installation, enforces the relationship and projection contract, and transports durable events. It never grants coworker or host authority by itself.
- **Edge RemoteAction operates infrastructure.** It performs only allow-listed, machine-bound actions within a customer/site scope and returns attributable evidence. It is not a chat transport and never becomes a general remote shell.
- **The receiving installation is always authoritative.** It resolves the local coworker, evaluates TAK and customer policy, applies approval gates, executes locally, and owns its resulting records.

The first proof is operationally concrete: a coworker working on the founder organization's Mac installation asks a coworker on its Windows installation to inspect that installation, coordinate DPF testing, optionally invoke an approved read-only Edge action, and return evidence to the originating task. The same contract later supports an MSP managing customer infrastructure without erasing customer sovereignty.

## 2. Problem — synchronization is not collaboration

Federated demand gives installations shared backlog visibility. It does not let their coworkers collaborate on the work. Today, a contributor on the Mac must separately discover whether Windows is current, whether its native Edge service is healthy, and what its local portal reports. The other installation has the best access to those facts, but its coworker cannot yet participate in the originating task.

The platform already contains most of the necessary parts, but their current boundary stops short of an end-to-end cross-install workflow:

| Capability | Current state | Gap this specification owns |
| --- | --- | --- |
| Local coworker handoff/summon and A2A-shaped `TaskRun` | Delivered | Address only local coworkers through the same contract used for remote peers |
| Work Room agent membership, messaging, subscription, presence, and coordinator | Delivered | Bind a federated room to A2A `contextId` and transport remote participation |
| Federated room admission and message-mirroring primitives | Delivered behind `DPF_FEDERATION_A2A_ENABLED` | Add authenticated ingress/egress, lifecycle correlation, retries, and functional two-install verification |
| Federation pairing, queue, replay protection, reconciliation, and demand projection | Delivered | Carry A2A task events without inventing another peer transport |
| GAID/Principal identity and link-scoped trust | Delivered foundation | Publish and verify minimized Agent Cards; bind task claims to the peer device and link |
| Machine-bound Edge RemoteAction with signed envelopes | Delivered | Let an admitted local coworker request an approved Edge inspection and return its evidence |
| Edge fleet/readiness UX | Partially delivered | Windows native Edge convergence and physical-host verification remain prerequisites for host-level acceptance |
| Private MCP/A2A reachability | Planned under `EP-8B03CB06` | Keep internal coordination off the public storefront/mobile edge and support routed MSP estates later |

Code presence is structural evidence only. Completion requires a real Mac-to-Windows task and returned result on the installed systems.

## 3. One contract, four deployment relationships

The protocol remains one contract; relationship policy changes what may cross and what may execute.

### 3.1 Same organization, peer installations — first delivery

Example: a founder organization operating separate Mac development and Windows testing installations.

- Pair through a trusted, dual-approved `FederationLink`.
- Project only explicitly federatable coworker identity, skills, service offers, and readiness.
- Allow advisory/testing tasks within the approved environment and data boundary.
- Preserve development/production separation even when the organization matches.
- Permit approved read-only Edge inspection through the receiving installation's local policy.

This is the first implementation and acceptance topology because it provides high operational value while keeping one organizational authority.

### 3.2 MSP-managed estate without a sovereign customer DPF

An MSP installation manages Edge nodes assigned to customer accounts and sites.

- A local MSP coworker coordinates the work through the normal local A2A/Work Room path.
- Edge RemoteAction targets only the selected `customerAccountId`, `customerSiteId`, and `edgeNodeId`.
- The allowed action type, parameters, approval requirement, maintenance window, and rollback/evidence contract are enforced locally.
- There is no remote customer coworker and no federation pretense; this is managed Edge execution.

### 3.3 Sovereign customer DPF paired with an MSP DPF

The customer retains its own DPF authority core and coworkers.

- The MSP coworker sends an A2A task or proposal across the customer-approved `FederationLink`.
- The customer installation admits it to an outcome-scoped Work Room and applies its own TAK, data, change-window, and human-approval policy.
- A customer coworker may inspect or execute through customer-owned Edge nodes.
- Results return as minimized A2A artifacts and receipts. The MSP never writes directly into the customer database and never receives a general remote shell.

### 3.4 Customer → reseller/MSP → platform founder hub

Introductions and portfolio signals may route through the delivered federation topology, but authority does not transit automatically.

- A reseller can coordinate support with its customer within their approved relationship.
- The platform founder can coordinate product support with the reseller within a separate approved relationship.
- Multi-hop provenance retains every installation, relationship, delegating GAID, and receipt.
- A reseller cannot delegate customer infrastructure authority to the platform founder unless the customer explicitly approved that scope.

## 4. Load-bearing boundary: coded spine, AI fulfillment, governed consequence

| Concern | Owner | Rule |
| --- | --- | --- |
| Peer/device/agent identity, signatures, replay, idempotency, scope, data classes, state transitions | Deterministic code | Never inferred or bypassed by AI |
| Intent interpretation, coworker selection, investigation plan, synthesis, and recommendation | AI coworker | Reasons only over data and tools admitted by the coded boundary |
| Read-only inspection | Receiving policy + capability grants | May run autonomously only within recorded standing authority |
| Mutating infrastructure or consequential business action | Receiving policy + human gate | Remote request is a proposal; local approval and execution remain separate |
| Audit, artifacts, and result correlation | Deterministic code | Every hop is attributable and idempotent |

An AI may propose any action it can explain, but it can cause an effect only through a registered tool/action contract. A remote agent assertion is evidence of intent, never evidence of permission.

## 5. Canonical platform allocation

No new identity, transport, chat, task, or remote-machine substrate is introduced.

| Platform concern | Canonical home |
| --- | --- |
| Organization | `Organization` |
| Human, coworker, installation, or Edge identity | `Principal` + `PrincipalAlias`; GAID/AIDoc for agent interoperability |
| Sovereign peer relationship and trust state | `FederationLink` and its device/authority binding |
| What may cross a relationship | `ProjectionContract` and minimized `FederatedRecordMirror` projections |
| A2A task lifecycle | `TaskRun` with A2A-aligned states |
| Task conversation and output | `TaskMessage` and `TaskArtifact` |
| Shared human/AI outcome context | Work Room over the canonical work item/message substrate; room id maps to A2A `contextId` |
| Delivery-session coordination | `WorkCapsule` through MCP |
| Infrastructure action | `RemoteAction` claimed/reported by the bound `EdgeNode` |
| Action and decision evidence | Existing receipt, `ToolExecution`, activity, and evidence ledgers |

`CoworkerEngagement` remains the service offer/acceptance and commercial relationship. `TaskRun` remains execution. Work Room remains collaboration. A2A is the interoperable contract over those records, not another database.

## 6. Discovery and addressing

### 6.1 Installation discovery is not coworker discovery

LAN DNS-SD or a routed introducer discovers an installation candidate. It exposes no coworker, customer, backlog, hostname-derived stable identity, or credential. Pairing creates a trusted `FederationLink`; only then can the link negotiate A2A readiness.

### 6.2 Coworker discovery is link-scoped

The sender discovers remote coworkers through a minimized, signed Agent Card projection scoped to that link. The projection includes only:

- GAID and a display-safe name/role;
- supported A2A interface/version;
- explicitly federatable skills and service offers;
- advice-only versus action-capable posture;
- applicable organization/environment and data boundary;
- card issue/expiry, signature, and withdrawal state.

It excludes prompts, memory, secrets, unrestricted tool grants, provider routing, hidden instructions, unrelated customer data, and complete authority configuration. `find_coworker` should eventually search the combined authorized local-plus-remote exposure catalog; it must never enumerate unprojected peers.

## 7. Transport and protocol profile

DPF adopts A2A v1.0 task, message, artifact, Agent Card, `contextId`, and lifecycle semantics. The first cross-install delivery uses the existing durable federation outbox/inbox as a custom A2A binding:

- CloudEvents 1.0 supplies typed, versioned, uniquely identified events.
- RFC 9421 HTTP Message Signatures and `Content-Digest` bind the request to the paired installation device and prevent undetected tampering/replay.
- The `FederationLink` token, device key, relationship state, projection contract, and GAID/AIDoc evidence must all agree.
- `source + id` is the durable idempotency identity; A2A task and context identifiers correlate the workflow but are not reused as CloudEvent uniqueness keys.
- Existing queue retry, backoff, dead-letter, digest reconciliation, and withdrawal behavior are reused.

Initial event families:

- `dpf.a2a.agent-card.projected.v1` / `withdrawn.v1`
- `dpf.a2a.task.submitted.v1`
- `dpf.a2a.task.message-posted.v1`
- `dpf.a2a.task.status-changed.v1`
- `dpf.a2a.task.artifact-produced.v1`
- `dpf.a2a.task.cancel-requested.v1`
- `dpf.a2a.room.participant-admitted.v1`
- `dpf.a2a.room.message-posted.v1`

The receiver owns its local `TaskRun`, room membership, messages, and artifacts. Inbound events call the same service layer as local A2A operations after link/device/GAID authorization. They never expose a general remote database mutation.

Until the implemented binding supports and tests the required A2A operations, lifecycle, discovery declaration, and security behavior, DPF must label it **A2A-shaped DPF federation profile**, not fully A2A-compliant.

## 8. End-to-end coordination flow

The first acceptance flow is a DPF platform-testing request from Mac to Windows:

1. The Mac contributor/coworker frames an outcome: “Inspect the Windows DPF installation and report portal version, native Edge readiness, federation discovery state, and relevant test evidence.”
2. The Mac installation resolves eligible remote coworkers from the Windows link's verified Agent Card projection.
3. The operator sees target installation/environment, target coworker, requested data classes, action posture, and approval consequence before dispatch.
4. Mac creates the local initiating `TaskRun`/Work Room context and enqueues a signed A2A task event.
5. Windows authenticates the link and device, validates replay/idempotency, resolves the remote GAID and local target GAID, and evaluates local TAK and room admission.
6. Windows creates or idempotently returns its receiver-owned `TaskRun`, admits the coworker to the outcome-scoped room, and acknowledges the remote task ID.
7. The Windows coworker inspects its local canonical runtime. If host evidence is needed, it requests an allow-listed read-only `RemoteAction`; the Windows Edge node independently validates and executes the signed action envelope.
8. Windows records messages, status, artifacts, tool/action evidence, and provenance locally. It projects only the approved result envelope back to Mac.
9. Mac correlates the result to the originating task/context, mirrors the message/artifact into the room, and presents the evidence to the contributor.
10. Retry returns the same accepted task/result rather than executing twice. Link revocation, coworker withdrawal, room closure, or action-policy change prevents new work immediately.

The same flow can run Windows-to-Mac. Neither direction is privileged by the protocol.

## 9. Authority and sovereignty

Effective authority is an intersection, never a union:

```text
peer relationship and device trust
  ∩ projected coworker/service offer
  ∩ source delegation receipt
  ∩ receiving coworker grants and autonomy ceiling
  ∩ room outcome/sensitivity policy
  ∩ organization/environment boundary
  ∩ customer/account/site scope
  ∩ requested data/action classification
  ∩ current human approval or standing authority
```

### 9.1 Same organization

Same organization reduces onboarding friction; it does not remove verification or least privilege. Development cannot silently act in production. A healthy link does not imply an approved coworker, room, data class, or Edge action.

### 9.2 MSP-managed customer

Customer scope is structural, not a prompt instruction. Every remote-management request binds to the customer account/site and, where applicable, exact Edge node. A coworker cannot broaden the scope during reasoning. Customer-owned policy decides whether an MSP proposal may become an action.

### 9.3 Cross organization

Cross-org A2A is deny-by-default. Enabling it requires a named service offer, relationship-specific projection contract, data-processing/retention terms, bounded authority, and explicit action policy. No demand-sharing permission automatically grants coworker or infrastructure authority.

## 10. Security and failure behavior

| Threat/failure | Required behavior |
| --- | --- |
| Link token stolen without device key | Reject signature; audit and rate-limit |
| Signed request claims unprojected/withdrawn GAID | Reject without revealing local coworker inventory |
| Replay or duplicate delivery | Reject replay or return the exact prior accepted result; never repeat execution |
| Guessed task/context ID | Authorize against stored link/GAID ownership; return non-enumerating failure |
| Compromised remote coworker requests mutation | Treat as proposal; apply receiver policy and human gate |
| Customer/site mismatch | Reject before task or `RemoteAction` creation |
| Link quarantined or revoked mid-task | Freeze new remote authority; local owner decides cancel/finish |
| Peer unavailable | Durable retry/backoff; no loss of local work; bounded dead-letter and reconciliation |
| Edge unavailable | Return a truthful blocked/degraded result; coworker may still provide portal-local evidence |
| Public route exposure | MCP/internal A2A remain behind the private edge; public storefront/mobile routes cannot reach them |

Logs, metrics, and errors exclude tokens, private keys, prompts, hidden memory, and unminimized artifacts. W3C trace context may cross the link, while each install retains control of its detailed spans.

## 11. Operator experience

Complexity stays backstage. The operator sees:

- **Connections:** whether the peer is paired, A2A-ready, and allowed for agent coordination; last success/failure and safe recovery action.
- **Coworker picker:** local and authorized remote coworkers with clear peer, organization, environment, advice/action posture, and freshness.
- **Dispatch confirmation:** requested outcome, information crossing, whether host inspection is possible, approval boundary, and retention.
- **Work Room/task timeline:** both installations' messages, status, artifacts, and readable provenance in one outcome context.
- **Edge fleet:** which customer/site/node performed an infrastructure action and whether its trust, capability, heartbeat, and version were acceptable.

No operator should need to know CloudEvents, GAID, certificates, MCP, or A2A to answer: who is doing the work, on which installation/customer/site, with what authority, and what happened?

## 12. Scalability and topology

- Same-company peers may coordinate directly over their trusted link.
- MSP/customer and reseller/founder relationships use hub-and-spoke introductions; they do not form an unrestricted full mesh.
- Agent Cards are link-scoped, cached, expiring projections; they are not a global agent directory.
- Task context is bounded to one outcome. Candidate filtering happens deterministically before AI reasoning.
- Fleet summaries aggregate at the hub, while customer/site evidence and authority remain at the owning install.
- Multi-hop tasks retain the full chain of installations, links, GAIDs, delegations, and receipts; hop/loop limits are enforced.

## 13. Delivery scope and dependencies

### 13.1 `BI-AD9ABD38` owns

- signed, minimized Agent Card projection/withdrawal over an approved link;
- authorized remote coworker discovery;
- federation ingress/egress for non-streaming A2A task/message/status/artifact/cancel and room events;
- `TaskRun`/Work Room correlation and receiver-owned idempotency;
- same-org environment policy, link/device/GAID verification, and cross-org negative gates;
- composition with read-only Edge RemoteAction evidence;
- Connections/coworker/task provenance UX;
- physical Mac↔Windows functional acceptance.

### 13.2 Existing dependencies, not duplicate work

- `BI-40648BBF` — signed Agent Card export.
- `BI-4CA4FCE5` — federated room admission/mirroring primitives; complete structurally, ingress follow-up remains here.
- `BI-F12A8D0D` / `EP-REMOTE-ACTION` — machine-bound signed Edge dispatch.
- `BI-6CE3D92B` and `BI-0C326236` — truthful main-instance Edge lifecycle and Windows native convergence.
- `BI-143001FE` / `EP-8B03CB06` — private A2A reachability and public-edge segmentation.
- Federated demand delivery/reconciliation — durable transport precedent and shared backlog context.

### 13.3 Explicitly out of scope

- arbitrary remote shell or script execution (the validation recipes of §20 are receiver-catalogued procedures; a sender names one, it never supplies a command);
- direct writes into a peer/customer database;
- public anonymous A2A or a global agent registry;
- cross-org standing mutation authority;
- building a hosted relay or full Internet reachability (the §18 envelope is relay-ready; `BI-D43D3D76` builds a relay only on the §18.4 evidence trigger);
- replacing MCP, Work Rooms, federation, or Edge with a new transport;
- autonomously merging peer backlog items merely because an AI detects overlap.

## 14. Verification matrix

| ID | Scenario | Required evidence |
| --- | --- | --- |
| V-A2A-01 | Mac discovers an eligible Windows coworker through the trusted link | Verified signed card, peer/environment provenance, no unprojected coworkers |
| V-A2A-02 | Mac submits a read-only testing task; Windows accepts it | One receiver-owned `TaskRun`, outcome-scoped room admission, full receipt chain |
| V-A2A-03 | Windows returns portal/Edge/test evidence | Message and artifact appear on Mac under the same task/context with minimized payload |
| V-A2A-04 | Windows coworker invokes an approved read-only Edge inspection | Exact node/customer/site binding, signed action envelope, single execution, returned evidence |
| V-A2A-05 | Repeat, timeout, and reconnect | No duplicate task/action/artifact; durable recovery succeeds |
| V-A2A-06 | Reverse Windows→Mac request | Same contract and authority behavior in the opposite direction |
| V-A2A-07 | Link/coworker/action revocation | New work stops immediately; history remains auditable |
| V-A2A-08 | Cross-org task without explicit policy | Denied before local task creation; no inventory/data leakage |
| V-A2A-09 | Customer/site mismatch in MSP scenario | Denied before Edge dispatch; mismatch appears as safe operator evidence |
| V-A2A-10 | Public edge probe | MCP/internal A2A routes remain unreachable from the public exposure path |

Structural tests cover schema/contract mapping, signatures, replay, idempotency, state transitions, data minimization, and authority intersections. Functional completion additionally drives V-A2A-01 through V-A2A-10 on canonical installations; tests and preview fixtures alone are insufficient.

## 15. Research and benchmarking

- **A2A v1.0:** adopt Agent Cards, tasks, messages, artifacts, `contextId`, lifecycle, discovery declaration, security schemes, and explicit binding/version semantics. DPF adds GAID and relationship-specific sovereign policy; it does not replace the A2A data model. Source: [A2A protocol specification](https://a2a-protocol.org/latest/specification/).
- **CloudEvents 1.0:** adopt the stable event envelope and `source + id` duplicate identity for durable federation delivery. Keep correlation in typed event data rather than overloading the event ID. Source: [CNCF CloudEvents specification](https://github.com/cloudevents/spec/blob/ce@v1.0.2/cloudevents/spec.md).
- **RFC 9421:** adopt covered HTTP components, content digest, creation/expiry, key identity, and nonce-based replay controls for the peer-device signature. Source: [RFC 9421 — HTTP Message Signatures](https://www.rfc-editor.org/rfc/rfc9421.html).
- **NIST SP 800-207A:** adopt identity- and policy-based enforcement independent of network location. A same LAN, same organization, or MSP affiliation is context, not authorization. Source: [NIST SP 800-207A](https://csrc.nist.gov/pubs/sp/800/207/a/final).

Rejected patterns:

- a shared database or direct remote record mutation;
- a second bespoke A2A transport alongside federation;
- putting conversational coordination into the Edge agent;
- treating VPN/LAN location, link health, Agent Card possession, or device signature as sufficient action authority;
- general-purpose remote command execution.

## 16. Architecture review (advisory)

**Alignment:** well aligned after consolidation.

- The design extends `Principal`/GAID, `FederationLink`, `ProjectionContract`, `TaskRun`, Work Rooms, and `RemoteAction`; it adds no parallel source of truth.
- Collaboration, sovereign transport, and host execution have separate contracts and authority, preventing Edge from becoming an implicit control plane.
- Same-company and MSP deployments are policy topologies over one platform contract, not separate products.
- The first functional slice is deliberately same-org and read-only, but every trust check required for later MSP/customer use is present from the start.
- `DI-5ACBF7782FF2` selected this integration ownership with high confidence (composite `4.701`, margin `2.851`); strongest contributors were Ground New Work In Existing Platform and Architecture Over Shortcuts. No commandment conflict fired.

No new architecture decision remains for the specification. Implementation planning must decompose independently shippable slices and retain the physical two-install acceptance as the completion gate.

## 17. Definition of done

This objective is complete only when:

1. `BI-AD9ABD38` leaves triage with implementation-plan coverage for the owned scope above.
2. A signed Agent Card lets Mac discover an explicitly exposed Windows coworker without enumerating others.
3. A real task travels Mac→Windows, is handled by the Windows coworker, and returns correlated messages/artifacts/evidence.
4. The reverse Windows→Mac path also passes.
5. An approved Windows Edge inspection can participate without creating a remote shell or bypassing local authority.
6. Retry/offline recovery is idempotent; revocation and cross-org negative tests pass.
7. The operator can understand the relationship, coworker, installation, customer/site, authority, status, and result from the normal Connections/Work Room/Edge surfaces.
8. Runtime verification is recorded against both canonical installations and the relevant backlog items are closed with evidence.

Until all eight are true, DPF has useful A2A and federation substrate, but not the cross-install collaboration and MSP operations spine promised by this design.

---

# Revision 2026-10-21 — cross-network tasking between a production and a non-production install

Sections 1–17 assumed the two installations could reach each other and were peers of equal standing. Neither holds for the real first topology, and the first proof (`BI-BCF474E7`) needs work the earlier sections forbade in general terms. This revision keeps every decision above and adds what the topology requires. Where it narrows an earlier section, it says so.

## 18. Cross-network reachability and disconnected operation

### 18.1 The topology this must survive

| Install | Identity | Network | Availability |
| --- | --- | --- | --- |
| Operator PROD | macOS laptop, environment class `production`, purpose `operate-organization` | Roams: home LAN, hotel and mobile Wi-Fi; always behind NAT; never accepts inbound | Online when the laptop is awake and connected |
| Operator DEV | Windows workstation, environment class non-production (not yet verified from PROD; §21.1) | Residential NAT in another state; no port forwarding | Usually on, but may be off or asleep for days |

The two are never on one LAN. Neither can accept a connection from the other without help. Today the work-sync pull from PROD fails every five minutes with `Peer responded 0: fetch failed`. That is `getFromPeer`'s network-error status (`apps/web/lib/federation/client.ts`), surfaced through `work-sync.ts`.

### 18.2 Decision — overlay now, relay only on evidence (`DI-656436759566`)

Five options were scored. The recommendation was **T3**: composite 12.39, margin 1.76, high confidence, no commandment conflict.

| Option | Composite | Disposition |
| --- | --- | --- |
| T3 — private WireGuard overlay now; envelope designed so the deferred relay can carry it later | 12.39 | **Adopted** |
| T1 — overlay only, envelope not designed for a relay | 10.63 | Subsumed by T3 |
| T2 — build a DPF store-and-forward relay now | 7.33 | Deferred to `BI-D43D3D76` (§18.4) |
| T5 — a public TLS-terminating tunnel per install | 4.48 | Rejected: it exposes DEV publicly, which DI-D96FB0FE7C1F already rejected |
| T4 — GitHub as the mailbox | 2.85 | Rejected: vendor lock-in, and test output would sit in a forge outside both installs |

The overlay is the one already decided for operator access (`BI-CAF86466`, `DI-D96FB0FE7C1F`): Tailscale-style WireGuard, with a coordination server that can be swapped for self-hosted Headscale. This revision extends its purpose from operator-to-portal access to **installation-to-installation federation ingress**. That extension carries three constraints:

- Overlay ACLs are deny-by-default and tag-scoped. The PROD tag may reach only DEV's federation ingress port, and the DEV tag only PROD's. MCP, the portal UI and the database are not reachable from the peer tag.
- The overlay is reachability, never authority (NIST SP 800-207A, §15). Every request still passes link, device-signature, organization, environment and TAK checks. Possessing an overlay address grants nothing.
- `FederationLink.peerAuthorityUrl` points at the peer's overlay hostname. The SSRF guard in `client.ts` must allow exactly that hostname, not the overlay's address range.

Overlay relays (DERP) carry WireGuard-encrypted packets when direct hole-punching fails across the two NATs. They cannot read the payload. They do not store anything, so the overlay delivers only while **both** installs are online at the same time.

### 18.3 Disconnected operation — the contract

Disconnection is the normal case. The contract assumes either side can be offline for days, and that the two online windows may overlap only occasionally.

**Sender (outbox).** A peer task is a new record type on the existing `FederatedRecordMirror` outbox (`FEDERATION_OUTBOX_RECORD_TYPES`, `demand-delivery.ts:294`). It inherits behaviour that is already built and tested:

- An unreachable peer is held and retried with widening backoff. It never spends the dead-letter budget (`demand-delivery.ts:490-512`).
- A 401/403 quarantines the link.
- Other failures dead-letter after `MAX_ATTEMPTS = 8` (`demand-delivery.ts:248`).

**Envelope fields.** These are signed (§19.4) and fixed when the request is created, never at send time:

| Field | Meaning |
| --- | --- |
| `requestId` | Sender-minted ULID. The receiver's idempotency key. Never reused. |
| `createdAt` | When the requester asked |
| `notAfter` | The latest moment the receiver may *start* the work. The sender proposes it (default 72 h for validation recipes). The receiver may shorten it, never lengthen it. |
| `resultRetention` | How long the receiver keeps the result available for re-delivery (default 14 days) |
| `sourceInstallation` / `targetInstallation` | Installation DIDs |
| `organizationRef` | The organization the request is for. Must equal the link's bound organization. |
| `requesterEnvironmentClass` | The sender's attested environment class (§19.2) |
| `skill` | Exactly one declared receiver skill, e.g. `validation.recipe.run` |
| `parameters` | Validated by the receiver against that skill's schema |
| `delegation` | Requesting human Principal, requesting coworker GAID, and the approval receipt id from PROD |

**Receiver (inbox).** Ingress records `requestId` in an inbox row in the same transaction that creates the receiver-owned `TaskRun`.

- A duplicate returns the existing task's current state and never starts a second run.
- A request that arrives after `notAfter` is answered `rejected: expired`, and nothing runs.
- A cancel that arrives before work starts prevents the start. A cancel that arrives after work starts is recorded, and the recipe's own timeout governs.

**The 15-minute window.** The existing CloudEvent guard rejects events older than a 15-minute window (`cloud-event-guard.ts:1`). Held items pass today only because `time` is re-stamped at send. Under this revision, the replay defence for peer tasks is the inbox's durable `requestId` record, kept for at least `notAfter` + `resultRetention`, together with the signature over `createdAt`/`notAfter`. The send-time stamp remains a transport freshness hint only.

**Return path.** Results, status changes and artifacts travel the same way in reverse, on DEV's own outbox. When PROD is offline, DEV holds the result and delivers it on PROD's return. PROD correlates on `requestId` and on the receiver's task id echoed in every return event.

**Operator truth.** The sender's `TaskRun` shows `submitted-undelivered` until the receiver acknowledges. After acknowledgement it shows the receiver's A2A state (`submitted`, `working`, `input-required`, `completed`, `failed`, `rejected`, `canceled`). Past `notAfter` with no acknowledgement it shows `expired-undelivered`. Each state names the peer, the last successful contact, and the next retry.

### 18.4 When a relay is built

`BI-D43D3D76` remains deferred. It is promoted only when recorded evidence shows that overlay delivery leaves peer tasks undelivered past `notAfter` because the two installs' online windows did not overlap. The evidence is the count of `expired-undelivered` tasks over a rolling 30 days.

The envelope above is already transport-independent: signed end to end, idempotent, and expiring. A relay therefore stores ciphertext against `targetInstallation` and needs no change to the contract. The relay design must keep:

- separate mailboxes per organization and per environment class;
- payloads encrypted to the recipient installation key;
- delivery receipts and per-mailbox sequence numbers, so that a relay withholding messages is detectable.

Hosting a relay is an organization decision (§22).

## 19. Production and non-production trust

### 19.1 What the platform does today (verified on `origin/main` `ff4494cd31`)

These findings change the first-slice scope. Each is a defect to file, not a design preference.

| # | Finding | Evidence |
| --- | --- | --- |
| F1 | The peer-write stance says "Both installations are production" whenever the *local* class is production. The peer's class is never read. | `packages/db/src/installation-instance-stance.ts:164-168` |
| F2 | The peer's environment class exists only as an admin-typed `FederationLink.metadata.environmentClass` label (`apps/web/lib/actions/federation-links.ts:757`). It is not attested at enrollment, and only the founder demand portfolio reads it. | `federation-links.ts:757`; `FederationLink` has no class column (`edge-federation.prisma:379`) |
| F3 | An install that never declared its class is treated as production. A non-production install that skipped the declaration therefore presents itself as production. | `packages/db/src/installation-operating-intent.ts:365` |
| F4 | The `peerWrite` stance is advisory. Its readers are presentation and change-impact code; no write path enforces it. | survey of `installation-journey/identity-presentation.ts`, `identity-change-impact.ts` |
| F5 | "Paired installation: &lt;organization&gt;" shows the peer's *organization* reference, not a peer installation or DID. | `apps/web/lib/install/instance-stance.ts:199` |
| F6 | A same-organization membership link is created already trusted on both sides, with no human approver. Membership means a matching CA root plus a matching organization string. | `apps/web/lib/federation/organization-membership.ts:191` |
| F7 | Work sync serves every owned BacklogItem that is not confidential or restricted. It does no organization filtering, and the receiver writes rows without an organization check. A DEV install hosting other organizations would serve their `internal`/`public` items to PROD. | `apps/web/lib/federation/work-page.ts:130`; `work-sync.ts` contains no `organizationId`; `work/route.ts:46` checks only the link role |
| F8 | First-hop delegation passes on the origin's full authority. The comment says intersection. | `apps/web/lib/tak/delegation-authority.ts:71` |
| F9 | Every installation issues private GAIDs under the same issuer, `dpf.internal`, so the same agent id collides across installs. | `apps/web/lib/identity/principal-linking.ts:48` |
| F10 | Agent Cards are unsigned and declare A2A 0.3.0. | `apps/web/lib/a2a/agent-card.ts:121` |
| F11 | Federation routes authenticate a bearer `dpflink_` token. Bootstrap enrollment stores a *claimed* `peerDeviceId`, and no route checks a message signature. | `apps/web/lib/auth/federation-link-token.ts:36`; `apps/web/lib/federation/enrollment.ts:157` |
| F12 | The coworker-offer POST skips the session check for the `partner-a2a`/`external-a2a` profile, which the caller selects by query string. It creates an engagement from self-asserted GAID strings. Offer availability still limits which offers answer. Whether a proxy layer adds protection was not verified. | `apps/web/app/api/a2a/coworkers/[agentId]/offers/[offerId]/route.ts:66-69,133` |
| F13 | The development waivers of #6216 (`semantic-review-policy-exemption.ts`) trust a locally self-declared `development` class. They do not involve federation or any production authority, and they are unrelated to peer trust. | survey of commit `f881fcb84d` |

Already usable: the installation DID is the SHA-256 of the install's Ed25519 public key (`apps/web/lib/federation/instance-identity.ts:57`). A peer that has recorded the DID can therefore check any key presented later without a separate pinning store, provided the DID was obtained through an attested path rather than a claim (F11).

### 19.2 Decision — asymmetric, attested trust (`DI-13CEFD0A8156`)

The recommendation was **A1**: composite 12.91, margin 3.37, high confidence, no commandment conflict.

| Option | Composite |
| --- | --- |
| A1 — asymmetric rules; peer environment class attested by the organization CA | **12.91** |
| A4 — refuse to federate with any DEV install that hosts other organizations | 9.55 |
| A3 — asymmetric rules on a self-declared class | 9.01 |
| A2 — keep today's symmetric "both production" trust | 3.95 |

**Attested environment class.** The organization CA issues each installation's membership certificate. The certificate (or the signed membership statement bound to it) carries the installation's DID and environment class as attested fields. Both are recorded on `FederationLink` as typed columns, `peerEnvironmentClass` and `peerEnvironmentAttestedAt`, replacing the metadata label (F2). The attested class rules:

- The stance resolver reads the peer's attested class (fixes F1).
- An undeclared local class blocks issuing a membership certificate. It is not treated as production (closes the F3 hole for federation).
- Changing a class requires re-issuing the certificate. The peer sees the change as a new attestation and re-evaluates every open request.
- A link whose peer class is unattested accepts no peer tasks in either direction.

### 19.3 What each side may ask of the other

| Direction | Allowed | Never allowed |
| --- | --- | --- |
| PROD → DEV | Run a **read-only validation recipe** (§20) against a commit PROD names. Run a **host-mutating recipe** only after a DEV-local human approves it on DEV. Ask a DEV coworker an advisory question about DEV's own state (version, posture, Edge readiness). | Read or move any record DEV holds for another organization; read secrets or credentials; change DEV configuration, upgrade or tear down DEV (that is control-plane Slice 4, `BI-67219237`, blocked on the WWWD control-scope stance); supply a command line. |
| DEV → PROD | Return results, status and artifacts for tasks PROD sent. Send a **proposal** (e.g. "file this Windows defect"), which arrives as a pending item that a PROD human or authorized coworker accepts. Send advisory messages in a room PROD admitted it to. | Ask PROD to run any recipe or action; write or mutate any PROD record directly; have its evidence counted as canonical production runtime evidence (§19.5). |

These are platform defaults. Each installation may narrow them. Widening needs a new design revision.

### 19.4 Signed envelopes and identity

- Every peer-task event is a CloudEvent, signed with the sending installation's Ed25519 key over the canonical envelope (JWS, RFC 7515, `EdDSA`). The receiver verifies that the key hashes to the link's attested peer DID. HTTP-level RFC 9421 signing (§7) remains the target for all federation routes and is tracked with `BI-51FA49EB`. The envelope signature is what makes a stored result attributable after the fact, and it is required in the first slice.
- The requesting agent identity is carried as an attributed claim inside the signed envelope: requesting human Principal, coworker GAID, and PROD approval receipt id. The receiver records it as provenance. It is never authority, because the GAID namespace is not yet unique per installation (F9; `BI-F51DC0D3`).
- On the receiver, an inbound request runs as the link's `federated-peer` Principal (`packages/db/src/federation-link-types.ts:75`). Today that Principal has no grants, and `FederationLink.authorityBindingId` is never written. This revision gives it exactly one capability, `peer_validation_request`, through the link's `AuthorityBinding`. It grants nothing else.

### 19.5 Authority across the boundary

The §9 intersection holds, made concrete for this flow:

```text
PROD human approval at dispatch (sees target install, class, recipe, data crossing)
  ∩ PROD coworker grant: peer_task_submit
  ∩ link trusted ∧ peer DID attested ∧ peer class attested ∧ organizationRef = link org
  ∩ DEV federated-peer Principal grant: peer_validation_request
  ∩ DEV recipe catalog: recipe enabled, mutation class, repository allow-list
  ∩ DEV local approval when mutation class = host-mutating
  ∩ DEV Edge node scope policy: validation.recipe.run allowed on this node
```

The intersection has to be real in code. F8, where the first hop passes full origin authority, is fixed before any peer task is admitted.

**Evidence classification.** A result from DEV carries `producedBy: {installationDid, environmentClass: "development"|"test", edgeNodeId, recipeId, recipeDigest, commitSha}`. PROD accepts it as **peer validation evidence** on a backlog item PROD owns. It never satisfies a gate that requires canonical *production* runtime evidence. For `BI-BCF474E7` that is the right class: the item asks for evidence from the DEV install.

### 19.6 Keeping other organizations' test data on DEV

DEV hosts other organizations and archetypes for testing. Nothing they own may cross the operator organization's link. That takes four fail-closed checks, one at each place data could leak:

1. **Egress filter on every peer projection.** Anything DEV sends over the link must carry an `organizationId` equal to the link's bound organization. A row with a null or different organization is excluded, not defaulted. This fixes F7 for work sync and applies identically to peer-task results.
2. **Ingress re-check.** PROD re-checks the organization on every inbound projection and rejects mismatches, recording a safe audit entry. A mismatch is a defect on the sender, never data to keep.
3. **Results are built from recipe output only.** A validation recipe's artifact is its declared output (TAP summary, exit code, capped and redacted stdout/stderr) plus provenance. Recipes run in an ephemeral checkout of a public repository commit. They do not read DEV's database, other organizations' data or credentials. Output redaction strips environment values, tokens and user-profile paths before the artifact is written.
4. **No inventory leakage.** DEV's Agent Card projection and coworker discovery for the operator organization's link list only skills exposed to the operator organization. They never list coworkers, offers or organizations that belong to other tenants on DEV.

Option A4 (refuse to federate any multi-tenant DEV) scored second. It remains the fallback if the egress and ingress checks cannot be made provably fail-closed.

## 20. Receiver execution — validation recipes (`DI-259D82329EF4`)

### 20.1 Decision

The recommendation was **E1**: composite 12.66, margin 4.36, high confidence, no commandment conflict.

| Option | Composite | Reason |
| --- | --- | --- |
| E1 — one Edge action family, `validation.recipe.run`, over a receiver-owned recipe catalog, run by DEV's native Windows Edge node | **12.66** | Adopted |
| E3 — DEV's Linux sandbox container | 8.30 | Rejected: it cannot exercise Windows PowerShell or the Windows User environment, which is exactly what `BI-BCF474E7` must prove |
| E2 — a coding-agent client on DEV claims the task | 8.04 | Rejected as the primary path: DEV is unattended while the operator travels, and platform function must not depend on a client. It stays a manual fallback. |
| E4 — a generic `script.run` action | 3.25 | Rejected; contradicts §13.3 |

### 20.2 Recipe contract

A recipe is a versioned, receiver-owned entry. The sender may name `recipeId` and supply `commitSha` and `repository`, and nothing else.

| Field | Rule |
| --- | --- |
| `recipeId`, `version`, `digest` | The digest covers the full entry. The result reports the digest that ran. |
| `repository` | Must be on DEV's repository allow-list. Default: the platform repository only. |
| `commitSha` | Full 40-character SHA. DEV fetches it from the repository's origin (GitHub), never from PROD, so no source bytes cross the link. The SHA must be reachable from a ref on origin. |
| `argv` | Fixed in the catalog, e.g. `["node", "--test", "scripts/installer/mcp-client-env.test.mjs"]`. No interpolation of sender input. |
| `shell` | Windows recipes declare the PowerShell host they require (`powershell.exe` 5.1 and/or `pwsh`). The executor refuses to run if it is absent and reports that, rather than skipping. |
| `mutationClass` | `read-only` (the ephemeral checkout plus a temp directory) or `host-mutating` (for example writes the User environment) |
| `timeout`, `outputCap` | Enforced by the Edge executor |
| `expectations` | Machine-checkable pass criteria, e.g. TAP `# fail 0` and `# skip 0` |

The catalog ships with the release DEV runs, as reviewed source under `config/`. A DEV administrator can disable any entry locally. The Edge Go executor gains one action type whose parameters are exactly `{recipeId, version, repository, commitSha}`. Its allow-list stays closed (`packages/db/src/remote-action-dispatch.ts:30`; `services/edge-node-go/internal/action/executor.go:53-71`).

### 20.3 First catalog for `BI-BCF474E7`

| Recipe | Command | Class | Proves |
| --- | --- | --- | --- |
| `win.mcp-client-env.tests` | `node --test scripts/installer/mcp-client-env.test.mjs` | read-only | AC-1: the PowerShell cases run, with 0 skipped and 0 failed. The skip guard is at `scripts/installer/mcp-client-env.test.mjs:38`. |
| `win.mcp-health.tests` | `node --test scripts/hooks/mcp-health.test.mjs` | read-only | AC-2, test half |
| `win.bootstrap-toolchain.apply` | `powershell.exe -NoProfile -File scripts/dpf-bootstrap-agent-toolchain.ps1`, then report `DPF_CLAUDE_MCP_URL`/`DPF_MCP_URL` from the User environment | host-mutating | AC-3, environment half; AC-2, `mcp-health.ps1` half |

Two parts of `BI-BCF474E7` cannot be recipes:

- **"Claude desktop's dpf connector connects"** is a GUI observation. It returns as a human-attested artifact: a DEV person records it on DEV, and it travels back as evidence attributed to that person and installation.
- **Grok credential creation on a portal image containing `5960094`** depends on which image DEV is running. DEV reports its served version through the existing operational-posture projection, and the result records it.

### 20.4 Evidence back into the asking thread

When a result is accepted, PROD:

1. updates its initiating `TaskRun`, posting the result to the parent thread through the delivered child-result path (`apps/web/lib/tak/child-result-message.ts`), generalized to a peer-executed child;
2. records the artifacts as execution evidence on the named backlog item, with the §19.5 `producedBy` provenance and the result's signature;
3. files every failure as its own backlog item with the Windows output attached, which is `BI-BCF474E7` AC-4. The item is filed on PROD, by PROD, from DEV's signed result; DEV never writes to PROD.

Evidence is attached on PROD to PROD-owned items. It is never written onto a mirrored item, because mirrors are overwritten from their origin on the next sync.

## 21. What is built, specified and missing (2026-10-21)

### 21.1 Unverified

- DEV's own declared environment class, its served version, whether its native Edge node is running (`BI-0C326236` is open), and whether PowerShell 5.1 and `pwsh` are present. DEV was unreachable from PROD during this revision.
- Six slices of the federated-A2A plan (`BI-F51DC0D3`, `BI-51FA49EB`, `BI-B280E853`, `BI-90E338D8`, `BI-0E61A6A7`, `BI-68AF8D86`) return `authority_evidence_unavailable` on PROD, and their epic `EP-MSP-FEDERATION` is not found on PROD. They may exist only on the peer. Plan coverage must reconcile with them when they can be read; this revision does not create duplicates of them.
- Whether a proxy layer protects `/api/a2a/coworkers/*/offers/*` (F12).

### 21.2 Built, specified, missing

| Capability | State | Evidence |
| --- | --- | --- |
| Pairing: join files, organization CA, `dpflink_` tokens, dual approval | Built | `federation-membership-pack.ts`, `organization-membership.ts`, `federation-link-token.ts:36` |
| Installation DID derived from its Ed25519 key | Built | `instance-identity.ts:57` |
| Durable outbox with hold-while-unreachable | Built (demand, posture, declarations only) | `demand-delivery.ts:294,490-512` |
| Read-only same-org work sync (pull) | Built; no organization filter (F7) | `work-page.ts:130`, `work/route.ts:46` |
| Cross-install operational posture (visibility) | Built | `dpf.operational-posture.reported` on the outbox |
| Federated Work Room admit and mirror | Built, never called; flag off | `federated-room.server.ts:10,26` |
| Single-install child delegation with result to parent (#6300) | Built | `apps/web/lib/tak/child-result-message.ts` |
| MCP Tasks lifecycle over `TaskRun` (read side) | Built | `apps/web/lib/mcp/tasks-lifecycle.ts` |
| Edge RemoteAction signed dispatch | Built; Go runs only `inventory.collect`, Docker VM restart and organization join | `executor.go:53-71`, `remote-action-dispatch.ts:30` |
| Peer environment class attested | Missing (F1–F3) | — |
| Peer task event types, ingress route `/api/v1/federation/a2a`, sender tool | Specified (§7) | The route directory has no `a2a` entry |
| `TaskRun` peer link and remote task id | Missing | `build-delivery.prisma:1050` |
| Envelope signatures and HTTP message signatures | Specified (`BI-51FA49EB`) | F11 |
| Signed Agent Cards | Specified (`BI-B280E853`, `BI-40648BBF`) | F10 |
| Per-installation GAID namespace | Specified (`BI-F51DC0D3`) | F9 |
| Validation recipes | Specified here | — |
| Overlay reachability | Decided (`BI-CAF86466`), not built | — |
| Relay | Deferred (`BI-D43D3D76`) | — |

## 22. What the operator must decide or provide

| # | Item | Scope | Why it is the operator's |
| --- | --- | --- | --- |
| D1 | **Overlay account and control plane:** Tailscale SaaS account, or a self-hosted Headscale server with a publicly reachable host. With Tailscale, decide whether to enable Tailnet Lock so the vendor cannot add nodes. | Organization (WWWD) | Vendor relationship, cost and who can admit devices |
| D2 | **Enrol both machines** in the overlay (one sign-in each). DEV has to be enrolled at the machine or through remote access the operator already has. | Operator | Credentials are operator-only on a production install |
| D3 | **A DEV-local approver** for host-mutating recipes, or explicit acceptance that `win.bootstrap-toolchain.apply` waits until the operator is back at DEV | Organization | Human gate on a mutating action |
| D4 | **Whether to host a relay** if §18.4's trigger fires, and where | Organization | Always-on public infrastructure and its cost |
| D5 | **Control-scope stance** for `BI-67219237` (control-plane Slice 4, its review date has passed). This revision does not need it; it keeps PROD from upgrading or reconfiguring DEV. | Organization (WWWD) | Already recorded as an organization decision |
| D6 | Optional and faster: AC-1 and AC-2 of `BI-BCF474E7` can be proven today on a GitHub-hosted `windows-latest` runner, independent of this design. AC-3 still needs a real install. Choosing this unblocks the Windows defect hunt sooner. It proves nothing about cross-install tasking. | Operator | Choice of priority |

## 23. Delivery slices (summary; the plan holds the detail)

1. **Trust repairs:** attested peer environment class and the stance fix (F1–F3, F5); organization filter on work sync egress and ingress (F7); intersection on first-hop delegation (F8); offer-route credential (F12).
2. **Reachability:** both installs on the overlay, with `peerAuthorityUrl` on overlay hostnames. The existing work sync recovers, which is the first observable proof.
3. **Peer task contract:** signed envelope, outbox record type, inbox idempotency, `/api/v1/federation/a2a` ingress, `TaskRun` peer correlation, and the sender tool `request_peer_validation`.
4. **DEV execution:** recipe catalog and the Edge `validation.recipe.run` executor on Windows. Depends on `BI-0C326236`.
5. **First proof:** `BI-BCF474E7` driven from a PROD thread, with results on that item.
6. **Afterwards**, unchanged from §13: signed Agent Cards and discovery, Work Room mirroring, the general reverse direction, Edge inspection composition, MCP Tasks (`BI-06B66FFD`), and the relay on evidence.

## 24. Objectives and acceptance for this revision

**OBJ-XN1:** A thread on one operator-organization installation can ask the other installation to run a named validation recipe at an exact commit and receive an attributable, signed result in that thread and as evidence on a backlog item it owns, across two NATs, without a remote shell.

**OBJ-XN2:** Requests and results survive either installation being offline for days without loss, duplicate execution or silent expiry.

**OBJ-XN3:** Trust between a production and a non-production installation is asymmetric, attested, and expressed as an intersection of authority. No data owned by another organization on the non-production install can cross the link.

| ID | Objectives | Statement |
| --- | --- | --- |
| AC-XN-01 | OBJ-XN1 | From a PROD thread, a request for `win.mcp-client-env.tests` at a named SHA runs once on DEV's Edge node and returns TAP output, exit code and provenance into that thread. |
| AC-XN-02 | OBJ-XN1 | The returned result is recorded as peer validation evidence on `BI-BCF474E7`, with installation DID, environment class, Edge node, recipe digest, commit SHA and a verifiable signature. |
| AC-XN-03 | OBJ-XN1 | A request naming an unknown recipe, an unlisted repository, a short SHA or any extra parameter is rejected before any `TaskRun` or `RemoteAction` is created on DEV. |
| AC-XN-04 | OBJ-XN1 | A host-mutating recipe does not start until a DEV-local human approves it, and PROD shows it as `input-required` meanwhile. |
| AC-XN-05 | OBJ-XN2 | With DEV offline at dispatch, the request is held and delivered when DEV returns, and PROD shows `submitted-undelivered` with last contact until acknowledgement. |
| AC-XN-06 | OBJ-XN2 | With PROD offline when the run finishes, DEV holds the result and PROD receives it on return, correlated to the original request. |
| AC-XN-07 | OBJ-XN2 | Re-delivering the same `requestId` any number of times creates one `TaskRun`, one `RemoteAction` and one result. |
| AC-XN-08 | OBJ-XN2 | A request that reaches DEV after `notAfter` is rejected as expired and does not run; PROD shows `expired-undelivered` or `rejected: expired`. |
| AC-XN-09 | OBJ-XN3 | PROD's stance reports DEV's attested environment class; a link whose peer class is unattested accepts no peer task in either direction. |
| AC-XN-10 | OBJ-XN3 | A DEV row owned by another organization, or with no organization, never appears in PROD's work sync, peer results or Agent Card projection, and PROD rejects one injected at ingress. |
| AC-XN-11 | OBJ-XN3 | DEV cannot cause any recipe, action or record mutation on PROD; a DEV-originated request to do so is rejected and audited. |
| AC-XN-12 | OBJ-XN3 | A delegated peer task carries no authority beyond the intersection in §19.5; the first-hop delegation test proves the delegated scope is narrower than the origin's. |
| AC-XN-13 | OBJ-XN3 | Overlay ACLs allow the peer tag to reach only the peer's federation ingress port; MCP and the portal UI are unreachable from it. |

Acceptance is functional, on the two canonical installations, per §14. Unit and contract tests are prerequisites, not evidence of completion.
