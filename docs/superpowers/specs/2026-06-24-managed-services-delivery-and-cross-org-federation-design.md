# Managed-Services Delivery & Cross-Org Federation Design

**Date:** 2026-06-24
**Status:** Draft (research + design-first, reviewed 2026-06-25)
**Author:** Claude (Opus 4.8) with founder direction (Mark `/goal`); enterprise architecture / business-development review by Codex
**Proposed epic:** `EP-MSP-FEDERATION` — *Managed-Services Delivery & Sovereign-Peer Federation*
**Composes (does not duplicate):** `EP-EDGE-NODE`, `EP-EDGE-TOPOLOGY`, `EP-ARCH-8D4F2A` (Archetype V2 / MSP), `EP-CTRL-5E21A4` (Automated Control Utility / remote assist), `EP-PARTNER-CHANNEL`, `EP-ESTATE-SOVEREIGNTY` (CADA), `EP-FULL-OBS`, `EP-PROACTIVE-OPS`, `EP-AI-OPSMAP`, `EP-A2A`, `EP-ATTENTION-SURFACE`, the enterprise-auth identity track.

**Related specs:**

- `docs/superpowers/specs/2026-04-23-it-service-provider-msp-archetype-design.md`
- `docs/superpowers/specs/2026-05-22-archetype-capability-applicability-and-msp-segmentation-design.md`
- `docs/superpowers/specs/2026-06-04-partner-reseller-archetype-identity-design.md`
- `docs/superpowers/specs/2026-04-23-automated-control-utility-design.md`
- `docs/superpowers/specs/2026-06-19-edge-node-deployment-topology-and-remote-provisioning-design.md`
- `docs/superpowers/specs/2026-05-21-edge-event-envelope-design.md` / `2026-05-21-edge-change-events-design.md`
- `docs/superpowers/specs/2026-04-22-enterprise-auth-directory-federation-design.md`
- `docs/superpowers/specs/2026-06-19-estate-sovereignty-governance-design.md`

---

## 1. Executive Decision

DPF should support managed services through **one managed-services delivery loop** and **two deployment topologies**:

1. **Topology A — Managed Estate.** The MSP runs DPF; the customer is a strict-scoped `CustomerAccount` / `CustomerSite` inside the MSP's organization. This is the near-term revenue path because it composes from substrate already designed or partly built: edge nodes, customer/site scoping, MSP archetype records, observability, and the control runner.
2. **Topology B — Sovereign Peers.** Both the MSP and customer run their own DPF. Each remains its own `Organization`. They connect through a dual-approved, revocable `FederationLink` that exchanges only scoped projections and remediation proposals. This is the differentiated compliance path for regulated SMBs and co-managed IT.

**Recommendation:** ship Topology A first, but design A's projection, service-desk, incident, approval, and UX seams so Topology B can reuse them without a second code path. Federation is not a separate product bolted on later; it is the same delivery loop crossing an organizational boundary with stronger consent and data-minimization controls.

**Business thesis:** the wedge is *managed services without surrendering operational data custody*. Incumbent RMM/PSA patterns centralize telemetry, inventory, and remote-control authority in provider-operated systems. DPF can compete from a different architecture: the customer keeps their estate data in their DPF, while the MSP receives a scoped, audited, minimum-necessary operational projection.

**Definition of success:** an MSP can see enough to meet an SLA, diagnose incidents, propose safe remediation, and publish expertise; the customer can see exactly what is shared, approve or revoke authority, keep sensitive business data local, and retain the canonical audit trail.

## 2. Problem Statement

The founder asked two linked questions:

