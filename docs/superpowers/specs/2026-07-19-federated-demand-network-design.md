# Federated Demand Network Design

| Field | Value |
| --- | --- |
| Status | Draft for founder review |
| Date | 2026-07-19 |
| Backlog item | `BI-E3A084ED` |
| Owning epic | `EP-DELIVERY-FLOW` |
| Related epics | `EP-5410E8EA` (forge-neutral integration), `EP-WORK-CONVERGENCE` (work coordination), proposed `EP-PARTNER-CHANNEL` and `EP-MSP-FEDERATION` |
| Decision audit | `DI-B5CEB8CFBBED` — selective hybrid, high confidence |
| Founder network authority | Arcamanus master shared portfolio |

## 1. Executive decision

DPF should create a **federated demand network**: sovereign installations connected by directed, consented relationships that exchange minimized demand projections, not database rows.

The network uses three connection paths behind one protocol:

1. **Nearby internal installations** announce themselves with DNS-Based Service Discovery (DNS-SD) on the local network. Discovery produces a setup suggestion, never trust. One operator-approved pairing establishes a `same-organization` relationship; a standing projection policy then keeps approved platform intent synchronized automatically.
2. **Reseller and customer installations** establish an invitation-based, dual-approved relationship. The customer remains authoritative for its backlog and chooses what the reseller may see. The reseller can curate, combine, respond to, and selectively forward demand.
3. **Reseller and Arcamanus installations** use the same relationship protocol with a different policy. Arcamanus is the commercial/channel hub for reseller relationships and the governance authority for the shared code base. Its master **shared** portfolio contains Arcamanus-owned work and demand that another party separately elects to share; it does not ingest reseller/customer backlogs through code contribution.

Hive Mind carries governed contribution results into Git/GitHub: commits, specifications, tests, evidence, provenance, and review state. GitHub remains the public delivery and contribution mirror. Neither Hive Mind nor GitHub is the cross-install backlog database, and submitting code does not disclose the contributor's backlog.

The architecture is a relationship graph rather than a fixed three-level tree. That supports the two Arcamanus development installations now, a reseller with many customers, a distributor with resellers, customers with more than one specialist partner, future community peers, and disconnected/offline operation without redesigning the transport.

## 2. Problem and outcome

Every DPF installation has a useful local PostgreSQL backlog. That sovereignty becomes fragmentation when two installations within one company, a reseller and its customers, or a reseller and the founder need to coordinate. Specifications committed through GitHub currently provide accidental visibility, but they omit live status, demand reach, offers to help, local-only intent, and upstream disposition.

The required outcome is:

> A non-technical operator can connect the right DPF installations in a few guided actions; each installation remains authoritative for its local work; approved shared intent flows reliably with provenance, privacy, and revocation; Arcamanus manages the reseller network and shared code governance; and code contributions reveal results rather than the contributor's backlog.

### 2.1 Success measures

- Two DPF installations on the same LAN appear as nearby candidates without entering an IP address.
- Pairing requires an authorized human and shows an explicit “what will be shared” preview.
- After pairing, new eligible internal demand is visible on the peer within five minutes when both are online, with eventual reconciliation after an outage.
- A customer can share one item or enable a category policy with its reseller without exposing excluded fields or unrelated items.
- A reseller can forward a sanitized demand envelope to Arcamanus while preserving the originating customer's chosen attribution or pseudonymity.
- Arcamanus counts one underlying demand signal once even if it traverses customer → reseller → founder.
- A reseller/customer can contribute a completed change through Hive Mind without sending its local backlog item, priority, estimate, discussion, or unselected roadmap.
- Disconnecting a relationship stops new exchange immediately, invalidates credentials, and makes retention/deletion status visible on both sides.
- Local work continues when every peer and relay is unavailable.

## 3. Principles and boundaries

