# Federated A2A Coordination with GAID — Design Specification

**Date:** 2026-08-08

**Status:** Architecture-reviewed; enterprise identity-boundary amendment governed; implementation scope decomposed

**Decision:** `DI-B726A1900E7C` — link-bound signed GAID claim

**Identity-boundary decision:** `DI-6FE234A7399E` — protected full participation graph plus public boundary projection and signed commitment

**Implementation-scope decision:** `DI-61395D1B7A6D` — six independently reviewable, feature-gated slices under one same-org umbrella

**Delivery shape:** one same-organization product outcome, decomposed into governed implementation BIs; no implementation code in this document branch

**Backlog:** umbrella `BI-BE0E14E0` and six mapped siblings under `EP-MSP-FEDERATION` on this install; `EP-E1F1DB58` remains the A2A-adoption install's program anchor (see §3)

**Design WorkCapsule:** `WC-647895E9`

## 1. Executive decision

Two sovereign DPF installations coordinate through one composed identity and trust model:

- `FederationLink`, `inst_…`, and the paired Ed25519 `did_…` device identity answer **which installation may talk, and through which governed relationship**.
- GAID and AIDoc answer **which enduring agent is speaking**.
- canonical organization identity and an installation environment classification answer **for which organization and environment the agent is acting**.
- TAK grants, coworker delegation rules, service-offer policy, and the link's projection/authority contracts answer **what that agent may do here**.

The selected design carries a typed GAID claim and standard A2A data model inside the existing federation CloudEvent path. The receiver first authenticates the mutual `dpflink_…` token, then verifies an RFC 9421 HTTP Message Signature and `Content-Digest` with the peer Ed25519 key pinned to the same `FederationLink`. It accepts the GAID only when the claim matches a signed, link-scoped Agent Card/AIDoc projection previously received through that link. The receiving install resolves the local target by GAID and applies its own TAK/delegation and data-boundary policy. No peer can confer authority on itself.

This extends the federation substrate. It does not introduce a second transport, a new agent-identity scheme, a remote-agent table, or per-agent credentials.

Enterprise identity is deliberately two-view. Each sovereign source retains a complete,
receipt-linked graph of every materially participating agent by canonical GAID. Before an event,
card, artifact, receipt, error, or response crosses an organization boundary, the existing
`ProjectionContract` derives a boundary view containing only approved `gaid:pub` aliases. When
internal participants are withheld, the signed response says so and carries a privacy-preserving
commitment to the protected graph. The public boundary agent remains accountable without exposing
the company's private agent inventory or topology.

## 2. Problem and first slice

The organization's production and development installations already exchange federated demand as sovereign peers. The next layer is a coworker on one installation delegating a task to a coworker on the other while an operator can prove:

1. which trusted installation sent the request;
2. which GAID claimed the acting and delegating roles;
3. which organization and environment originated the work;
4. which verified Agent Card/AIDoc authorized that claim;
5. which local policy allowed the target coworker to accept it; and
6. which task, messages, artifacts, decisions, and receipts belong to that chain of custody.

The first product slice is same-organization, two-install coordination over an already trusted `FederationLink`. Cross-organization A2A remains deny-by-default and is not enabled by this slice.

### 2.1 In scope

- link-scoped discovery of eligible remote coworkers using A2A v1.0 Agent Cards;
- authenticated A2A task initiation, status retrieval, additional input, cancellation, and artifact return;
- device-signed binding of acting/delegating GAIDs to the existing federation request;
- complete source-side multi-agent participation custody and policy-derived same-org/cross-org
  identity projection;
- receiver-side target resolution, TAK authority checks, projection minimization, replay protection, task ownership, and audit receipts;
- an operator-facing A2A readiness and provenance view on the existing federation-link and engagement surfaces;
- a compatibility path from the current DPF A2A-shaped service-offer/task implementation to the standard A2A data model.

### 2.2 Out of scope

- public anonymous A2A discovery;
- a public GAID registry, new GAID syntax, or an alternate agent identifier;
- independent per-agent keypairs or OAuth clients;
- cross-organization execution authority;
- arbitrary remote MCP proxying;
- changing the canonical federation transport or replacing `FederationLink`;
- copying private prompt, memory, tool configuration, or unrestricted agent metadata across the link;
- implementation code in this design thread.

## 3. Backlog anchoring across two sovereign backlogs

This is not a backlog-integrity error; it is the first live proof of the problem this spec exists to solve. Two independent design threads verified backlog anchors against **two different sovereign installs**, and each install's backlog is missing the other's identifiers:

| Anchor | This-install (MSP-federation) backlog | A2A-adoption-program backlog | Verified |
| --- | --- | --- | --- |
| `EP-MSP-FEDERATION`, `EP-A2A`, `EP-TAK-3F9A21`, `EP-COWORKER-IDENTITY-360`, `BI-BE0E14E0` | present | **absent** | 2026-08-08 |
| `EP-E1F1DB58` (open), umbrella `BI-1F4A4861`, its 10 slice BIs (`BI-DA53D067` … `BI-5FB59BC6`) | **absent** | present | 2026-08-08, live MCP |

Neither anchor set is fictional. A thread that runs `get_backlog_item("EP-E1F1DB58")` on the MSP-federation install correctly gets `not_found`, while a thread on the A2A-adoption install correctly retrieves `BI-1F4A4861` ("Umbrella — MCP 2025-11-25 + A2A feature adoption"). (Note also that `get_backlog_item` returns `not_found` for *any* epic ID even on the install where it exists — epics resolve through `list_epics`, not `get_backlog_item`; do not read that as absence.) The divergence is exactly an **install-agnostic-identifier collision across sovereign installs** — the same failure mode §4.1 describes for `gaid:priv:dpf.internal:*`, here applied to backlog IDs. It validates the design rather than undermining it.

**Anchoring rule (act on this):**