1. **Managed-services delivery.** Research the event-management / observability space — Kafka-style buses, event storms, tickets, monitoring, and agent technologies — and explain how DPF's edge-node architecture lets an IT service provider (MSP) deliver management services to its customers.
2. **Cross-org multi-deployment.** If an IT service provider runs DPF and its customer (a law firm, a doctor's office) also runs DPF, how does that work? How should the two deployments integrate and complement each other across the organizational boundary?

These are deployment topologies of the same capability, but the platform is at different maturity on each:

- **Topology A — Managed Estate (hub-and-spoke).** The MSP runs DPF; the customer does not. The customer is a scoped estate inside the MSP's org, observed by edge nodes deployed on-site. This is already the designed direction (`EP-ARCH-8D4F2A`, `EP-EDGE-NODE`, `EP-SITE-7C4D2B`). What is missing is the managed-services delivery loop: per-customer observability scope, event correlation, a customer service-desk, and an unblocked managed-services agent loop.
- **Topology B — Sovereign Peers (federation).** Both parties run their own DPF. Each is its own `Organization` with full data sovereignty. Adjacent designs deliberately avoided this topology:
  - MSP segmentation spec §8 says MSP customers should not become separate DPF tenants and should instead be strict customer-scoped operating boundaries inside one MSP organization.
  - Partner identity spec §5 lists multi-tenant partner-operated DPF installs as out of scope.
  - The repo had no dedicated cross-org federation design when this spec was drafted.

The gap is not theoretical. Regulated SMBs in law, medicine, finance, and accounting often need a service provider without giving that provider broad custody of client-privileged, PHI, financial, or matter-level data. DPF's opportunity is to make that boundary a product advantage instead of a sales objection.

This spec documents how the existing substrate delivers Topology A, designs Topology B by generalizing edge-node enrollment into a deployment-to-deployment federation link, and defines the implementation and UX guardrails needed to keep both topologies converged.

## 3. Live Backlog Context

Live DPF MCP reads on 2026-06-24 found no epic/spec dedicated to cross-org sovereign-peer federation. This spec fills that gap and should become the pointer any future design uses when it touches "customer also runs DPF."

Topology-A substrate is owned by live epics that this work composes with, not duplicates:

- `EP-EDGE-NODE` and `EP-EDGE-TOPOLOGY` — edge collector, enrollment trust model, and deployment topology.
- `EP-ARCH-8D4F2A` — customer estate, agreements, billing-readiness, and scope-keyed inventory isolation. The MSP archetype is a worked example of axis-derived capability activation.
- `EP-CTRL-5E21A4` — central control plane and host runner. It already reserves supervised remote-session brokering and MSP-grade tenant isolation/consent as follow-on scope.
- `EP-PARTNER-CHANNEL` — external partner login population and partner portal direction.
- `EP-ESTATE-SOVEREIGNTY` — CADA posture scoring and governance for digital estates.
- `EP-FULL-OBS`, `EP-PROACTIVE-OPS`, `EP-AI-OPSMAP` — observability, proactive operational awareness, and functional-failure routing.
- `EP-A2A` — agent-to-agent orchestration, the in-org analogue of cross-org agent reach.
- `EP-ATTENTION-SURFACE` — the kernels-first "Needs you" inbox where cross-org approvals should surface.

Substrate sweep during the review confirmed:

- `ServiceTicket`, `Incident`, `Request`, `Change`, and `ScheduledReview` are named in the MSP archetype spec but are not Prisma models yet.
- `FederationLink`, `ProjectionContract`, `FederatedIncidentMirror`, `FederatedTicketMirror`, and `RemediationProposal` do not exist as current models.
- `EdgeNode`, `BootstrapToken`, `Principal`, `PrincipalAlias`, `AuthorityBinding`, `AgentActionProposal`, `EdgeEvent`, and `ChangeEvent` do exist and must be extended or referenced before any new federation substrate is added.

## 4. Research & Standards

### 4.1 Standards to adopt or map to

| Standard / source | What it says | DPF implication |
| --- | --- | --- |
| [HIPAA minimum necessary guidance](https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/minimum-necessary-requirement/index.html) | Uses, disclosures, and requests for PHI should be limited to what is needed for the intended purpose, with policies and procedures appropriate to the organization. | Topology B must be an allow-listed projection contract, not a broad telemetry mirror. It should be able to prove excluded slices never egress. |
| [NIST SP 800-207 Zero Trust Architecture](https://csrc.nist.gov/pubs/sp/800/207/final) | Zero trust assumes no implicit trust based on network location or asset ownership; authentication and authorization are discrete checks before access. | Federation links must evaluate every request by link identity, projected scope, requested action, freshness, and authority band. A VPN-like "trusted MSP network" is the wrong primitive. |
| [NIST Cybersecurity Framework 2.0](https://nvlpubs.nist.gov/nistpubs/CSWP/NIST.CSWP.29.pdf) | CSF 2.0 frames cybersecurity outcomes for executives, managers, and practitioners across GOVERN, IDENTIFY, PROTECT, DETECT, RESPOND, and RECOVER. | The managed-services cockpit should organize customer-facing evidence by outcomes: posture, detections, active response, recovery, and governance exceptions. |
| [ISO/IEC 20000-1:2018](https://www.iso.org/standard/70636.html) | Specifies requirements for establishing, maintaining, and improving a service management system that plans, designs, transitions, delivers, and improves services. | The service-desk layer should model service agreements, incidents, requests, changes, reviews, SLAs, ownership, escalation, and continual-improvement evidence. |
| [CloudEvents](https://cloudevents.io/) | Provides a common way to describe event data across services and platforms. | Keep DPF's PD-CEF-style edge event contract internally, but define a CloudEvents-compatible projection envelope for future non-DPF adapters and cross-domain event export. Do not replace the built edge envelope during this epic. |
| [SPIFFE/SPIRE workload identity](https://spiffe.io/docs/latest/spire-about/use-cases/) | Uses runtime workload attestation and short-lived, automatically rotated credentials suitable for mTLS; JWTs can authenticate messages where direct mTLS is impractical. | Federation should prefer short-lived rotating credentials and signed envelopes; SPIFFE/SPIRE is an evaluation reference for future infrastructure-grade deployment, not a required dependency in Phase 1. |

### 4.2 Event-management / observability space

| Named technology | Industry reality | DPF's actual position |
| --- | --- | --- |
| **Kafka / event bus** | Durable, partitioned, replayable pub/sub decouples producers from consumers and can be a backbone for large telemetry pipelines. | DPF has no Kafka. It uses Inngest for durable execution, an in-memory `AgentEventBus` for SSE, and a PD-CEF-style edge-event envelope at `POST /api/v1/edge/events`. That is pragmatic for one org. Cross-org federation should not start with a shared Kafka cluster because it creates a custody and ownership problem. Use federated subscriptions between sovereign stores. |
| **Event storms** | One root cause can produce thousands of symptoms. Mature systems dedupe, suppress, detect flapping, and correlate symptoms into incidents. | DPF has edge-event dedup (`@@unique([edgeNodeId, dedupKey])`, `occurrenceCount`) and alert aggregation. It does not yet have the downstream correlation engine that joins `EdgeEvent` to `ChangeEvent` through the existing `(edgeNodeId, occurredAt)` indexes. |
| **Tickets** | ITSM/PSA systems track customer-scoped incidents, requests, changes, SLAs, assignment, queues, and communications. | DPF's `PlatformIssueReport` is internal-ops substrate, not customer-facing service management. The MSP archetype names operational work records but has not implemented them. |
| **Monitoring** | Managed-services monitoring is per customer/site/service, with routing and dashboards aligned to agreements and SLOs. | DPF's observability stack is mature for self-monitoring. `PortfolioQualityIssue` has no customer/site scope today; edge nodes and inventory entities already carry customer/site scope that writers can derive into a routing read model. |
| **Agent technologies** | AI MSP value comes from monitor → diagnose → propose/execute under policy → verify → document. | DPF has pieces: `operate-orchestrator`, approval-authority, `AgentActionProposal`, `AuthorityBinding`, `EP-CTRL-5E21A4`, and attention surfaces. The end-to-end managed-services loop is not wired. |

### 4.3 Competitive and market reality

The MSP/RMM/PSA landscape is dominated by provider-centric systems: the MSP or its vendor platform is the operational hub, and customers are managed accounts. That is efficient, but it makes sovereignty-sensitive buyers ask hard questions about custody, access, audit, and remote-control authority.

DPF should avoid overclaiming that every competitor is non-compliant. The stronger BD argument is narrower and more defensible:

- Many regulated SMBs want managed services but cannot casually outsource broad operational data custody.
- DPF can offer a topology where the customer's DPF remains the authoritative system of record.
- The MSP receives enough to deliver service, not everything the customer knows.
- The product must back that story with visible consent, field-level projection controls, dual audit ledgers, and easy revocation.

Before this becomes public sales copy, validate the competitor comparison against current vendor security, BAA, data-processing, and remote-access documentation. The architecture should be ready now; external claims need current proof.

## 5. Architecture Thesis: One Projection, Two Boundaries

Both topologies reduce to one primitive:

> A scoped, consented, audited projection of an estate (inventory, events, incidents, SLO posture, and authorized remediation proposals) is made available to a managing party. The underlying data remains in its canonical estate.

- In **Topology A**, the projection is consumed by an operator inside one org and isolated by the customer/site scope-key model.
- In **Topology B**, the projection crosses a `FederationLink` to a sovereign peer after source-side correlation, redaction, minimization, and CADA scoring.

The trust channel for Topology B should generalize the built edge-node enrollment handshake:

```text
Edge enrollment (built)                Federation Link (this spec)
─────────────────────                  ───────────────────────────
dpfboot_ bootstrap token        ->     dpflink_ bootstrap token
POST /api/v1/edge/enroll        ->     POST /api/v1/federation/enroll
dpfedge_ node token (hashed)    ->     dpflink_ link token (hashed, rotating)
trustState pending->trusted     ->     linkState pending->trusted (dual approval)
capability negotiation          ->     projection-scope + authority negotiation
outbound-only, audited          ->     outbound-only, mutually audited, revocable
PrincipalAlias(edge_node)       ->     PrincipalAlias(federated_peer/operator)
```

Review note: `mcp__dpf__principle_decide` was run during this review for the keystone choice. It returned high confidence for **generalize edge enrollment** over a new cross-org auth stack or third-party federation broker. The deciding forces were schema grounding, reuse, maintainability, data privacy, and lower blast radius. Implementation should record the final decision on the keystone backlog item when the BI exists.

## 6. Topology A: Managed-Services Delivery Loop

The MSP runs DPF; customers are scoped estates. Four gaps close the near-term delivery loop:

1. **A1 — Per-customer/per-site observability scope.** Derive `customerAccountId` / `customerSiteId` from the edge node and inventory scope into alert, quality issue, service-ticket, and SLO routing read models. `PortfolioQualityIssue` can carry denormalized scope for routing, but `EdgeNode` / inventory remain the canonical source. Add invariant tests so two customers with the same private subnet never collide.
2. **A2 — Event correlation engine.** Build the `EdgeEvent` ↔ `ChangeEvent` correlation slice so storms collapse into incidents at the source, with a change-before-spike timeline. This is also the sovereignty win for Topology B because correlated incidents expose less data than raw event streams.
3. **A3 — Customer service-desk layer.** Implement the MSP archetype's operational work as a single canonical `ServiceTicket` model with `ticketKind` (`incident`, `request`, `change`, `scheduled-review`) unless a later slice proves separate tables are needed. This avoids prematurely creating four parallel records before behavior diverges. `PlatformIssueReport` remains internal-ops only.
4. **A4 — Managed-services agent loop.** Wire detect → correlate → diagnose → propose remediation → gated approval → execute → verify → record. Remediation execution goes through the control runner and approval-authority substrate; proposals should reuse or specialize existing `AgentActionProposal` / `AuthorityBinding` before adding a parallel proposal engine.

## 7. Topology B: Sovereign-Peer Federation

### 7.1 Shape

```text
   Customer DPF (sovereign)                         MSP DPF (sovereign)
   Organization = law firm/practice                 Organization = MSP
   ─────────────────────────────                    ─────────────────────────
   own edge nodes and inventory        ┌──────────┐  CustomerAccount mirror
   own events and incidents            │Federation│  managed-services loop
   own privileged/PHI/business data    │  Link    │  service tickets
   Attention Surface approvals <────── │proposal  │  scoped operator presence
   scoped projection ─────────────────>│events    │  SLO / health dashboard
                                       └──────────┘
   Sensitive source data stays with the customer. Only a consented projection crosses.
```

### 7.2 Federation Link (B1)

A `FederationLink` is a consented, scoped, revocable, outbound-only, mutually audited trust channel between two DPF Authority Cores.

- **Invitation and bootstrap.** The inviting peer issues a single-use, short-TTL `dpflink_*` bootstrap token bound to role (`manages` / `managed-by`), proposed projection scope, proposed authority band, peer identity metadata, and expiry.
- **Enrollment.** The accepting peer calls `/api/v1/federation/enroll`; DPF creates a pending link, stores only hashed token material, and records the peer as a `PrincipalAlias` attached to a canonical `Principal`.
- **Dual approval.** Both sides approve before the link is trusted. The customer confirms who manages them and what may leave. The MSP confirms whom they manage and what obligations they accept. Either side can quarantine or revoke unilaterally.
- **Transport.** Use outbound HTTPS, signed envelopes, idempotent `runKey`s, freshness windows, replay protection, per-link rate limits, and audit. DPF-to-DPF v1 does not require SPIFFE/SPIRE, but should keep the token and certificate lifecycle compatible with short-lived workload-identity patterns.
- **Authorization.** Authorization resolves on `Principal` + `AuthorityBinding`; the federation alias only tells the platform which link authenticated the actor/request.

### 7.3 Scoped Estate Projection (B2)

A `ProjectionContract` declares exactly what crosses the link:

- Included slices: examples include infrastructure health, network-device inventory summary, correlated infrastructure incidents, SLO posture, service-ticket metadata, runbook references, and remediation proposal status.
- Excluded slices: document contents, matter/case data, PHI, financial detail, customer CRM content, private employee records, raw logs unless explicitly required, and any payload not allow-listed.
- Source-side controls: correlation, redaction, field minimization, CADA scoring, retention classification, and egress audit run before egress.
- Standards alignment: the projection contract is DPF's concrete implementation of minimum-necessary disclosure and zero-trust resource access.

### 7.4 Federated Incident and Ticket Sync (B3)

A correlated incident in the customer's DPF can mirror as a managed-services `ServiceTicket` in the MSP's DPF. The canonical record remains on the source side; the peer sees a mirror governed by the projection contract.

The first model should be a generic `FederatedRecordMirror` or an extension of the existing MDM/source-reference substrate if it fits. Avoid separate `FederatedIncidentMirror` and `FederatedTicketMirror` tables unless the behaviors diverge enough to justify them.

### 7.5 Remediation Proposal and Approval (B4)

This is the safety crux:

- The MSP's managed-services agent diagnoses a federated incident and produces a remediation proposal.
- The proposal crosses the link as a proposal, never as a silent action.
- The customer's DPF evaluates the proposal against the service agreement, authority band, CADA posture, and local policy.
- Low-risk pre-agreed classes may auto-approve only if the customer's own policy permits it.
- Above-band actions land on the customer's Attention Surface for human approval.
- Approved actions execute via the customer's own control runner, inside the customer's boundary.
- Both sides retain audit evidence, but the customer has the canonical execution record.

No path should grant the MSP standing execute rights inside a sovereign customer. The durable right is to propose within a contracted band, not to act directly.

### 7.6 How the Deployments Complement Each Other (B5)

1. **The MSP delivers without custody.** The MSP gets operational visibility, proposals, service obligations, and a scoped ticket mirror. The customer keeps canonical data and control.
2. **Each party is first-class in the other.** The MSP appears in the customer's DPF as a governed vendor/partner Principal alias. The customer appears in the MSP's DPF as a `CustomerAccount`. A crosswalk reconciles `CustomerAccount` ↔ `Organization`; no email/name merge.
3. **Expertise becomes a product.** The MSP can publish runbooks, skills, decision frameworks, archetype overlays, and recommended controls into the customer's instance as versioned, opt-in artifacts. The customer accepts, rejects, or pins versions locally.
4. **Presence is scoped and visible.** A federated operator/agent works under a visible scoped identity, not as a hidden admin. Every action or proposal has a route back to link, contract, ticket, and authority band.

## 8. UX and Product-Surface Design

Federation will fail commercially if it feels like infrastructure plumbing. The user experience must make trust, service value, and next action obvious.

### 8.1 Owning areas and route families

| Surface | Primary persona | Canonical home | UX purpose |
| --- | --- | --- | --- |
| MSP customer health cockpit | MSP dispatcher / service manager | MSP customer/service area, not global nav | Show customer queue, breached SLAs, correlated incidents, approval waits, and link health. |
| Customer vendor relationship view | Regulated SMB owner / office manager / internal IT | Business/customer admin surface | Show who the MSP is, what is shared, what is pending approval, and how to revoke or narrow scope. |
| Cross-org approvals | Customer decision authority | Existing Attention Surface / `/ops` attention lens | Present proposals with risk, impact, authority band, expected evidence, and approve/reject/defer actions. |
| Federation setup | Technical operator / MSP onboarding specialist | Platform/admin setup wizard | Guide link invitation, peer confirmation, projection contract, authority band, test exchange, and first ticket mirror. |
| Reporting and evidence | MSP and customer executives | Report-kit based service review | Summarize service value, incidents avoided, SLA posture, response time, audit exceptions, and accepted runbook updates. |

Do not add a new top-level navigation area for federation in v1. Start with contextual entry points in existing MSP/customer/platform surfaces. Promote to durable section nav only after repeated usage proves it is a daily workspace.

### 8.2 First-viewport requirements

For the MSP, the first viewport should answer:

- Which customers need attention now?
- Which SLA or authority-band risk is most urgent?
- What has changed since last review?
- Which incidents are correlated enough to act on?
- Which customer approvals are blocking restoration?

For the customer, the first viewport should answer:

- Who can see what?
- What is the MSP asking to do?
- What happens if I approve, defer, or revoke?
- What proof will I get afterward?
- Is my sensitive business data staying local?

### 8.3 Interaction patterns

- Use a wizard for initial link setup: invite → peer verify → projection contract → authority band → test projection → service agreement bind.
- Use progressive disclosure. Default to 3-5 plain choices; hide field-level projection detail behind review/advanced panels.
- Use toggles/checkboxes for binary projection slices, segmented controls for authority bands, and explicit review tables for field-level exclusions.
- Use report-kit primitives for status badges, KPI cards, tables, filters, charts, and CSV export. Do not hand-roll status colors or dashboard components.
- Use DPF theme tokens only. All UX must pass light/dark/brand-token checks.
- Avoid native browser dialogs; approvals and revocation must use in-app dialogs with durable audit actions.
- Coworker/agent actions must preview the proposal, expected next step, and data scope before sending anything across a federation link.

### 8.4 Required UX-fit decision

Before implementation, record a UX-fit decision with:

- **Decision:** `fits-with-guardrails`.
- **Owning area:** Platform/admin for setup; MSP/customer service area for delivery; Attention Surface for approvals.
- **Navigation layer:** contextual/local first; no new global nav in v1.
- **Reuse/convergence:** report-kit for reporting; existing Attention Surface for approval; existing partner/vendor identity patterns for relationship display.
- **Evidence before merge:** route tests for empty/missing-permission/link-revoked states; theme scan; desktop and mobile browser checks; fixture with two customers using identical private IP ranges; screen text reviewed for non-technical customer comprehension.

## 9. Topology Selection Guidance

| Choose Topology A (managed estate) | Choose Topology B (sovereign peers) |
| --- | --- |
| Customer wants the MSP to own the operating model | Customer is regulated or sovereignty-sensitive |
| Customer does not run DPF | Customer already runs DPF or wants its own DPF |
| Infrastructure-only monitoring is sufficient | Co-managed IT requires both parties to operate |
| Lowest deployment cost matters most | Data residency, privilege, or minimum-necessary disclosure is a hard requirement |
| Customer accepts provider-hosted operational records | Customer must remain the canonical system of record |

The two are not exclusive. One MSP can serve a mixed fleet: managed estates for low-complexity customers, sovereign peers for customers who need custody and local authority.

## 10. Commercial Design and Business Development Frame

### 10.1 Initial offer structure

Lead with three service packages, not an abstract federation platform:

1. **Managed Estate Essentials.** One MSP DPF, scoped customer estates, edge monitoring, customer service tickets, and monthly service review.
2. **Co-Managed Sovereign.** Customer and MSP both run DPF; read-only health projection, ticket sync, approval-gated remediation, and audit evidence.
3. **Regulated Operations Partner.** Co-managed sovereign plus compliance evidence packs, runbook publishing, authority-band governance, and quarterly CADA posture review.

### 10.2 Buyer and user distinction

- **Economic buyer:** regulated SMB owner, managing partner, practice administrator, or outsourced-IT decision maker.
- **Technical evaluator:** internal IT lead, MSP service manager, compliance consultant, or security reviewer.
- **Daily users:** MSP dispatcher, MSP operator, customer office manager, customer approver, and AI coworker/agent reviewer.

The buyer cares about risk, continuity, trust, and measurable service value. The daily user cares about attention, response time, clarity, and not being asked technical questions they cannot answer.

### 10.3 Bottom-up economic model

Do not forecast from a desired ARR. Forecast from drivers:

`managed-services revenue = customers × sites/endpoints × service tier price × retention × expansion`

Dominant cost drivers:

- onboarding hours per customer/site/link
- ticket volume per customer
- human minutes per incident before and after correlation/agent assistance
- percentage of remediation proposals auto-approved by agreement
- support burden for federation setup and trust troubleshooting
- compliance evidence/reporting time per review period

Validation metrics for the first pilots:

- time from edge enrollment to first scoped customer health signal
- alert-to-correlated-incident compression ratio
- mean time from detection to customer-visible proposal
- approval cycle time by authority band
- percentage of incidents resolved without raw data egress
- operator minutes per ticket
- monthly service-review preparation time
- customer trust signal: number of projection changes/revocations and reasons

### 10.4 Positioning

- **Wedge:** managed services without surrendering data custody.
- **Channel:** MSPs become DPF channel partners; their expertise becomes reusable runbooks, skills, and frameworks accepted by customer instances.
- **Moat:** federation composes from DPF-native primitives: edge trust, Principal convergence, CADA, authority bands, control runner, and attention surfaces. Competitors with provider-centric cores can imitate the message more easily than the architecture.
- **Proof requirement:** public BD material must cite current vendor/security/compliance evidence and avoid absolute "only" claims until validated.

## 11. Data Model and Refactoring Direction

This section intentionally spends implementation attention on convergence and refactoring. The target is roughly **80% feature delivery / 20% substrate refactoring** for the first slices so the new capability does not create parallel identity, ticket, proposal, or status systems.

### 11.1 New or extended models

- **`FederationLink`**: side table attached to `Principal` / `PrincipalAlias`, with `role`, peer authority URL, local/peer organization refs, `linkState` (`pending`, `trusted`, `quarantined`, `revoked`), rotating token hash, approval timestamps, projection contract ref, authority band, rate limits, and audit refs. Mirrors `EdgeNode` / `BootstrapToken` lifecycle deliberately.
- **`ProjectionContract`**: link-scoped allow-list of slices/fields, exclusion rules, redaction policy, retention policy, CADA posture, review cadence, and last test result.
- **`ServiceTicket`**: canonical customer-facing work record with `ticketKind` rather than four premature tables. Link to customer/site/CI, incident/correlation evidence, SLA policy, agreement line, owner, status, and communication log.
- **`FederatedRecordMirror`**: generic mirror/crosswalk if existing MDM/source-reference substrate cannot carry link-scoped record sync. Stores local record ref, peer record ref, canonical side, sync status, version, and conflict state.
- **`RemediationProposal`**: add only after auditing whether `AgentActionProposal` + `AuthorityBinding` + future `ControlRun` covers the need. Preferred shape is a specialized projection or side table, not a second approval engine.

### 11.2 Refactoring tasks to include in Phase 1/2

- Extract a shared **trust-link lifecycle helper** from edge enrollment concepts: token prefix validation, pending/trusted/quarantined/revoked transitions, single-use bootstrap checks, token rotation, and audit events.
- Create a shared **estate-scope resolver** that derives customer/site/scope-key from edge node, inventory entity, service ticket, or federation link. Use it everywhere writers need customer routing.
- Converge service-work status strings into one closed union before migrations. Hyphens, not underscores; update MCP tool schemas and TS unions in the same commit when values are introduced.
- Factor **projection serialization** into a pure library with tests: allow-list, deny-list, redaction, CADA score, retention classification, CloudEvents-compatible outer metadata, and excluded-field proof.
- Keep UI status semantics in report-kit `statusColors`; do not create a federation-only badge palette.
- Add invariant tests proving `PrincipalAlias` is the only identity extension for peers/operators and that no federation code authorizes directly from free-text peer IDs.

### 11.3 Non-goals

- No shared Kafka or central cloud broker for DPF-to-DPF federation in v1.
- No parallel identity table for peers/operators.
- No standing MSP execute rights inside a sovereign customer.
- No global federation dashboard in v1.
- No external sales claim that has not been revalidated against current competitor/security documentation.

## 12. Phases

- **Phase 0 — Spec, decision, epic/BIs.** Finalize this spec, record the keystone decision, file the epic/BIs, and attach architecture/UX-fit evidence.
- **Phase 1 — Topology A delivery loop.** A1 per-customer observability scope → A2 correlation engine → A3 service ticket → A4 managed-services agent loop. This ships near-term MSP value and the reusable projection foundation.
- **Phase 2 — Federation foundation.** B1 `FederationLink` + B2 `ProjectionContract`. Two sovereign dev installs establish a link and exchange a read-only health projection. Include CADA egress tests and revocation tests.
- **Phase 3 — Federation delivery.** B3 ticket mirror + B4 remediation proposal/consent gate + B5 identity/presence/crosswalk + governed artifact sharing.
- **Phase 4 — Scale and proof.** Fleet dashboards across links, link SLOs, artifact-publish workflow, compliance evidence packs, onboarding playbooks, and commercial pilot metrics.

## 13. Acceptance Criteria

1. The two topologies are documented with explicit selection guidance; future specs that touch "customer runs their own DPF" point here rather than treating it as out of scope.
2. **A1:** a firing alert resolves to a specific customer/site route when known; two customers with identical private subnets never collide; the canonical scope source remains edge/inventory, with routing denormalization tested.
3. **A2:** a change event followed by an alert spike on the same node within the configured window produces one correlated incident with change-before-spike evidence.
4. **A3:** a correlated incident creates a customer-scoped `ServiceTicket` distinct from internal `PlatformIssueReport`; `ticketKind` covers incident/request/change/review until separate models are justified.
5. **A4:** the managed-services agent can detect, diagnose, and propose with the required grants; proposed remediation routes through authority and audit; no unapproved execution occurs.
6. **B1:** two sovereign DPF installs establish a `FederationLink` requiring dual approval; either side can revoke; peer/operator identities are `PrincipalAlias` records; transport uses rotating credentials, signed envelopes, freshness checks, replay protection, and rate limits.
7. **B2:** only slices named in the `ProjectionContract` cross the link; excluded data classes have negative tests proving no egress; every projected field carries CADA/retention classification.
8. **B3:** a customer incident mirrors as an MSP service ticket with canonical-source metadata and conflict handling; revocation stops sync without deleting historical audit evidence.
9. **B4:** an MSP remediation proposal lands on the customer's Attention Surface; above-band actions require customer approval; approved actions execute via the customer's own control runner; both audit ledgers record the outcome.
10. **B5:** `CustomerAccount` ↔ `Organization` reconciliation uses an explicit crosswalk; MSP operator presence is scoped, visible, and audited.
11. **UX:** setup, approval, ticket, and reporting surfaces use DPF theme tokens, report-kit primitives, in-app dialogs, progressive disclosure, and mobile/desktop no-overlap verification.
12. No new event bus, identity table, approval engine, or raw archetype-id branch is introduced without a substrate-verification note and kernel decision.

## 14. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Federation reinvents auth | Generalize edge enrollment; reuse `Principal` / `PrincipalAlias`, `AuthorityBinding`, rotating hashed tokens, signed envelopes, and audit. |
| Customer data leaks | Projection allow-list, source-side redaction/minimization, CADA egress gate, negative egress tests, and customer-visible contract review. |
| MSP gains silent control | Propose-not-act; dual link approval; per-action authority band; customer runner executes; instant unilateral revoke. |
| A and B fork | One projection library, one service-ticket model, one managed-services agent loop; boundary-specific transport only. |
| Event storms flood the MSP | Correlate and suppress source-side; federate incidents, not raw events, by default. |
| UI becomes operator plumbing | Contextual entry points, progressive setup, report-kit views, plain-language labels, and Attention Surface approvals. |
| Scope creep into PSA clone | Service tickets, agreement/SLA ties, and review evidence first; defer billing, MDF, LMS, and full PSA breadth. |
| Commercial claim outruns evidence | Keep architecture claims internal until competitor/security documentation and pilot metrics validate public positioning. |
| Regulated customers distrust automation | Default to read-only projection, proposal-only remediation, explicit proof, and customer-owned execution. |

## 15. Open Questions Before Implementation

1. Should `ProjectionContract` be stored as a dedicated table immediately, or as a versioned JSON contract on `FederationLink` until contract behavior proves complex enough? This is a migration-shape decision and should be scored before build.
2. Does existing MDM/source-reference substrate cover the cross-org record mirror, or does federation need `FederatedRecordMirror`? Verify with schema and code graph before migration.
3. Should service tickets live under a new MSP/customer route family or extend an existing customer/service route? UX-fit review should decide after route inventory.
4. Which authority bands are legally/business acceptable for the first regulated pilots? This is a founder/operator business decision, not just a platform default.
5. What minimum evidence pack must a pilot customer see each month to believe sovereignty is working?

## 16. Implementation Evidence Required

- Architecture review finding attached to the epic/BI.
- Kernel decision record for the trust architecture.
- UX-fit decision record for setup, cockpit, approval, and report surfaces.
- Standards note referencing HIPAA minimum necessary, NIST ZTA, NIST CSF 2.0, ISO/IEC 20000-1, CloudEvents mapping, and SPIFFE/SPIRE as an identity reference.
- Substrate verification note for every new model/table.
- Source-local tests for projection serialization, egress exclusion, scope derivation, ticket kind/status unions, and link lifecycle invariants.
- Production build and runtime-bound UX verification via the governed DPF verification path before merge, per AGENTS.md.