1. **Local backlog authority.** `BacklogItem` and its local lifecycle never become multi-writer records. A receiving installation stores a governed mirror or adopts the intent into a new local item with provenance.
2. **Discovery is not trust.** Network proximity, a matching friendly name, or a matching organization claim grants no authority.
3. **Consent becomes policy.** Humans approve the relationship and readable policy once; routine eligible synchronization is then automatic until the policy changes or the link is revoked.
4. **Minimum necessary.** Only an allow-listed projection crosses a link. Raw backlog rows, discussions, secrets, customer identifiers, attachments, and internal estimates stay local unless separately authorized.
5. **Topology-neutral protocol.** Internal, customer/reseller, reseller/founder, distributor/reseller, and peer/community patterns share one envelope and delivery contract. Relationship presets change policy, not transport.
6. **Provenance over copying.** Every envelope retains origin, route, version, and payload digest. Intermediaries add attestations; they do not impersonate the origin.
7. **Network tolerant.** Outbox, idempotency, retry, acknowledgment, and periodic reconciliation are mandatory. Synchronous peer availability is never required to file local work.
8. **GitHub after portfolio acceptance.** GitHub Issues/Projects may expose accepted public work and PR delivery, but must not become the write authority for installations or customer/reseller relationships.
9. **Contribution is not backlog synchronization.** Hive Mind receives a governed result bundle. Any related demand signal requires a separate projection decision and remains independently revocable.

### 3.1 Explicit non-goals

- Replicating PostgreSQL databases or making one installation a primary for another.
- Automatically trusting every DPF found on a network.
- Publishing customer backlog titles over multicast DNS.
- Giving Arcamanus or a reseller general administrative access to customer installations.
- Implementing the full ActivityPub social-network stack or JSON-LD vocabulary.
- Resolving source-code merge coordination; the forge-neutral and Work Capsule designs own that concern.

## 4. Business topology: a directed relationship graph

An installation is a sovereign network node. A `FederationLink` is a directed local view of an approved business relationship. A link receives a **relationship preset** that initializes a `ProjectionContract`; operators can narrow it but cannot expand beyond their authority.

| Relationship preset | Typical parties | Default exchange | Authority posture |
| --- | --- | --- | --- |
| `same-organization` | Arcamanus Mac ↔ Arcamanus Windows; future internal nodes | Shared platform demand, disposition, claims, release notices | High collaboration, still explicit pairing and field allow-list |
| `service-provider` | MSP/reseller ↔ sovereign customer | Customer-approved demand, support response, proposals, release applicability | Customer controls egress; no standing execute authority |
| `channel` | Customer ↔ reseller, reseller ↔ distributor, or reseller ↔ Arcamanus | Curated/pseudonymous demand upstream; catalog, disposition, and release notices downstream | Each party approves its own projection |
| `community-peer` | Independent installations or industry group | Explicitly selected proposals and release knowledge | Lowest default scope; no implied management |

The local role remains directional (`manages`, `managed-by`, `channel-upstream`, `channel-downstream`, `same-org-peer`, `community-peer`). The relationship preset and local role are separate because a reseller can be upstream relative to a customer and downstream relative to Arcamanus. Each installation owns its outbound `ProjectionContract`; trust requires both parties to exchange and acknowledge the two contract summaries. These values become closed, application-typed string registries when implemented.

### 4.1 Arcamanus authority

Arcamanus is the **founder business, portfolio, and code-governance authority**:

- It is the business system of record for reseller enrollment, agreements, channel standing, shared offerings, contribution recognition, and founder/reseller coordination.
- It governs the common code base: contribution policy, provenance, DCO, automated evidence, review, acceptance, release, and mapping accepted results to GitHub delivery.
- It owns cluster decisions and shared-portfolio disposition only for Arcamanus-originated demand and demand envelopes another party explicitly shares through the demand channel.
- It does not own a customer's or reseller's local backlog status, priority, private rationale, or implementation commitments.
- A Hive Mind code contribution contains the submitted result and evidence, not the originating backlog record. Arcamanus may know the contributing organization/pseudonym and contribution purpose without seeing its internal planning context.
- Exactly one installation is designated `founder-portfolio-authority` for an environment. Other Arcamanus installations mirror or adopt from it; they do not co-write its portfolio and there is no database leader election.
- Every link declares an environment class (`production`, `development`, or `test`). Development/test demand is visually marked and does not enter the production master shared portfolio unless an authorized operator explicitly promotes it.
- A future hosted Arcamanus directory/relay may improve reachability. Local operation and direct links must not depend on it.

### 4.2 Channel value and commercial seams