- On the **MSP-federation install**, this slice is `BI-BE0E14E0` under `EP-MSP-FEDERATION` (the parent that owns `FederationLink`, projection contracts, federated record mirrors, and sovereign-peer identity), cross-referencing `BI-COWORKER-360-AGENTCARD` for the single Agent Card source of truth.
- On the **A2A-adoption install**, the identical work is a new slice under `EP-E1F1DB58` (the "MCP 2025-11-25 + A2A feature adoption" program, umbrella `BI-1F4A4861`), sitting after its already-filed siblings — most directly **Slice 6 `BI-40648BBF`** (A2A signed agent-card export), **Slice 4 `BI-06B66FFD`** (standard MCP Tasks lifecycle → `TaskRun` convergence), and **Slice 10 `BI-5FB59BC6`** (`find_coworker`, shipped as #4121). See §4.5 for the concrete reuse those siblings force.
- Whichever backlog the build thread runs against, it files/claims the slice there and records the other install's anchor as the cross-reference. The two records converge only when a federation link carries them — which is the capability this slice ships.

Other verified live programs on the MSP-federation install remain: `EP-A2A` (done — earlier internal handoff/summon precedent, not reopened), `EP-TAK-3F9A21` (done — delivered GAID-Private/AIDoc projection, a dependency), `EP-COWORKER-IDENTITY-360` (open — unified coworker read model and whole-coworker Agent Card, a coordination seam).

### 3.1 BI synchronization addendum

The two installations are beginning to synchronize BI visibility. That improves operational coordination but does not collapse sovereignty or become part of the A2A protocol:

- synchronized peer work is a mirror/crosswalk unless the governed backlog-sync contract explicitly adopts it into local authority;
- a bare `BI-…` remains install-local and must be interpreted with source-install provenance;
- synchronization must converge counterpart references and prevent duplicate filing; it must not create two writers for one canonical `BacklogItem`;
- A2A consumes the resulting work identity and coordination context later, after link/device/GAID authority is established. It does not transport or reconcile backlog state.

The implementation plan therefore begins with a live parity/overlap preflight. Current live MCP on the MSP-federation install still does not expose `EP-E1F1DB58` or its slice BIs, so this document does not claim parity is already complete. Once the sync view is available, build threads reuse its canonical crosswalk and explicit counterpart records rather than inventing a second mapping scheme.

## 4. Verified substrate ledger

### 4.1 GAID, AIDoc, and principal identity

The canonical standard is [`docs/architecture/GAID.md`](../../architecture/GAID.md):

- GAID syntax is `gaid:<scope>:<issuer-prefix>:<agent-local-id>`.
- GAID is the enduring interoperable agent identifier and resolves to an AIDoc.
- an A2A Agent Card should carry or reference GAID; task and artifact events preserve chain of custody;
- an HTTP carrier should bind the GAID claim to the request signature;
- GAID-Federated requires signed AIDoc publication, receipt integrity, and status checking.

The canonical runtime projection is not an `Agent.gaid` column. [`apps/web/lib/identity/principal-linking.ts`](../../../apps/web/lib/identity/principal-linking.ts) creates one `Principal(kind="agent")` and joins its local `agent` alias to a `gaid` alias. [`apps/web/lib/identity/aidoc-resolver.ts`](../../../apps/web/lib/identity/aidoc-resolver.ts) resolves the AIDoc from that principal. This design keeps that spine and uses `PrincipalAlias` for every local lookup.

#### Conformance gap discovered

`buildPrivateAgentGaid` currently emits `gaid:priv:dpf.internal:<agent-id>`. The GAID standard requires a private issuer prefix to include a stable installation, domain, or equivalent namespace discriminator. `dpf.internal` alone cannot guarantee uniqueness across sovereign installations. Therefore, a current private GAID string must not be promoted to “globally verified” merely because it parses.

The GAID standard's enterprise identity-boundary contract is now normative in
[`docs/architecture/GAID.md`](../../architecture/GAID.md) §§6.5 and 10.6. It distinguishes the
complete protected participation graph from the public boundary projection. This specification
profiles that rule for A2A; it does not restate GAID subject semantics or mint a boundary-only ID.

The build slice must first converge issuer configuration and alias continuity using the existing GAID/PrincipalAlias model:

- use a stable, governed issuer namespace shared by the administrative authority for an enduring agent subject;
- preserve an existing canonical GAID when a governed identity-continuity record says two installations host the same enduring subject;
- mint distinct GAIDs when the coworkers are distinct subjects, even if their configuration is cloned;
- retain legacy private aliases for local resolution during migration, but never advertise them as federation assurance;
- use GAID-Public when an agent crosses its original administrative boundary, as the GAID standard requires.

This is GAID conformance work, not a new identity scheme.

For the same-organization slice, the link's approved `AuthorityBinding` names the GAID issuer namespace(s) that the peer device may attest. The peer cannot self-authorize a new issuer in a request. A device-signed card proves what the installation asserted; the AIDoc/issuer binding proves that the installation is entitled to assert that GAID namespace. Both checks are required.

### 4.2 Coworker authority and receipts

- [`apps/web/lib/tak/collaboration-authority.ts`](../../../apps/web/lib/tak/collaboration-authority.ts) already denies a handoff unless the source coworker's `delegatesTo` or `escalatesTo` policy names the target.
- [`apps/web/lib/tak/coworker-collaboration.ts`](../../../apps/web/lib/tak/coworker-collaboration.ts) already creates local delegation chains through the canonical work-thread path.
- [`apps/web/lib/tak/agent-card-service.ts`](../../../apps/web/lib/tak/agent-card-service.ts) projects `dpf.agent-card.v1` with GAID/AIDoc and effective tool authority.
- [`apps/web/lib/coworker-service-catalog/a2a-tasks.ts`](../../../apps/web/lib/coworker-service-catalog/a2a-tasks.ts) already persists A2A-shaped task status, messages, artifacts, GAIDs, call chains, and receipts.
- `TaskRun` already owns `TaskNode`/`TaskNodeEdge`, which represent parent relationships,
  fan-out/fan-in dependencies, worker roles, authority/evidence contracts, and influence. `TaskArtifact`
  already carries producer agent/node references. This is the canonical graph substrate for the
  participation view; no `AgentParticipationGraph` table is authorized.

The current cross-boundary service-offer POST requires `actingAgentGaid` and `delegatingAgentGaid`, but accepts them as caller-supplied strings. The current delegation receipt is a local HMAC. Neither proves to another sovereign installation that the authenticated peer device vouched for those GAIDs. That is the gap this design closes.

The current A2A task metadata is also scalar: it records acting, delegating, and delegated GAID
strings, then returns acting/delegating values unchanged in the external task projection. It does
not model an arbitrary number of participating agents, fan-out/fan-in, GAID scope validation,
private-to-public boundary mapping, or egress redaction. A build must replace that scalar seam with
the canonical participation-graph projection in §8.2; it must not bolt redaction onto individual
routes.

### 4.3 Federation transport and trust

- [`apps/web/lib/federation/instance-identity.ts`](../../../apps/web/lib/federation/instance-identity.ts) generates an Ed25519 keypair and derives stable `did_…` from the public key.
- [`apps/web/lib/federation/demand-identity.ts`](../../../apps/web/lib/federation/demand-identity.ts) persists `inst_…`, device ID, public key, and encrypted private key in the canonical federation identity configuration.
- [`apps/web/lib/federation/sas-pairing.ts`](../../../apps/web/lib/federation/sas-pairing.ts) defines the device-ID SAS transcript.
- [`apps/web/lib/federation/enrollment.ts`](../../../apps/web/lib/federation/enrollment.ts) creates the peer `Principal` and `FederationLink`, requires dual approval, and manages mutual hashed/encrypted `dpflink_…` tokens.
- [`apps/web/lib/auth/federation-link-token.ts`](../../../apps/web/lib/auth/federation-link-token.ts) rejects links that are not trusted or are quarantined/revoked.
- [`apps/web/lib/federation/cloud-event-guard.ts`](../../../apps/web/lib/federation/cloud-event-guard.ts) validates CloudEvents 1.0 shape and replay time. Its own comment accurately says the bearer token is currently the sole authenticator.
- [`packages/db/src/federated-demand-contract.ts`](../../../packages/db/src/federated-demand-contract.ts) and the federation routes already implement typed, minimized, routed cross-install envelopes.
- `ProjectionContract` is the per-link allowlist and `FederatedRecordMirror` is the generic link-scoped mirror/crosswalk substrate.

The missing trust material is explicit peer device pinning: `FederationLink` stores the peer installation ID but does not yet store the peer `did_…` or Ed25519 public key. The first build phase extends that existing row and enrollment handshake. It does not create a device or credential table.

### 4.4 Existing A2A route gap

The current `/api/a2a/coworkers/{agentId}/offers/{offerId}` and `/api/a2a/tasks/{taskId}` surfaces are useful internal projections, but they are not a safe sovereign-peer ingress:

- partner/external submission is not authenticated through `FederationLink`;
- a task can be retrieved by task ID without link ownership enforcement;
- the operation and object shapes are A2A-inspired rather than a complete standard binding;
- cross-boundary GAID strings are not cryptographically linked to the peer device or a signed card.

The implementation must keep internal consumers working, but all cross-install traffic moves behind `/api/v1/federation/*`. The existing `/api/a2a/*` code becomes an internal adapter to the canonical task service, not a second external trust path.

### 4.5 Cross-install verification addendum — reuse targets and concrete primitives

An independent substrate sweep (2026-08-08, against `origin/main` at `bc5a0debd`, not the stale root clone) confirmed the substrate above and surfaced six concrete, actionable items the build must honor so it reuses rather than re-invents:

1. **Consume Slice 6, do not rebuild it.** `apps/web/lib/a2a/agent-card.ts` already serves the A2A v0.3.0 card at `/.well-known/agent-card.json` and `/.well-known/agent-card/{agentId}`, gated `EXPORT_GATE` to `active/production/public` only. But today it emits `provenance.signed: false` and carries **no `gaid` field**. The §8.4 target (JWS-signed, GAID-in-`extensions`) is precisely the delta to add onto this existing builder — the link-scoped extended card projects from it, it is not a fork.
2. **Coordinate `TaskRun` convergence with Slice 4.** `BI-06B66FFD` (standard MCP Tasks lifecycle over `TaskRun`, via `apps/web/lib/mcp/tasks-lifecycle.ts`) converges the bespoke `tasks/submit` onto standard `tasks`. §8.5's `TaskRun`/`CoworkerEngagement` consolidation touches the same rows; the two must land as one convergence, or the second one fights the first. Treat Slice 4 as a hard sequencing dependency where the installs share it.
3. **Make cross-install discovery the federated twin of `find_coworker`.** `find_coworker` (Slice 10, shipped #4121, `apps/web/lib/mcp/packs/coworker-pack.ts`) is the *local* intent-based discovery meta-tool. §12.2 remote-coworker discovery should extend it with a link-scoped, projection-gated result set — not a parallel discovery path. This was Slice 10's own framing ("A2A-plane twin of `load_tools`").
4. **Fix the `priv`/`private` GAID scope-token split as part of §4.1 conformance.** `buildPrivateAgentGaid` (`apps/web/lib/identity/principal-linking.ts`) emits `gaid:priv:…`, but the catalog fallback at `apps/web/lib/coworker-service-catalog/agent-card.ts:105` emits `gaid:private:…`. Left unfixed, two installs comparing GAID strings will silently mismatch on the scope token before the namespace question is even reached. This is a latent cross-install bug, not cosmetic.
5. **Name the feature flag on the existing pattern.** Federation receiving routes are gated by `DPF_FEDERATION_EXCHANGE_ENABLED` (`apps/web/app/api/v1/federation/**`). A2A adds a sibling `DPF_FEDERATION_A2A_ENABLED` (or a per-link A2A capability bit) so demand and A2A gate independently — the plan's "feature-gated" phrasing resolves to this concrete flag.
6. **Reuse the CloudEvent link-binding and replay primitives verbatim.** `cloud-event-guard.ts` already enforces the `dpflinkid` extension (`=== authenticated linkId`, else `link:mismatch`) and a ±15-minute replay window. The A2A event types (§8.3) ride these unchanged; the new work is the RFC 9421 signature layer over them (§9), not a second envelope validator.
7. **Project participation from the canonical task graph.** `TaskRun` already owns
   `TaskNode`/`TaskNodeEdge`; `TaskArtifact` already records producer agent/node references. S4 adds
   the minimum canonical Principal/GAID and receipt bindings those nodes require, then derives the
   protected participation graph from them. It does not add an A2A participation or receipt graph
   table.

## 5. Research and benchmarking

### 5.1 Standards adopted

#### A2A Protocol v1.0

The [A2A v1.0 specification](https://a2a-protocol.org/latest/specification/) defines Agent Cards, messages, tasks, artifacts, discovery, and three standard bindings. DPF adopts:

- the canonical Agent Card and Agent Skill fields;
- `/.well-known/agent-card.json` semantics, but exposes a minimal link card and authenticated link-scoped extended cards rather than a public coworker inventory;
- the A2A Task, Message, Part, Artifact, status, history, context, cancellation, and idempotency semantics;
- HTTP+JSON/REST as the adapter-level operation vocabulary;
- `A2A-Version` and negotiated extension identifiers;
- JWS-signed Agent Cards using RFC 8785 canonicalization;
- the standard rule that every incoming request is authenticated and authorized by the receiving server.

A2A explicitly leaves identity at the protocol layer. DPF therefore adds a GAID extension profile and uses the federation trust envelope as that protocol-layer identity mechanism. This is an extension, not a competing A2A identity proposal.

The official [enterprise implementation guidance](https://a2a-protocol.org/latest/topics/enterprise-ready/)
adds useful expectations for TLS, standard web authentication, least privilege, data minimization,
distributed tracing, audit, and API management. The core specification also requires authorization
scoping on every operation, permits authenticated extended Agent Cards, supports signed cards, and
provides negotiated strongly typed extensions. DPF adopts all of those mechanisms.

The enterprise gap is explicit rather than rhetorical:

| Enterprise concern | A2A v1.0 position | DPF GAID profile |
| --- | --- | --- |
| Enduring agent-subject identity | identity is handled outside A2A payload semantics | canonical GAID/AIDoc through `Principal` + `PrincipalAlias` |
| Internal versus external agent identity | no private/public agent alias or boundary-mapping contract | GAID §§6.5 and 10.6 |
| Multi-agent delegation/contribution custody | task history and trace hooks, but no normative participant graph | receipt-linked acyclic participation graph |
| Cross-org topology minimization | general data-minimization guidance; authorization model is implementation-defined | `ProjectionContract`-derived public view, no private GAIDs |
| Proof that withheld lineage was not rewritten | no normative selective-disclosure or commitment object | signed, nonce-hiding participation commitment |
| Multi-tenancy | opaque routing by URL, credentials, or `tenant` | retained as routing only; never treated as GAID or disclosure authority |

The DPF profile uses A2A's extension negotiation and metadata points. It does not modify standard
Task, Message, Artifact, Agent Card, authentication, or routing semantics. A peer that does not
understand the required GAID boundary extension cannot participate in cross-organization DPF A2A.

DPF does **not** declare the CloudEvent carrier itself to be an A2A-compliant custom binding in the first slice. A2A requires a custom binding to implement every core operation and preserve the complete data model and semantics. Instead, DPF treats the CloudEvent as its authenticated federation delivery envelope; the typed payload and adapter implement the A2A operation/data semantics. Public custom-binding conformance is a later standards decision.

#### MCP

The [A2A/MCP comparison](https://a2a-protocol.org/latest/topics/a2a-and-mcp/) separates agent-to-agent collaboration from agent-to-tool/resource access. DPF keeps that boundary:

- A2A coordinates sovereign agents and their shared task lifecycle.
- MCP remains the local tool plane used by each agent under its own install's grants.
- an A2A peer never acquires raw MCP credentials or direct access to another install's MCP server.

MCP 2025-11-25 Tasks are useful precedent for receiver-owned task IDs, explicit authorization-context binding, polling, cancellation, TTLs, and audit. They remain experimental in that version, and the [2026-07-28 release candidate](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/) moves long-running Tasks to an extension while making the core stateless. Therefore, this design does not make DPF A2A task state depend on MCP Tasks or copy a version-specific MCP state machine. It preserves a mapping adapter only.

#### CloudEvents and HTTP signing

DPF retains CloudEvents 1.0 for existing federation routing and event metadata. It adopts [RFC 9421 HTTP Message Signatures](https://www.rfc-editor.org/rfc/rfc9421.html) with Ed25519 and the [RFC 9530 `Content-Digest` field](https://www.rfc-editor.org/rfc/rfc9530.html) to bind method, target, selected federation headers, digest, creation/expiry, nonce, and device key ID. It adopts [RFC 8785 JCS](https://www.rfc-editor.org/rfc/rfc8785.html) for A2A Agent Card JWS canonicalization.

### 5.2 Open-source implementation benchmarks

| Benchmark | What DPF adopts | What DPF rejects |
| --- | --- | --- |
| [Official A2A SDKs](https://github.com/a2aproject) | generated/protocol-owned types, standard cards, operation semantics, version negotiation, card signing helpers | exposing a standalone public A2A server that bypasses DPF federation policy |
| [Google Agent Development Kit](https://github.com/google/adk-python) | thin A2A adapter around an opaque agent and explicit task/event translation | making framework runtime identity authoritative instead of GAID/Principal |
| [Microsoft AutoGen](https://github.com/microsoft/autogen) | explicit handoff/team events and observable coordination history | importing an in-process team topology as DPF's cross-install authority or transport |

Adoption of a runtime SDK is not approved by this specification. The build must evaluate dependency, license, server-runtime fit, version pinning, and generated-type blast radius before adding one. Implementing the small adapter against published protocol types may be preferable to importing an agent framework.

## 6. Core decision: how GAID binds to federation trust

### 6.1 Options scored

The decision used the closed principle dimensions as magnitudes. `blast_radius` is a cost axis: higher is worse.

| Option | Schema grounding | Maintainability | Governance compliance | Evidence density | Blast radius |
| --- | ---: | ---: | ---: | ---: | ---: |
| A — link-bound signed GAID claim in existing federation envelope | 0.98 | 0.92 | 0.98 | 0.95 | 0.32 |
| B — separate A2A route/channel keyed by GAID, using link token | 0.58 | 0.48 | 0.55 | 0.68 | 0.72 |
| C — per-agent credential mapped to GAID | 0.30 | 0.34 | 0.62 | 0.90 | 0.90 |

### 6.2 Kernel result

`principle_decide` recorded `DI-B726A1900E7C` against the platform profile:

- recommendation: **A — link-bound signed GAID claim**;
- composite: `10.4771`;
- margin over runner-up: `5.4119`;
- confidence: high;
- signal: usable, strong structured coverage, no retrieval degradation;
- commandment conflict: none.

The largest positive pulls were Ship Real Functionality, Never Assume — Verify, Architecture Over Shortcuts, Research and Use Standards, Single Source of Truth, and Ground New Work in Existing Platform. The decision is advisory; this specification adopts it.

### 6.3 Rejected options

**Separate A2A channel.** Rejected because a second ingress/replay/projection/authentication path would make the same peer relationship mean different things depending on route. A standard A2A adapter remains allowed only behind the federation boundary.

**Per-agent credential.** Rejected for this layer because it creates a second credential lifecycle, turns every coworker into a remote security principal at transport level, and duplicates the install trust already established by `FederationLink`. A future high-assurance profile may add agent-held proof as an additional factor, but it cannot replace or bypass the link.

### 6.4 Enterprise identity-boundary decision

`principle_decide` recorded `DI-6FE234A7399E` against the platform profile for the second core
question: how a complete multi-agent GAID chain crosses an organization boundary.

| Option | Composite | Disposition |
| --- | ---: | --- |
| Full private/internal chain disclosure | `4.529` | rejected: exposes protected identity and topology |
| Public alias for every internal hop | `6.975` | rejected: forces unnecessary public issuance and still exposes topology |
| **Protected full graph + minimized public view + signed commitment** | **`10.673`** | **selected** |
| Boundary agent only, with no commitment | `6.529` | rejected: loses verifiable custody and can falsely imply sole performance |

Margin over the runner-up was `3.698`; confidence was high; structured coverage was strong; no
commandment conflict was found. The strongest positive contributions were Ship Real Functionality
and Research and Use Standards. The selected option also best fits principal convergence,
projection-contract reuse, data privacy, and evidence density.

## 7. Target architecture

```mermaid
flowchart LR
    subgraph A["Sovereign install A"]
      AA["Acting coworker\nGAID + local TAK"]
      AO["A2A adapter"]
      AF["Federation outbox\nCloudEvent + projection gate"]
      AK["Ed25519 device key\ndid_A"]
      AA --> AO --> AF
      AK -->|"RFC 9421 sign"| AF
    end

    FL["Mutually approved FederationLink\ndpflink token + pinned devices"]

    subgraph B["Sovereign install B"]
      BI["Federation ingress\ntoken, signature, replay, contract"]
      BR["GAID/AIDoc card binding\nlink-scoped mirror"]
      BT["Local target coworker\nGAID + TAK/delegation"]
      BS["Canonical task/engagement\nmessages + artifacts + receipts"]
      BI --> BR --> BT --> BS
    end

    AF --> FL --> BI
```

The proof is intentionally layered:

| Layer | Canonical value | Question answered | Does not answer |
| --- | --- | --- | --- |
| Link | `FederationLink.linkId` + mutual token | is this a trusted, active relationship? | which agent is speaking |
| Device | `did_…` + pinned Ed25519 public key | did the enrolled peer device sign this request? | whether the claimed agent is allowed |
| Installation | `inst_…` | which sovereign installation originated and routed it? | agent identity or environment |
| Agent | GAID + signed AIDoc/card digest | which enduring coworker does the peer attest is acting/delegating? | local authorization |
| Organization | canonical Organization reference | for whose administrative/business boundary? | environment |
| Environment | closed installation classification | production, development, staging, or other governed class | identity |
| Authority | local TAK, delegation, offer, projection, and consent rules | may this action occur here? | transport authenticity |

The enterprise identity boundary is a projection boundary, analogous to network address/topology
screening but without creating translated agent identities:

```mermaid
flowchart LR
    subgraph S["Source organization — protected view"]
      A1["GAID private — originator"]
      A2["GAID private — specialists"]
      A3["GAID public/private — accountable boundary agent"]
      TG["TaskRun + TaskNode/TaskNodeEdge + receipts"]
      A1 --> TG
      A2 --> TG
      A3 --> TG
    end

    PC["ProjectionContract\nrelationship + field policy"]
    BP["Boundary projection\npublic GAIDs + minimized marker"]
    CM["Signed hiding commitment\nto protected graph"]

    TG --> PC --> BP
    TG --> CM --> BP
    BP --> R["External relying party"]
```

The relying party can verify the boundary signature and later request an authorized commitment
opening, but cannot enumerate the protected agents or topology from the ordinary response.

## 8. Canonical contracts

### 8.1 Federation link identity extension

Extend `FederationLink` with typed peer-device trust fields rather than burying security-critical state in unvalidated JSON:

- `peerDeviceId` — `did_…` derived from the pinned public key;
- `peerSigningPublicKey` — Ed25519 SPKI public key representation;
- `peerSigningKeyPinnedAt` and `peerSigningKeyRotatedAt`;
- `environmentClass` using the existing closed `FOUNDER_DEMAND_ENVIRONMENTS` vocabulary (`production`, `development`, `test`).

Enrollment/pairing must validate `deriveDeviceId(peerSigningPublicKey) === peerDeviceId`, include both device IDs and installation IDs in the SAS transcript, and require explicit dual approval for first pin or rotation. A legacy trusted link without a pinned key is `demand-ready` but `a2a-not-ready`; it must never silently downgrade A2A to token-only authentication.

`environmentClass` already lives in `FederationLink.metadata` and is consumed by federated demand. This slice promotes it to a typed Prisma enum column on `FederationLink`, backfills from metadata with the existing safe `development` fallback, dual-reads only during migration, and then removes the metadata write path. A2A imports the generated union; it does not create a second environment vocabulary.

### 8.2 DPF federation A2A extension profile

Define one versioned extension URI owned by the GAID standard, for example a repository-controlled HTTPS URI ending in `/gaid-a2a/v1`. The exact public URI is an implementation-time standards/namespace decision, not invented in this spec.

The extension metadata carried with each A2A request is:

```ts
type DpfFederatedAgentContextV1 = {
  actingAgentGaid: string;
  delegatingAgentGaid: string;
  targetAgentGaid: string;
  gaidIssuerPrefix: string;
  gaidIssuerBindingRef: string;
  aidocDigest: string;
  agentCardDigest: string;
  boundaryProjection: {
    mode: "full" | "boundary-minimized";
    policyRef: string;
    publicParticipants: Array<{
      publicHopId: string;
      agentGaid: string;
      role: "originator" | "delegator" | "actor" | "contributor" | "approver" | "executor" | "publisher";
      visibleParentHopIds: string[];
    }>;
    participationMinimized: boolean;
    commitment?: {
      algorithm: "sha-256";
      canonicalization: "RFC8785";
      digest: string;
      receiptRef: string;
    };
  };
  organizationRef: string;
  installationId: string;
  environmentClass: "production" | "development" | "test";
  traceparent?: string;
};
```

The final field names must be generated from or directly mapped to the A2A extension contract. `organizationRef` resolves to canonical Organization identity; no organization name, logo, or contact duplicate is stored here. Environment remains alongside GAID and never becomes part of GAID.

The source-side task/evidence record holds a `participationGraphRef` that resolves to an immutable
versioned projection of `TaskRun` + `TaskNode` + `TaskNodeEdge`, joined to canonical Principal/GAID
and existing receipt/evidence records. A hop is material when an agent originates, delegates, authorizes,
approves, transforms, executes, or publishes part of the interaction. Stable `hopId` and
`parentHopIds` fields preserve fan-out/fan-in; this is not limited to a three-scalar call chain.
Tools, queues, and deterministic infrastructure are not agent hops unless they are independently
governed agent subjects.

Projection is performed once, before signing and serialization, and the resulting object is reused
by CloudEvents, A2A Task/Message/Artifact responses, Agent Cards, receipts, errors, and peer-visible
operational views. Route-local projection logic is forbidden.

For same-org links, `mode="full"` may carry private or federated GAIDs only when the
`ProjectionContract` explicitly allows every field. For cross-org links:

- `mode` must be `boundary-minimized`;
- every disclosed participant GAID must be `gaid:pub` and resolve through a governed
  `PrincipalAlias` boundary mapping for the same canonical Principal;
- undisclosed participants, their count, roles, edges, installation/device IDs, and private GAIDs
  are hidden by default;
- the enrolled boundary installation/device identifiers already disclosed by `FederationLink` may
  remain as transport evidence, but identifiers for other internal installations/devices are hidden;
- public hop identifiers and `visibleParentHopIds` are projection-local and never encode or point
  to a withheld hop;
- `participationMinimized=true` and `commitment` are mandatory when any material hop is hidden;
- a public accountable agent must be named, but the projection must not claim that agent was the
  sole performer;
- failure to resolve a required public alias or create the commitment denies egress.

The source-local `participationGraphRef` is never serialized across the organization boundary.
The commitment is a SHA-256 digest over the RFC 8785 canonical form of the full protected graph,
task/event context, and projection-policy version plus a high-entropy private nonce. The device
signature covers the public projection and commitment. The nonce and protected graph stay in the
source evidence store and are disclosed only through an authorized audit opening. A raw unsalted
hash is forbidden because predictable identifiers would permit dictionary testing. Hidden-hop
count is not disclosed unless the `ProjectionContract` expressly permits it.

### 8.3 CloudEvent carrier

The existing CloudEvents 1.0 envelope adds closed, versioned A2A event types. The minimum set is:

- task/message submission;
- task snapshot/status;
- task input request/additional message;
- task cancel request/result;
- artifact availability or minimized artifact payload;
- Agent Card/AIDoc projection or withdrawal.

Every event includes the A2A request/data object plus `DpfFederatedAgentContextV1`. `source` identifies the originating installation, not the agent. GAID remains in the signed data so the device signature covers it. Event ID is the idempotency key within a link; the receiver-assigned A2A task ID remains authoritative for task state.

### 8.4 Agent Card and AIDoc projection

The `CoworkerIdentity`/Agent Card work under `BI-COWORKER-360-AGENTCARD` is the source projection. Federation adds selection and delivery, not another card builder.

- a link advertises only agents explicitly included by its `ProjectionContract`;
- public/minimal link card does not enumerate internal coworkers;
- authenticated extended cards are projected through the trusted link;
- card `extensions` carry GAID and AIDoc reference/digest;
- card is JWS-signed with the enrolled device key using RFC 8785 canonicalization;
- the AIDoc is signed or otherwise verifiable under the approved GAID issuer binding; a device signature alone is not elevated into issuer authority;
- the receiver verifies the JWS `kid` against the link's pinned device, verifies the AIDoc issuer binding, and stores the minimized card as `FederatedRecordMirror(recordType="agent-card")`;
- withdrawal, GAID status change, card expiry, link quarantine, or key rotation invalidates the binding until refreshed.

No `RemoteAgent`, `PeerAgent`, or `AgentCredential` table is added.

`agent-card` and any device-key/card-withdrawal record types extend the existing `FEDERATED_RECORD_TYPES` registry in `packages/db/src/federated-record-sync.ts`; no route or feature keeps a private string union.

### 8.5 Task persistence and the refactor seam

The existing implementation currently treats `CoworkerEngagement.engagementId` as the A2A task and synthesizes one message/artifact from JSON. The schema already has the richer canonical execution substrate: `TaskRun` has A2A-aligned states and owns `TaskMessage` and `TaskArtifact`. The build therefore consolidates rather than adding a fourth task representation:

- `CoworkerEngagement` remains the accepted service offer, contract, funding, approval, and provider relationship.
- `TaskRun` becomes the canonical A2A task lifecycle and receiver-generated A2A task ID.
- `TaskMessage` and `TaskArtifact` remain the canonical history and result records.
- `TaskNode` and `TaskNodeEdge` remain the canonical execution/contribution topology; S4 adds only
  the minimum agent-Principal/GAID and receipt bindings needed to derive the participation graph.
- `CoworkerEngagement` gains a nullable unique relation to its `TaskRun`; the existing adapter continues to accept engagement IDs during migration but returns the canonical task ID.
- `TaskRun` gains typed/indexed federation ownership, origin event/idempotency, GAID, installation/environment, card/AIDoc digest, protected participation-graph reference, boundary-projection policy/version, commitment, and receipt-reference fields where query or integrity requirements justify them. Security and uniqueness do not depend on querying `a2aMetadata` JSON.

`TaskRun.userId` is currently mandatory, which would tempt a remote GAID to be represented as a fabricated local user. The sound refactor is principal convergence: add `initiatingPrincipalId`, backfill it from each existing user's canonical Principal, make `userId` nullable only after the dual-read/backfill gate, and use the `FederationLink` peer Principal as the transport initiator for federated tasks. The verified acting GAID stays a separate typed claim; the peer-install principal and speaking agent are never collapsed.

At minimum, the receiver can query and index:

- owning `FederationLink` and initiating peer Principal;
- origin event/idempotency key;
- source and target GAIDs;
- source installation/environment;
- current A2A task state and context ID;
- card/AIDoc digest used at acceptance;
- delegation/authority receipt reference.
- protected participation-graph/evidence reference and the exact boundary projection/commitment used for each egress.

Task reads, cancellation, and additional messages authorize against this stored link ownership and GAID context, never against possession of a task ID alone. This consolidation is the planned refactoring allocation for the slice; no cosmetic refactor displaces it.

### 8.6 Enterprise scale and topology privacy

The participation graph is a bounded contract, not an unbounded metadata bag:

- graph nodes, edges, depth, serialized bytes, and public participant count have versioned limits;
  over-limit work is rejected or split into linked tasks before federation egress
- hop and receipt identifiers are stable within the task but are not metric labels
- repeated status/artifact events reference an immutable graph version and commitment rather than
  retransmitting the full protected graph
- material graph changes create a new immutable version, commitment, and receipt; prior evidence is
  never overwritten
- each sovereign install stores its own protected graph and can operate without a global online
  resolver on the task hot path; public GAID/AIDoc status is cached under bounded freshness rules
- an organization does not have to publish a GAID for every internal helper; only agents exposed as
  externally accountable participants require public boundary mappings
- retry, fan-out, fan-in, partial failure, cancellation, and revocation preserve parent receipt and
  graph-version links without copying another organization's protected topology

This keeps external evidence size predictable while preserving full source-side accountability for
large enterprises with many internal agents and installations.

## 9. Ingress verification and authorization

The receiver processes every cross-install A2A request in this fixed order:

1. Require HTTPS and resolve the bearer token to one trusted, non-quarantined, non-revoked `FederationLink`.
2. Require the link to be A2A-ready with a pinned peer device key.
3. Verify RFC 9421 signature parameters, algorithm, key ID, covered method/target/authority/content digest/federation headers, creation/expiry, and nonce.
4. Verify `Content-Digest` before parsing the CloudEvent body.
5. Validate CloudEvents 1.0, time window, event ID uniqueness, event type, payload size, and closed contract version.
6. Derive the authoritative organization/environment from the link and its explicit `organization-crosswalk`; require body claims to match, never use them as authority.
7. Require the event's installation ID and device key ID to match the link's approved peer projection.
8. Validate each disclosed GAID syntactically and for the relationship scope; cross-org payloads may contain only approved `gaid:pub` aliases. Verify its issuer prefix against the link's approved AuthorityBinding; then require the acting/delegating GAIDs to match a current, non-withdrawn, device-signed Agent Card and issuer-verifiable AIDoc mirror on this link.
9. Resolve the target GAID locally through `PrincipalAlias`; reject unknown, disabled, revoked, or non-federation-eligible targets.
10. Evaluate source delegation, target service offer, effective TAK grants, authority band, projection contract, relationship preset, data classification, rate/size/concurrency limits, and any human consent gate.
11. Create or idempotently return the receiver-owned task and persist a verification receipt containing link, device, installation, GAIDs, organization/environment, card/AIDoc digests, event ID, decision, and trace context.

Any failure is deny-by-default. Error responses reveal the minimum necessary category and correlation ID, not internal agent existence, policies, prompts, or grant details.

Every outbound response follows a corresponding fixed egress order: load the protected graph and
current relationship → evaluate `ProjectionContract` → resolve public boundary aliases where
required → build the boundary view → create and persist the nonce-hiding commitment when material
hops are withheld → scan every output surface for private identifiers → sign → serialize → send.
Projection failure occurs before signing or outbox persistence as a deliverable event.

### 9.1 Sender authority is an attestation, not a grant

The peer device signature means “this enrolled installation attests that GAID X sent this request.” It does not mean the receiving install trusts every action by X. The receiver is sovereign and always applies its own local authority. A remote Agent Card is discoverability/evidence, not executable permission.

### 9.2 Delegation semantics

- `actingAgentGaid` is the agent presently issuing the request.
- `delegatingAgentGaid` is the accountable upstream agent that delegated this hop; it equals acting GAID when there is no upstream delegation.
- `targetAgentGaid` is the intended receiver and must resolve locally.
- the source-side protected participation graph preserves every material hop's installation,
  device evidence, GAID, role, edges, and receipt;
- a peer may not collapse its custody record to the last speaker, but it must apply the GAID
  boundary projection before disclosure; complete custody does not imply complete peer visibility;
- the public view names the externally accountable public GAID(s), marks minimized participation,
  and carries the signed commitment without implying that a boundary agent performed all hidden work;
- a link may forward only if its projection/authority contract allows forwarding and loop/hop guards pass.

## 10. A2A operation and lifecycle mapping

DPF adopts the A2A v1.0 task lifecycle as the cross-install contract and maps it to canonical local task/engagement state. The adapter, not the database enum, owns wire-version translation.

| A2A concept | DPF canonical behavior |
| --- | --- |
| Agent Card | projection from canonical CoworkerIdentity/AIDoc, minimized per link, JWS-signed by peer device, with separately verified issuer-bound AIDoc |
| Send Message | create/idempotently continue a receiver-owned engagement/task after all trust and authority checks |
| Task ID | `TaskRun.taskRunId`, generated by receiver; opaque to sender; stored with owning link |
| `submitted` / `working` | accepted / active local work; exact local statuses remain canonical |
| `input-required` | local attention/elicitation boundary; no implied authorization |
| `auth-required` | request for a separate, explicit authorization decision; never an implicit grant |
| `completed` / `failed` / `canceled` / `rejected` | terminal state mapped without reopening terminal tasks |
| Message | canonical `TaskMessage`; conversational or instructional input/status, not final output |
| Artifact | canonical `TaskArtifact`; minimized task output with classification, digest, media type, and custody receipt |
| Get/List/Cancel | always scoped to the authenticated link and agent context; cursor pagination for list |
| Streaming/push | deferred from first slice; durable polling and federated status events are sufficient |

The first slice must implement the standard core operations needed for a non-streaming HTTP+JSON collaboration path. If any core operation is intentionally not implemented, the surface must be labeled “A2A-shaped DPF federation profile,” not “A2A compliant.”

## 11. Privacy and relationship policy

### 11.1 Same organization — first target

Same-organization does not mean unrestricted. The link may project:

- GAID, display name, concise role/description, AIDoc status/digest;
- explicitly federatable skills and service offers;
- endpoint/interface metadata for the federation adapter;
- task messages and artifacts allowed by the task's data boundary;
- organization reference, installation ID, and environment class.

It must not project raw prompts, private memory, hidden instructions, unrestricted tool manifests, secrets, internal model routing, unrelated customer data, or full authority configuration.

Same-org full participation disclosure is allowed only when the link's `ProjectionContract`
explicitly permits the private/federated GAID fields and topology. Otherwise the same boundary
projection machinery produces a minimized view; “same organization” is not a bypass.

Production-to-development traffic is visually and programmatically distinct. A development agent cannot act in production merely because both installations share an organization. The production receiver's local policy is authoritative, and consequential or irreversible actions retain their existing human-approval boundaries.

### 11.2 Cross organization — deny by default

Cross-org A2A remains disabled unless a future slice adds all of:

- explicit A2A capability in the `ProjectionContract`;
- named GAID/service-offer allowlists;
- approved cross-org authority band and data-processing/retention terms;
- public or otherwise boundary-conformant GAID/AIDoc assurance;
- authenticated extended-card disclosure policy;
- public GAID boundary mappings for every externally named agent and a required GAID A2A boundary
  extension negotiated by both peers;
- full protected participation custody plus signed, nonce-hiding commitments for every minimized
  response, artifact, receipt, and task-history view;
- artifact classification and egress tests;
- local human approval for every consequential action unless a narrower standing authority is explicitly granted.

The existing demand cross-org rules are the floor, not an alternate policy. Confidential/restricted and customer-domain material does not cross simply because the A2A task requests it.

Cross-org egress is denied if any private GAID, internal Principal ID, hidden hop/edge, internal
installation/device identifier, or source-local evidence reference remains after projection. This
applies to ordinary payloads and to less obvious side channels: errors, task history, artifact
metadata, Agent Cards, receipts, traces, logs exported to the peer, and operator downloads.

## 12. Operator experience

The design adds evidence to existing surfaces; it does not create an A2A administration island.

### 12.1 Federation link detail

Show one compact “Agent coordination” section:

- readiness: Off / Needs device confirmation / Ready / Quarantined;
- peer install name, `inst_…`, short `did_…`, organization, and environment as separate fields;
- last successful signed request and last verification failure;
- count of projected eligible agents and card-expiry/withdrawal state;
- projection contract and authority band links;
- explicit action to approve initial device pin or key rotation.

Never display GAID as a substitute for install or environment. The hierarchy in every provenance treatment is `organization → environment/install → agent GAID`.

### 12.2 Coworker discovery and task initiation

Remote coworkers appear in the existing coworker/service catalog with a peer badge, organization, environment, verified-card state, last refresh, offered outcome, and data boundary. The primary action states its consequence, for example “Ask development / Research coworker,” not an opaque “Connect” button.

Before dispatch, the confirmation summarizes:

- source and target agents;
- source and target installations/environments;
- requested outcome and data classes crossing;
- whether the task can make changes or only advise;
- the approval boundary and retention policy.

### 12.3 Task timeline

The existing engagement/task surface shows messages, state changes, artifacts, and receipts in one timeline. Each cross-install event carries a readable provenance chip with accessible text, not color alone. Technical identifiers sit behind disclosure. Verification failure states explain the next safe operator action without exposing secrets.

Authorized source-side operators can inspect the complete participation graph. Peer-facing and
ordinary external-client views show the public accountable agents, “internal participation
protected” status, commitment verification state, and audit-request path. They never show private
GAIDs or a hidden-hop count by default. The interface must not imply that a public boundary agent
was the sole performer when participation was minimized.

All implementation uses shared UI primitives and `--dpf-*` theme tokens. Keyboard access, semantic headings, focus order, text alternatives, narrow layouts, light/dark themes, and reduced-motion behavior are acceptance criteria.

## 13. Failure, threat, and recovery model

| Failure or abuse | Required response |
| --- | --- |
| stolen link token without device key | reject signature; audit and rate-limit; offer link quarantine |
| valid device signature claims unprojected GAID | reject as `agent-binding-unverified` |
| stale/revoked Agent Card or AIDoc | reject new work; preserve old receipts; require refresh |
| replayed event/signature | reject nonce/event ID/time; return idempotent prior result only for exact accepted duplicate |
| source installation/device mismatch | quarantine-worthy verification failure; never fallback to token-only |
| guessed task ID from another link | return non-enumerating not-found/forbidden result; do not leak state |
| link revoked/quarantined mid-task | reject new messages; freeze remote authority; local owner decides cancel/finish |
| device key rotation | dual-approved re-pin; invalidate old signature key at cutover; each immutable receipt snapshots the verified key/fingerprint so historic evidence remains independently checkable |
| GAID continuity/mint collision | block federation advertisement; resolve through canonical issuer/alias migration |
| cross-org payload exceeds projection | reject before task creation; log minimized violation metadata |
| private GAID/topology appears in cross-org egress | reject before signing/outbox persistence; record field-class violation without the leaked value |
| required public boundary mapping missing | deny egress; do not substitute or expose the private GAID |
| protected graph changed after public commitment | create a new immutable graph version, commitment, and receipt; never overwrite the prior evidence |
| commitment cannot be opened during authorized audit | treat as evidence-integrity failure; quarantine affected evidence and investigate signer/storage state |
| peer asks for consequential action | route through local authority/consent gate; remote assertion cannot approve it |
| task/status delivery outage | durable outbox retry with backoff/dead-letter; polling recovers current task snapshot |

## 14. Observability and evidence

Metrics and logs are keyed by non-secret identifiers and bounded labels:

- A2A requests accepted/rejected by link and reason category;
- signature/card/AIDoc verification latency and failures;
- task counts and terminal outcomes by relationship/environment, not unbounded GAID label values;
- outbox attempts, dead letters, replay rejects, rate-limit events;
- card projection age and withdrawal/key-rotation lag.

Distributed traces preserve W3C `traceparent` across federation while each install controls its own detailed spans. Audit receipts persist exact GAIDs and digests in governed records, not metric labels. Logs never contain bearer tokens, private keys, raw prompts, or unminimized artifacts.

Cross-org metrics distinguish full versus minimized projection and commitment verification using
bounded labels. They never label by GAID, hidden-hop count, graph topology, or source-local graph
reference. Authorized audit opening is itself a consequential, receipted event.

## 15. Migration and compatibility

1. Add peer device fields and nullable task ownership fields with forward-only migrations and backfills that tolerate every existing state.
2. Promote the existing federation environment class from link metadata to the canonical typed link field and migrate all readers/writers.
3. Principal-converge `TaskRun` initiation, link it to `CoworkerEngagement`, and dual-read the legacy engagement-backed task shape until backfill is proven.
4. Existing links remain demand-capable but are A2A-disabled until their device key and GAID issuer binding are confirmed.
5. Backfill/replace nonconformant `gaid:priv:dpf.internal:*` advertisements through the canonical alias migration; do not silently rename task history.
6. Produce standard Agent Cards from the canonical coworker identity projection and mirror them per link.
7. Put cross-install submission/retrieval behind federation ingress; preserve internal `/api/a2a/*` callers through the shared service layer.
8. Never share or reuse the current local HMAC receipt secret across installations. Federated receipts use device-verifiable evidence; historic local receipts remain locally valid.
9. Rollout is capability-negotiated per link and can be disabled without affecting federated demand.
10. Replace the scalar acting/delegating/delegated metadata seam with a versioned protected
    participation graph in the existing task/evidence substrate; dual-read legacy scalar records
    until their graph projection is backfilled or explicitly classified as legacy-incomplete.
11. Cross-org enablement remains blocked until public alias mapping, public-card projection,
    commitment creation/opening, and whole-response private-identifier scanning are proven.

## 16. Acceptance criteria

### 16.1 Trust and identity

- A trusted link without a pinned device key cannot accept A2A.
- A valid link token plus invalid/missing signature is rejected.
- A valid device signature plus unprojected, expired, withdrawn, malformed, or wrong-link GAID is rejected.
- the receiver can prove link, device, installation, organization, environment, acting/delegating/target GAIDs, card/AIDoc digests, and decision receipt for every accepted task.
- the source can prove every materially participating agent and parent relationship in the
  protected participation graph without requiring the peer to possess private identities;
- no new agent identity or credential store exists.

### 16.2 Authority and privacy

- only an explicitly projected service offer can be invoked;
- all task operations bind to the same authenticated link/agent context;
- local TAK/delegation and data boundary decide acceptance;
- same-org prod/dev is the only enabled relationship preset;
- cross-org A2A is negative-tested and denied;
- forbidden fields and classified artifacts cannot escape through messages, artifacts, errors, or cards.
- a cross-org fixture containing five internal agents emits only approved `gaid:pub` participants,
  `participationMinimized=true`, and a signed commitment; no private GAID, hidden hop/edge,
  internal Principal/install/device ID, or graph reference appears anywhere in the peer response;
- the commitment opens against the retained source graph for an authorized auditor, and any graph,
  task-context, policy-version, or nonce mutation fails verification;
- missing public mapping, unsalted commitment, projection failure, or legacy scalar-only custody
  denies cross-org egress;

### 16.3 Protocol behavior

- Agent Cards validate against the pinned A2A version and signatures verify after RFC 8785 canonicalization;
- task creation is idempotent, receiver-owned, and lifecycle transitions are valid;
- get/list/cancel/additional-message operations cannot cross link ownership;
- adapter mappings preserve standard messages versus artifacts and terminal semantics;
- unsupported A2A versions/extensions fail explicitly.

### 16.4 UX and operations

- an operator can distinguish organization, environment/install, device trust, and GAID without opening raw JSON;
- readiness, rotation, quarantine, and verification failure have clear safe next actions;
- the dispatch confirmation states outcome, data boundary, and authority consequence;
- task provenance is accessible, theme-aware, responsive, and keyboard operable;
- source operators can inspect complete custody while peer/external views show only public
  accountable identities, protected-participation status, and commitment verification;
- demand federation continues to work when A2A is disabled or fails.

## 17. Documentation impact

The build must update:

- GAID implementation/conformance notes for issuer namespace and federation binding;
- federation architecture and operator pairing/key-rotation guidance;
- A2A endpoint and extension-profile documentation;
- coworker/service-catalog help for remote-agent provenance;
- platform support watchlist if any host-specific crypto/key-store behavior is discovered;
- the generated route map if federation endpoints change.

## 18. Architectural invariants for review

1. `Principal` + `PrincipalAlias` remains the only canonical agent identity spine.
2. `FederationLink` remains the only sovereign-peer trust relationship.
3. Ed25519 device identity authenticates the install; it does not become a second GAID issuer.
4. GAID identifies the agent; it does not encode organization, installation, or environment.
5. `ProjectionContract` and `FederatedRecordMirror` remain the only cross-link disclosure/mirror substrate.
6. TAK and local delegation remain the final authority; cards and signatures are evidence, not grants.
7. A2A supplies interoperable discovery/task semantics; MCP remains the tool plane.
8. Cross-install A2A has no public or unauthenticated shortcut.
9. Cross-org is deny-by-default and cannot inherit same-org readiness.
10. No claim of A2A conformance is made unless the exposed binding implements the standard's required operations and semantics.
11. Complete custody and external disclosure are separate views: a requirement to preserve every
    hop never authorizes disclosure of every hop.
12. Cross-org identity projection uses governed GAID public aliases plus `ProjectionContract`; no
    NAT-style ephemeral identifier, route-local redactor, or second identity table is allowed.
13. The signed participation commitment binds minimized external evidence to the protected graph
    without revealing private identifiers or topology.

## 19. Architecture review (advisory)

**Alignment summary:** aligned after concrete substrate-convergence edits; no critical concern remains.

The `dpf-architecture-review` pass produced four important findings, all folded into this specification:

1. **Environment had an existing source.** The draft proposed a new five-value environment union while federation demand already owns `production | development | test` in `FOUNDER_DEMAND_ENVIRONMENTS` and persists it in link metadata. The spec now reuses that vocabulary and promotes the security-relevant value to a typed `FederationLink` field rather than adding another registry.
2. **Device attestation is not GAID issuer authority.** The draft could be read as treating a device-signed Agent Card as sufficient GAID proof. The spec now requires both the pinned device signature and a link-approved GAID issuer/AIDoc binding.
3. **The task substrate was ambiguous.** `CoworkerEngagement`, `TaskRun`, `TaskMessage`, and `TaskArtifact` already divide service acceptance from execution history. The spec now names that split and refactors the partial engagement-only A2A adapter onto it instead of creating A2A task/message tables.
4. **Organization claims cannot be self-asserted.** The spec now derives organization/environment from `FederationLink` and the explicit `organization-crosswalk`, treating matching body fields as signed evidence but never as authority.

The enterprise identity-boundary amendment added five reviewed findings:

5. **Custody is not disclosure.** The former “preserve every hop” wording was valid for the source
   evidence store but unsafe as a wire rule. The spec now preserves the full graph locally and
   derives the external view through `ProjectionContract`.
6. **A scalar call chain is not enterprise lineage.** The current acting/delegating/delegated
   fields cannot represent parallel contribution, approval, fan-out, or fan-in. The protected
   participation view is derived from canonical `TaskRun`/`TaskNode`/`TaskNodeEdge` plus receipts;
   no A2A-only graph or task table is added.
7. **Public aliases remain one subject.** Private and public GAIDs resolve through
   `PrincipalAlias` to the same Principal. No ephemeral NAT identifier or per-peer agent identity
   is introduced.
8. **Minimization remains auditable.** A signed, nonce-hiding commitment binds the public response
   to the source graph. A public boundary agent is accountable, but the response explicitly avoids
   the false claim that it was the sole performer.
9. **Projection is one pre-signing service.** Cards, events, tasks, artifacts, receipts, errors,
   and peer-visible operations views consume the same derived boundary object. Route-local
   redaction would violate canonical-contract and single-source-of-truth requirements.

Standards checked: A2A v1.0 core, enterprise guidance, multi-tenancy and extension model; MCP
2025-11-25 Tasks and 2026-07-28 release-candidate direction; CloudEvents 1.0; RFC 9421; RFC 9530;
and RFC 8785. A2A supplies the extension and authorization mechanisms but does not normatively
define agent-subject identity, private/public boundary mapping, participant topology disclosure,
or a minimized-lineage commitment. That is a real enterprise profile gap, so the normative GAID
reference was amended in the same branch and this A2A design now maps to it.

`DI-6FE234A7399E` selected the dual-view commitment model with high confidence (composite `10.673`,
margin `3.698`, no commandment conflict). This does not enable cross-org A2A in the current release;
it defines the contract that the same-org implementation must be capable of enforcing and that a
future cross-org activation must prove.

The implementation-scope review supersedes the former atomic build shape while preserving the single same-org product outcome. `DI-61395D1B7A6D` selected decomposed convergence with high confidence (composite `15.417`, margin `11.220`, no commandment conflict): six feature-gated sibling BIs now own GAID conformance, device signing, signed-card discovery, canonical task ingress, policy/evidence, and operator readiness. The plan's parity preflight coordinates those local records with the A2A-adoption install without making backlog synchronization part of A2A or creating multi-writer authority. Cross-org enablement remains a separate future slice.
