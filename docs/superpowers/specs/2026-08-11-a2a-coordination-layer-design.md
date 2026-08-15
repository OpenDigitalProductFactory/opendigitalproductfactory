# Cross-Install A2A Coordination — DPF Testing and MSP Operations Spine

**Original date:** 2026-08-11

**Revised:** 2026-08-15

**Status:** Architecture-reviewed design of record; implementation incomplete

**Backlog:** `BI-AD9ABD38` under `EP-E1F1DB58`

**Decision:** `DI-5ACBF7782FF2` — extend the existing federated-A2A substrate; do not move collaboration into Edge or create an MSP-specific transport
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

- arbitrary remote shell or script execution;
- direct writes into a peer/customer database;
- public anonymous A2A or a global agent registry;
- cross-org standing mutation authority;
- hosted relay implementation or full Internet reachability;
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