The relationship model reinforces the reseller business rather than bypassing it:

- Customers obtain a nearby trusted advisor and can request help on a shared item.
- Resellers see demand across only their authorized customer estate, identify reusable patterns, contribute expertise, and decide which signals merit upstream escalation.
- Arcamanus receives governed code results through Hive Mind and, separately, higher-quality curated demand when a reseller chooses to share it.
- Downstream disposition and release-applicability notices let resellers proactively serve affected customers.
- Future paid capabilities can include reseller fleet health, private solution catalogs, co-funding, delegated support workflows, contribution credit, and aggregated privacy-safe benchmarks. None require changing the federation protocol.

Multi-partner support is intentional: a customer can link to different partners for different projection scopes. A relationship never implies exclusivity.

## 5. Zero-expertise connection experience

The portal exposes one **Connections** experience with two entry paths.

### 5.1 Nearby discovery

When the portal HTTP endpoint is healthy, an installation advertises:

```text
Service type: _dpf-federation._tcp.local.
Instance:     <friendly-install-name>._dpf-federation._tcp.local.
Host:         <installation-uuid>.local.
Port:         <portal HTTPS port>
TXT:          protocol=1, install=<ephemeral-discovery-id>, caps=<digest>, pair=/connect/pair
```

TXT records contain no backlog, organization name or fingerprint, stable network identity, email, hostname-derived identifier, token, or customer data. The discovery ID rotates and is bound to the installation's stable identity only inside the authenticated pairing transcript. The portal continuously browses for candidates and shows “DPF found nearby.” An operator chooses a candidate and answers one plain-language question: **“Is this another DPF owned by your organization?”**

DNS-SD/mDNS is link-local. Routed enterprise networks may later expose the same service using a DNS-SD Discovery Proxy or authenticated Service Registration Protocol. Internet, reseller, and cross-VLAN setup always has an invitation/QR fallback.

### 5.2 Invitation and pairing

The inviter selects a relationship preset and receives:

- a QR code/deep link carrying a high-entropy, single-use bootstrap reference;
- a short verification code displayed on both installations;
- an expiration time; and
- a readable projection summary.

The accepting operator signs in locally, confirms the parties, environment classes, and matching code, reviews both outbound summaries under “what each side shares,” and approves. Both Authority Cores record approval before the link becomes trusted. One person may complete both approvals when they are independently authorized on both internal installations; the two audit entries remain distinct. The UX follows the device-authorization precedent: QR for convenience, a human-readable code for device-binding confirmation, explicit approve/deny, short expiry, throttling, and one-time use.

Do not treat the short code as a bearer secret. The implementation must either use the high-entropy bootstrap channel protected by TLS or a reviewed PAKE such as SPAKE2+ when a low-entropy code participates in key establishment. DPF must not invent pairing cryptography.

### 5.3 Automatic after approval

For `same-organization`, the default contract offers continuous sync of share-safe platform demand and dispositions. Automatic means:

- newly eligible records enqueue without another click;
- link health and last reconciliation are visible;
- scope expansion always requires new approval;
- changes that reduce scope apply immediately; and
- the operator can pause or revoke from either installation.

Discovery alone never starts data exchange. This preserves zero-trust behavior while making normal operation effectively hands-off.

## 6. Demand exchange contract

DPF exchanges a versioned **Demand Envelope**, not a `BacklogItem` serialization.

```ts
type DemandEnvelopeV1 = {
  specVersion: "dpf.demand/1";
  envelopeId: string;              // stable at the source
  originInstallationId: string;    // pseudonymous network identity
  originRecordRef: string;         // opaque source-local reference
  originVersion: number;
  route: Array<{
    installationId: string;
    relationshipKind: string;
    receivedAt: string;
    attestationDigest: string;
  }>;
  audience: "internal" | "partner" | "founder" | "community";
  title: string;
  summary: string;
  workType?: string;
  applicability?: {
    product?: string;
    capabilityRefs?: string[];
    archetypeRefs?: string[];
    platformRange?: string;
  };
  evidence?: Array<{ kind: string; digest: string; safeRef?: string }>;
  signal: { occurrenceCount: number; affectedOrganizations?: number };
  attribution: "named" | "organization" | "pseudonymous" | "anonymous";
  createdAt: string;
  updatedAt: string;
  payloadDigest: string;
};
```

Field presence is the intersection of the envelope schema, source `ProjectionContract`, relationship policy, caller authority, and audience. `affectedOrganizations` is computed by an authorized aggregator and never exposes the underlying organizations.

### 6.1 Activities and lifecycle

Transport messages use a CloudEvents-compatible outer envelope and a small DPF activity vocabulary:

- `dpf.demand.proposed`
- `dpf.demand.updated`
- `dpf.demand.withdrawn`
- `dpf.demand.interest-recorded`
- `dpf.demand.help-offered`
- `dpf.demand.adopted`
- `dpf.demand.dispositioned`
- `dpf.release.applicability-published`

The inbox/outbox and activity semantics borrow the proven ActivityPub model, but DPF keeps its own compact JSON schema, authorization rules, and private federation endpoints.

Updates are source-versioned. The receiver applies a message only when `(originInstallationId, envelopeId, originVersion)` advances. Withdrawal stops future use and applies the negotiated retention policy; it does not rewrite an audit ledger.

### 6.2 Receiving choices

A received envelope can be:

- **Observed** — visible as network demand, no local backlog item.
- **Followed** — the installation requests updates or records interest.
- **Adopted** — a new local `BacklogItem` is created with immutable origin provenance.
- **Clustered** — an authorized portfolio coordinator relates it to other envelopes.
- **Forwarded** — a minimized derivative is sent on another approved link with the original route and a new intermediary attestation.

No remote party directly changes a local backlog item's status, priority, estimate, or build state.

### 6.3 Three independent channels

The Arcamanus relationship supports three independently authorized channels. Enabling one never enables another.

| Channel | What Arcamanus receives | What remains local |
| --- | --- | --- |
| **Business/channel** | Reseller identity, relationship status, agreements/entitlements, shared catalog, support/escalation routing, contribution recognition | Reseller operations, customer commercial detail outside the agreement, internal planning |
| **Demand sharing** | Only an explicitly projected `DemandEnvelopeV1`, normally curated or aggregated by the reseller | Raw backlog row, unshared roadmap, priority, estimates, discussions, attachments, customer identity beyond chosen attribution |
| **Hive Mind contribution** | Git commit/patch or PR, specification as applicable, tests, verification evidence, dependency and security evidence, DCO/provenance, licenses/attribution, reviewer questions and disposition | Originating backlog/work capsule, competing options not submitted, local priority and estimate, customer context not required to evaluate the result |

The contribution result may carry an opaque source receipt so the originating installation can reconcile acceptance or release status. That receipt is not a dereferenceable backlog identifier. If the contributor also wants Arcamanus to understand broader demand or affected-customer reach, it publishes a separate demand envelope under its demand projection contract.

## 7. System architecture

```text
 Local Backlog / Delivery Flow
          |
          | eligible projection
          v
 ProjectionContract + redaction guard
          |
          v
 Durable Federation Outbox ---- retry/reconcile ----> Peer Federation Inbox
          |                                                |
          | signed CloudEvent                              | verify link + scope
          v                                                v
 FederationLink identity                         FederatedRecordMirror
                                                           |
                                               observe/adopt/cluster/respond
                                                           v
                                                  Local Delivery Flow
```

The business/channel and Hive Mind contribution paths are parallel adapters on the approved relationship; they do not pass through the Demand Envelope pipeline. This prevents a code submission from implicitly creating a demand mirror.

### 7.1 Existing substrate to extend

| Existing substrate | Use |
| --- | --- |
| `FederationLink` | Peer identity, dual approval, token rotation, quarantine, revocation, relationship role |
| `FederationBootstrapToken` | Single-use invitation and enrollment |
| `ProjectionContract` | Allow-listed slices/fields, exclusions, retention, negative-egress evidence |
| `FederatedRecordMirror` | Store minimized `recordType="demand-envelope"` projections and version/sync status |
| `HiveContributionLedger` | Immutable audit of founder/community contribution and curation state |
| `BacklogItem` / Delivery Flow | Local canonical demand and adopted work |
| GitHub issue bridge and forge adapter | Public delivery mirror only after acceptance |

Phase 1 should add no second federation identity or approval stack. Before adding dedicated demand tables, implementation must prove that `FederatedRecordMirror` plus its metadata cannot satisfy the required query and integrity needs.

### 7.2 Required additive concepts

The likely minimum additions are:

- relationship preset and protocol/capability negotiation metadata on `FederationLink`;
- a durable federation outbox/inbox receipt with idempotency, retry schedule, payload digest, acknowledgment, and dead-letter state;
- projection-policy templates keyed by relationship preset;
- source/adoption provenance on a local backlog item or a generic provenance relation;
- a founder/reseller demand-cluster read model only when cross-source clustering is implemented.

The outbox should compose with `BI-C9EF928C`'s durable operation/outbox work where possible. It must not overload the GitHub operation queue with peer-protocol semantics.

### 7.3 Delivery and reconciliation

- Direct links use authenticated HTTPS and the existing rotating `dpflink_*` credential lifecycle.
- Every message has an event ID, source identity, subject, time, schema version, data digest, and signature/MAC bound to the link.
- Receivers persist the inbox receipt before applying side effects and return an acknowledgment.
- Senders use bounded exponential backoff with jitter and a visible dead-letter state.
- A scheduled digest exchange detects missing or divergent versions and requests only the necessary envelopes.
- Forwarders reject routes containing their own stable installation identity and enforce a bounded hop count. A seen-origin/event cache prevents loops through reseller, direct, and multi-partner paths.
- Large evidence stays source-side. The envelope carries safe references/digests and uses a separately authorized fetch when required.
- Relay delivery is store-and-forward only. A relay cannot expand scope, rewrite origin, or become backlog authority.

## 8. Arcamanus master shared portfolio

Arcamanus presents a network-demand view above its local Delivery Flow:

1. **Inbox:** newly received and updated envelopes, grouped by link and curation need.
2. **Clusters:** semantically related signals with distinct-organization reach, affected archetypes/capabilities, contributors, and confidence.
3. **Shared portfolio:** clusters accepted as founder-managed product demand, optionally linked to one canonical Arcamanus `BacklogItem`.
4. **Delivery mirror:** accepted items mapped to GitHub Issue/Project/PR/release state.
5. **Downstream notices:** disposition, workaround, target release, and release applicability returned along the reverse route.

Deduplication uses the immutable origin pair `(originInstallationId, envelopeId)`, not title similarity. Semantic similarity may propose a cluster, but a portfolio authority confirms merges until confidence and reversal behavior are proven. Reach counts distinct origins; reseller forwarding does not create another affected organization.

Arcamanus can delegate curation to named resellers for their channel without delegating final founder-portfolio disposition.

This view is populated only by Arcamanus-local demand and explicit demand-channel projections. Hive Mind contribution intake appears in the code-governance/contribution surface and does not create or reveal a remote backlog item. Arcamanus may create its own local follow-up item after reviewing a contribution, but that is a new Arcamanus-owned record linked to the contribution receipt—not a mirror of the contributor's backlog.

## 9. Privacy, security, and abuse controls

- Bind every inbound request to a trusted, non-quarantined `FederationLink`, permitted activity, active projection contract, schema version, and replay window.
- Treat all discovery data and envelope content as untrusted input. Apply size, rate, nesting, string, URL, and attachment limits before persistence or semantic processing.
- Never place bootstrap tokens, access tokens, organization names, customer names, backlog titles, or routable private metadata in DNS-SD records.
- Never infer same-organization ownership from DNS-SD. It is asserted and audited by operators authorized on the two installations during pairing.
- Encrypt replayable outbound credentials at rest; hash inbound bearer credentials; rotate and revoke through the existing link lifecycle.
- Record projection decisions, redactions, sends, receipts, forwards, adoptions, cluster changes, and revocations in auditable ledgers.
- Prohibit transitive forwarding unless both the incoming envelope audience and the outgoing projection contract allow it.
- Preserve pseudonymity end to end. A reseller cannot deanonymize a source for Arcamanus unless the source explicitly selected named attribution.
- Enforce a contribution payload allow-list that rejects local backlog/work-capsule serialization and strips source-local database identifiers before Hive Mind egress.
- Quarantine anomalous peers without deleting evidence. Local filing and viewing remain available while quarantined.
- Run negative-egress tests for every preset and contract revision.

## 10. Alternatives considered

| Option | Outcome |
| --- | --- |
| GitHub Issues/Projects as the shared backlog | Rejected as network authority. Useful public delivery mirror, but weak for private links, reseller consent, offline installs, field projection, and local sovereignty. |
| One centralized Arcamanus SaaS backlog | Rejected as the only path. Simple global visibility but makes customer operation and channel trust depend on a central service and creates unnecessary custody. |
| Pure peer-to-peer replication | Rejected. Avoids a hub but creates multi-writer conflicts, weak portfolio aggregation, and difficult reseller routing. |
| **Selective hybrid: sovereign local truth + governed links + Arcamanus shared registry** | Selected. Kernel scoring returned high confidence (composite `7.173`, margin `1.254`, audit `DI-B5CEB8CFBBED`). It best balances sovereignty, reuse, privacy, channel value, and founder visibility. |

## 11. Delivery slices

### Slice 0 — contract alignment

- Register relationship presets/roles and demand activity/schema versions.
- Define projection templates and negative-egress fixtures.
- Decide whether the existing outbox work is generalized or composed.
- Add protocol conformance tests before UI work.

### Slice 1 — internal fleet discovery and pairing

- Advertise and browse `_dpf-federation._tcp.local.` on supported hosts.
- Implement candidate deduplication, expiry, and safe TXT records.
- Add nearby-candidate and invitation pairing flows with dual approval.
- Establish the `same-organization` contract and link health surface.

### Slice 2 — reliable demand exchange

- Implement envelope projection, inbox/outbox, acknowledgments, retries, withdrawal, and digest reconciliation.
- Mirror received envelopes and allow observe/follow/adopt.
- Prove two-node convergence across Windows/macOS and offline recovery.

### Slice 3 — reseller/customer channel

- Add customer/reseller invitation presets and customer-controlled policies.
- Establish Arcamanus-owned reseller enrollment, agreement/entitlement, standing, and contribution-recognition views.
- Add reseller portfolio aggregation, response, help offer, and selective forwarding.
- Add pseudonymous attribution and transitive-forwarding enforcement.

### Slice 4 — Arcamanus business hub, shared portfolio, and Hive boundary

- Add clustering, distinct-origin reach, founder disposition, and canonical local-item mapping.
- Connect accepted public demand to the forge-neutral GitHub delivery mirror.
- Connect Hive Mind result bundles to code-governance review with an allow-list that excludes source backlog/work-capsule state.
- Keep business, demand, and contribution consents independently visible and revocable.
- Return disposition and release-applicability notices downstream.

### Slice 5 — routed and hosted reachability

- Add optional Arcamanus/reseller store-and-forward relay.
- Evaluate DNS-SD Discovery Proxy/SRP for managed routed networks.
- Add multi-partner, distributor, and community-peer policy packs only from observed demand.

## 12. Verification cases

| ID | Verification case | Pass condition |
| --- | --- | --- |
| V-01 | Same-LAN discovery | Mac and Windows installations appear/disappear as service records change; no private data appears in packet capture. |
| V-02 | Discovery spoof | A forged advertisement produces only an untrusted candidate and cannot call an exchange endpoint. |
| V-03 | Pairing | Both authorized operators see matching identity/code and projection summaries; one-sided approval remains pending. |
| V-04 | Automatic internal sync | An eligible item projects within five minutes without a second prompt; an excluded item never egresses. |
| V-05 | Offline recovery | Ten queued updates converge in version order after a 24-hour peer outage without duplicates. |
| V-06 | Customer minimization | Reseller receives allowed summary/applicability but not excluded rationale, identity, discussion, attachment, or estimate fields. |
| V-07 | Reseller forwarding | Arcamanus receives original provenance plus reseller attestation; pseudonymous origin remains pseudonymous. |
| V-08 | Duplicate route | The same origin envelope received directly and through a reseller counts once in reach. |
| V-09 | Multi-partner | Two partners see only their contract scopes; neither infers the other's relationship or data. |
| V-10 | Revocation | New sends stop, tokens fail, queued work is canceled/quarantined, and retention status is visible on both peers. |
| V-11 | Arcamanus outage | Customer and reseller local backlogs continue; queued demand later reconciles. |
| V-12 | GitHub separation | GitHub failure does not block federation intake; accepted shared demand retains local and network status separately from delivery status. |
| V-13 | Route loop | A customer ↔ reseller ↔ Arcamanus plus direct customer ↔ Arcamanus topology delivers one logical event and rejects cyclic forwarding. |
| V-14 | Environment boundary | Test/development demand is marked and cannot enter the production founder portfolio without explicit promotion. |
| V-15 | Contribution isolation | A code contribution reaches Hive Mind/GitHub with result, evidence, DCO, and provenance while payload inspection confirms no backlog item, priority, estimate, discussion, or customer-private context crossed. |

## 13. Standards and precedents

| Source | Adopted precedent |
| --- | --- |
| [RFC 6762: Multicast DNS](https://www.rfc-editor.org/info/rfc6762/) and [RFC 6763: DNS-Based Service Discovery](https://www.rfc-editor.org/info/rfc6763/) | Link-local announcement, service enumeration/resolution, capability TXT records, continuous add/remove discovery; discovery results are not trustworthy identity. |
| [RFC 8766: Discovery Proxy](https://www.rfc-editor.org/rfc/rfc8766.html) and [RFC 9665: Service Registration Protocol](https://www.rfc-editor.org/info/rfc9665/) | Future routed-network and registered DNS-SD operation without changing the service contract. |
| [Home Assistant instance discovery](https://developers.home-assistant.io/docs/api/instance_discovery/) | A mature self-hosted product advertises a stable `_service._tcp.local.` record so clients find instances without IP entry. DPF adds explicit business-relationship approval before trust. |
| [RFC 8628: OAuth 2.0 Device Authorization Grant](https://www.rfc-editor.org/info/rfc8628/) | Short verification URI/code, QR optimization, explicit approve/deny, expiry, and device-code confirmation for low-input onboarding. |
| [RFC 9383: SPAKE2+](https://www.rfc-editor.org/info/rfc9383/) | Reviewed PAKE reference if low-entropy pairing codes ever participate in key establishment. |
| [CloudEvents specification](https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md) | Standard event context around DPF demand activities for versioning, routing, interoperability, and tooling. |
| [W3C ActivityPub Recommendation](https://www.w3.org/TR/activitypub/) | Federated inbox/outbox, create/update/delete activity semantics, delivery acknowledgment, and abuse-aware server-to-server exchange. DPF does not adopt its public-social assumptions. |
| [Microsoft CSP partner relationships](https://learn.microsoft.com/en-us/partner-center/enroll/csp-supported-partner-relationships), [customer relationship requests](https://learn.microsoft.com/en-us/partner-center/customers/request-a-relationship-with-a-customer), and [multi-partner support](https://learn.microsoft.com/en-us/partner-center/customers/work-with-other-partners) | Directed provider/reseller/customer relationships, explicit customer acceptance, separate administrative permission, two-tier channels, and customers working with multiple partners. |

## 14. Architecture note (SysML/EA)

### System boundary

The system of interest is the **DPF Federated Demand Network**, containing discovery, pairing, relationship policy, projection, delivery, reconciliation, mirror, curation, and downstream disposition components. Local backlog authoring, Build Studio execution, Git repository synchronization, and public GitHub delivery are adjacent systems connected by explicit interfaces.

### Requirements and constraints

- R-FDN-01: preserve one canonical local backlog writer per installation.
- R-FDN-02: require dual approval before exchange.
- R-FDN-03: automatically reconcile eligible demand after approval.
- R-FDN-04: support same-org, service-provider, channel, and peer relationships without transport forks.
- R-FDN-05: enforce allow-listed, negative-tested projections.
- R-FDN-06: operate locally through peer, relay, and GitHub outages.
- R-FDN-07: preserve origin and routing provenance across intermediaries.
- R-FDN-08: allow either party to revoke.
- R-FDN-09: require no IP address, GitHub credential, shell command, certificate management, or database expertise from normal operators.
- R-FDN-10: prevent development/test demand from silently entering a production portfolio.
- R-FDN-11: keep business, demand-sharing, and Hive Mind contribution channels independently authorized and prevent contribution payloads from exposing source backlog state.

### Interfaces and ports

| Port | Provider/consumer | Contract |
| --- | --- | --- |
| Discovery port | Installation ↔ LAN DNS-SD | Minimal service/TXT record; unauthenticated candidate only |
| Pairing port | Two Authority Cores | Expiring bootstrap, identity display, dual approval, credential issue |
| Federation inbox | Peer/relay → installation | Authenticated CloudEvent-compatible activity; idempotent receipt |
| Federation outbox | Installation → peer/relay | Projected activity, retry, acknowledgment, reconciliation |
| Delivery Flow adapter | Local backlog ↔ federation | Eligibility projection; observe/follow/adopt with provenance |
| Founder portfolio adapter | Federation mirror ↔ Arcamanus portfolio | Cluster, reach, disposition, canonical shared-item mapping |
| Hive contribution adapter | Contributor result ↔ Arcamanus Hive Mind | Result artifacts, verification, DCO, provenance, review/disposition; no source backlog |
| Forge adapter | Accepted Arcamanus result/item ↔ GitHub | Delivery mirror and contribution state, never federation or backlog authority |

### Allocations

- Authority and consent allocate to `FederationLink`, `Principal`, `AuthorityBinding`, and local authenticated users.
- Data minimization allocates to `ProjectionContract` and the egress serializer/guard.
- Reliable delivery allocates to the federation inbox/outbox and reconciliation worker.
- Projected state allocates to `FederatedRecordMirror`; local execution state remains on local domain models.
- Public contribution audit allocates to `HiveContributionLedger`.
- Contribution payload minimization allocates to the Hive Mind egress serializer and contribution-policy gate, independently of demand projection.
- Arcamanus clustering and shared disposition allocate to the founder portfolio application layer, not the transport.

### Verification mapping

R-FDN-01 maps to V-08/V-12; R-FDN-02 to V-02/V-03; R-FDN-03 to V-04/V-05; R-FDN-04 to V-07/V-09/V-13; R-FDN-05 to V-01/V-06; R-FDN-06 to V-05/V-11/V-12; R-FDN-07 to V-07/V-08/V-13; R-FDN-08 to V-10; R-FDN-09 to V-01/V-03 plus moderated usability testing; R-FDN-10 to V-14; and R-FDN-11 to V-15.

### Data authority

- Source installation: local backlog item, raw evidence, local priority/status/estimate/build.
- Projection contract owner: source-side disclosure policy.
- Receiving installation: its mirror, follow/adoption choice, local derivative work.
- Reseller: its annotations, curation, help offers, and authorized aggregate.
- Arcamanus: cluster membership, founder disposition, shared-portfolio item, and public delivery mapping.
- Arcamanus business hub: reseller relationship, agreement/entitlement, channel governance, and contribution recognition.
- Hive Mind contributor: submitted code result and its evidence/provenance; the source installation retains its backlog/work authority.
- GitHub: public issue/PR/check state only.

### EA/parity catch-up

Implementation must add the new system context, relationship presets, ports, requirements, and verification links to the EA/SysML substrate in the same delivery slice as the corresponding schema or endpoint. Any additive Prisma relationship/outbox/cluster model must have a matching EA data element and authority annotation. The architecture view must continue to show the authority break between local backlog, federated mirror, Arcamanus shared portfolio, and GitHub delivery.

## 15. Open implementation decisions

These are intentionally deferred to the implementation plan after the contract is accepted:

1. Whether the durable federation outbox generalizes the pending forge-operation outbox or composes with it behind a shared delivery kernel.
2. Whether cross-source clustering needs dedicated normalized membership tables or can initially remain a read model over `FederatedRecordMirror` metadata.
3. Which host process owns mDNS announcement across Docker Desktop networking on macOS and Windows. The product contract is mandatory; host allocation needs a cross-platform spike and watchlist entry.
4. Whether direct HTTPS pairing can rely on an existing trusted portal certificate in all supported installs or needs a PAKE-assisted local bootstrap.
5. The first default field allow-list for `same-organization`; founder approval is required because this determines what becomes automatic.
