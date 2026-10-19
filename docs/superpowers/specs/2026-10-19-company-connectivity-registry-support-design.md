---
status: draft
---

# Company connectivity, customer registry and relationship-governed support

**Date:** 2026-10-19

**Overarching epic:** EP-58240092

**Design/reconciliation item:** BI-2B011C61

**Workroom:** WC-AE329F09

**Status:** Authored reference design. Independent approval, provider signup and runtime delivery remain separate outcomes.

## 1. Purpose and scope

A company runs its own DPF Authority Core. Employees, agents, phones and other devices use that company's identity and authorization. Remote devices must reach the company server through NAT and firewalls. The platform publisher, the company supporting the open-source project, needs a relationship-aware registry for customers it supports. Registered MSPs support their own customers; an MSP-exclusive arrangement must not silently give publisher or another MSP customer visibility or administrative access.

Operator direction on 2026-10-19 adds two constraints: publisher has no cloud presence, so initial internet forwarding must use an existing third-party service; and unfinished work may survive in branches, Workrooms or review queues without a PR. Recover evidence before commissioning replacement implementation. Start with a few customers and explicitly plan the transitions to larger fleets.

This is the single program reference across the existing connectivity, federation and MSP designs. It governs their integration, evidence reconciliation, provider decision packet and growth triggers. Existing designs still own their detailed contracts. This document does not approve a subscription, accept vendor terms, deploy infrastructure, expose an installation, create support grants or certify a working feature.

**OBJ-CONN-01:** Recover and reconcile prior work into one evidence-backed delivery map without losing source, ownership or review history.

**OBJ-CONN-02:** Provide replaceable third-party reachability for a small initial footprint without requiring publisher cloud infrastructure.

**OBJ-CONN-03:** Discover the correct company and support counterpart while keeping identity, transport, commercial relationships and action authority distinct.

**OBJ-CONN-04:** Enforce direct support, MSP-exclusive support, independent operation and explicitly authorized escalation through customer-owned policy.

**OBJ-CONN-05:** Give operators clear setup, connection, consent and recovery experiences.

**OBJ-CONN-06:** Grow through measured operational and commercial thresholds without changing sovereign customer identity or creating an all-to-all network.

Non-goals: a bespoke NAT traversal stack, a new remote-desktop product, mandatory customer cloud hosting, shared customer databases, automatic publisher access, or a general repair of DPF's delivery process. Existing review/process repairs remain with their owners.

## 2. Canonical references and precedence

| Reference | Continuing responsibility | Reconciliation here |
| --- | --- | --- |
| [Deployment contracts](2026-05-09-deployment-contracts.md) | Runtime configuration, lifecycle, identity, edge, observability, secrets and client/API surfaces; Contracts 2-5, 7-8, 10-12 are affected | Every provider wraps these contracts; no alternate authorization path |
| [Mobile companion and remote access](2026-06-12-archetype-aware-mobile-companion-remote-access-design.md) | Mobile jobs, runtime URL provisioning, principal/device convergence | A remembered URL and descriptor do not establish NAT reachability |
| [Managed services and sovereign peers](2026-06-24-managed-services-delivery-and-cross-org-federation-design.md) | Topology A: MSP-owned customer estates; Topology B: separate company and provider installs | The requested customer-owned server uses Topology B; Topology A remains valid |
| [Federated demand network](2026-07-19-federated-demand-network-design.md) | Minimized exchange, provenance, forwarding and optional application relay | Packet forwarding and application store-and-forward have different responsibilities |
| [Discovery/pairing redesign](2026-08-07-federation-discovery-pairing-redesign.md) | LAN discovery and hub-mediated introduction | Hub introduction alone does not route traffic through two NATs |
| [Public reachability](2026-09-02-install-public-reachability-design.md) | Vendor-neutral exposure contract and optional first provider | Third-party forwarding required initially; no publisher-operated payload relay is assumed |
| [MSP delegated support](2026-10-12-msp-customer-setup-delegated-support-design.md) | External technician authority, setup, dispatch, sessions and revocation | Add the registry/exclusivity contract; retain its authority and UX delivery items |

EP-58240092 is the overarching program. EP-8B03CB06 retains connectivity delivery; EP-1FABA22D retains installation-purpose/federation integration; EP-0AC73AEA retains MSP operating readiness; EP-ZERO-CONFIG-FEDERATION retains same-organization membership work. Their items are dependencies in one map, not copied implementations. A BacklogItem has one owning epic; a cross-reference does not require reparenting it. In particular, mirrored records marked with a federated origin remain owned by their source installation.

The retained August topology plan is discussed in §3; it is not adopted wholesale. Its historical localhost-only MCP claim and blanket public-HTTPS requirement are not current universal contracts. Operator MCP/internal A2A remain private by default. Any supported external agent API needs an explicitly classified route and current authentication, authorization and origin policy; tunneling the whole portal is not permission to publish every API.

## 3. Evidence and unfinished-work recovery

Observation: current source reference `origin/main` at `67f2c72823f3429d3ac2114fcdb06d15e5400b79`, refreshed 2026-10-19. Live statuses below came from MCP on that date. These are bounded observations, not an exhaustive search of every historical branch or thread.

| Deliverable | Evidence observed | Honest state / next action |
| --- | --- | --- |
| Public reachability | BI-E2E8BD27 is awaiting acceptance; [PR #4962](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/4962) merged 2026-09-02 and changed only the design boundary text | Documentation merged. No reachability overlay/cloudflared packaging found on the inspected main; implementation elsewhere remains unproven |
| MSP support | [PR #6256](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/6256) merged 2026-10-13 at authored head `1ff132353a4840459dd37098de69c15904b862e0` | Researched design merged; D1-D5 delivery is not thereby accepted |
| Earlier topology plan | Remote branch `docs/edge-reachability-topology-plan`, head `63e5bfcfa37`; relevant commit `e42ca7d7fd0`; path `docs/superpowers/plans/2026-08-11-edge-reachability-topology.md` | Plan exists off main; exact-head PR query returned none. Branch also contains unrelated TAK documents: recover relevant content only |
| Mobile connection | `apps/mobile/src/lib/serverConfig.ts`, `apps/mobile/app/connect.tsx` | Runtime URL/descriptor connection exists; localhost fallback remains in serverConfig; complete provisioning/NAT/device behavior unverified |
| Federation substrate | `apps/web/lib/federation/`: identity, durable state, membership, enrollment, introductions, client, projection/exchange and consent modules | Code exists; not proof of off-LAN operation or complete support readiness |
| Cross-NAT hub | BI-26091014 open | No accepted hub/route integration evidence found in this investigation |
| Private operator path | BI-CAF86466 open; recorded decision DI-D96FB0FE7C1F selects a WireGuard-style private overlay | Preserve that decision; it did not choose customer public access or prove enrollment |
| Exposure hardening | Sep29 Cloudflare evaluation, updated through Oct1; BI-19D3A187 still open | Reuse fixes already landed; prove remaining startup/host and ingress conditions before exposure |

BI-0ED2EDEC owns the recovery sweep. For each relevant item, capture repository, immutable base/head/blob, Workroom, tests, PR state, deployed release and acceptance evidence separately. Search retained local/remote branches and worktree status read-only; do not reset, delete, rebase or sweep another thread's dirty files. Compare content/tree diffs because squash merges change commit identity. Classify each outcome as authored, reviewed, PR-open, merged, deployed, runtime-accepted, superseded or unknown, with a locator and next owner/action. Absence on main is not absence everywhere.

Recover an existing adequate artifact before writing another. Reconcile misleading statuses at their owning installation; neither a missing receipt nor awaiting-acceptance proves missing code or a working product. Resume an exact valid review rather than repeatedly spawning replacement reviews. Document a blocked review's actual refusal and remedy; process instability never licenses bypassing authority, DCO or protected publication.

## 4. Architecture: four contracts

| Layer | Owns | Must not imply |
| --- | --- | --- |
| Discovery/registry | Stable installation identity, verified counterpart, candidate coordinates, registration freshness and permitted visibility | Network reachability, employee membership or support permission |
| Transport | Approved route to a company HTTPS endpoint: tunnel, private overlay or later alternative | Trust in the caller or authorization of an operation |
| Relationships | Seller, primary support provider, publisher, transport/account owner, agreements and permitted escalation | Transitive rights from publisher to MSP to customer |
| Authority | Principal/device identity, current customer consent, target scope, operation, expiry and audit | Standing administrator access from discovery, commercial status or tunnel enrollment |

The company Authority Core stays the policy decision point. Employees and AI agents retain company-scoped identity; an external MSP technician remains an external principal. A phone's device identity and push endpoint do not grant authority. Company operation and local login continue when the registry or forwarding service is unavailable; remote callers see an explicit disconnected state.

Conceptual initial paths (proposed, not installed):

```text
Phone/browser -- HTTPS --> third-party forwarding edge
                                ^
                                | outbound connector
                         Company Authority Core

Company install -- outbound signed registration --> registry hostname
                                                      |
                                            third-party forwarding edge
                                                      ^
                                                      | outbound connector
                                           publisher production server

MSP Authority Core <---- scoped federation/proposals ----> Company Core
```

The relay provider supplies public connectivity, not DPF registry storage or support policy. Initial registry application hosting is proposed on a publisher-controlled production server behind its own narrowly exposed connector; no cloud VM is required. Feasibility, route isolation, backup and operating acceptance are delivery obligations, not claims that a registry is built. Development portals receive no public route.

A private install can register outbound with a reachable registry without acquiring its own public IP or hostname. Later callbacks, mobile sessions and bilateral exchange still need an actual approved route. Support-message polling can be designed for an outbound-only private customer, but current peer HTTP calls must not be described as a persistent reverse tunnel. A private customer can use an enrolled private overlay instead of a public application endpoint. A phone on that path needs the corresponding network client; a public HTTPS phone path does not.

## 5. Research & Benchmarking

Primary sources inspected 2026-10-19. Upstream main/dev files describe inspected models, not pinned adopted dependencies. This design adds no package or service. Detailed support comparators (MeshCentral, Tactical RMM, Microsoft GDAP, ScreenConnect) remain in the October MSP design rather than being re-evaluated here.

| Comparator / source | Pattern adopted | Pattern rejected or limitation |
| --- | --- | --- |
| [Headscale Node model](https://github.com/juanfont/headscale/blob/main/hscontrol/types/node.go) | Keys, endpoints, ownership, expiry and approved routes are distinct node facts | Do not copy a mesh identity store into DPF's company/support registry; self-hosted coordination still needs a reachable operated service |
| [frp proxy configuration model](https://github.com/fatedier/frp/blob/dev/pkg/config/v1/proxy.go) | Named proxy, backend, domain, transport and health settings separated from application authorization | Operating frps on a VPS would add infrastructure publisher does not have; not the initial deployment |
| [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/) and [firewall requirements](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/) | Existing outbound connector for approved HTTPS surfaces; no inbound port forwarding | TLS/data custody needs explicit acceptance; outbound is not unrestricted-firewall compatibility: cloudflared requires permitted egress on port 7844 |
| [Tailscale connections](https://tailscale.com/docs/reference/connection-types) and [pricing](https://tailscale.com/pricing) | Private device routes with direct/relay behavior; retain recorded operator-overlay choice | Do not put all customers in one unrestricted tailnet; commercial/OEM entitlement and device enrollment remain decisions |
| [ngrok pricing](https://ngrok.com/pricing) | Managed forwarding alternative when the preferred provider's DNS/terms/egress do not fit | Stable custom domains require the appropriate paid offering; include metered usage and traffic-inspection settings in evaluation |

Follow the [DPF Cloudflare evaluation](../../security/tool-evaluations/2026-09-29-cloudflare-tunnel.md) and deployment contracts. Extend existing Principal, authority and relationship models; use relationship-filtered discovery, signed authenticated messages and least privilege. Endpoint classifications and route allowlists are implementation evidence, not inferred from hostnames.

**New evidence to reconcile with the September evaluation:** [Cloudflare Tunnels for Platforms](https://developers.cloudflare.com/tunnel/features/tunnels-for-platforms/) now explicitly describes per-customer/platform use and capacity above the ordinary account limit. The page, updated Oct16, lists 1,000 included tunnels and $4.50/month per additional tunnel. This is a capacity/product fact, not a conclusion about DPF's exact resale rights or total cost. BI-009CCC19 must refresh that evaluation against current contract, account and deployment terms before signup. Do not assume account splitting is the only growth option or that ordinary Zero Trust eligibility equals platform-service entitlement.

## 6. Initial provider direction and signup decision packet

**Proposed initial split:** an evaluated named Cloudflare tunnel for the registry hostname and opted-in customer-facing HTTPS; the already selected private overlay for operator/development access. ngrok is the managed-forwarding fallback for evaluation. Preserve the adapter boundary; no custom packet relay is commissioned. Final vendor/account selection remains open until the packet below is approved. A prior generic kernel consultation (DI-4949F2F04A01) had insufficient signal and is not ratification.

Use stable customer-controlled names where practical. Where an MSP/publisher supplies a hostname, record its owner, transfer/export procedure and service continuity promise. Prefer one-level subdomains initially; multi-level hostname certificate requirements must be priced before choosing a namespace. No transient quick-tunnel URL is a production identity. An MSP-exclusive customer may use customer/MSP-owned transport accounts; publisher-owned transport metadata must be disclosed if that option is chosen, because support isolation does not hide traffic metadata from the transport account owner.

| Decision | Proposed starting point | Required owner and evidence before signup |
| --- | --- | --- |
| D1 Provider and product | Cloudflare named tunnel candidate; private operator overlay separate | Platform technical evaluation plus publisher business owner approves exact product and terms; ngrok fallback evaluated if disqualified |
| D2 Account ownership | publisher owns its registry account; customer/MSP ownership preferred for their connectors | Business owner chooses managed vs bring-your-own-account, billing responsibility, transfer and partner/OEM/resale rights |
| D3 Domain/DNS | Stable domain owned by the serving organization | Domain owner verifies DNS/zone compatibility, certificate coverage and change impact; no nameserver migration is assumed approved |
| D4 Identity and credentials | Named business administrators with MFA, recovery owner and narrowly scoped automation credentials | Confirm IdP/login, backup administrator, token storage/rotation, connector compromise response; no account-wide key on a customer install |
| D5 Traffic/data | DPF authenticates every protected request; ingress exposes selected routes only | Customer/publisher owner accepts provider TLS termination, logging/inspection, retention and geography; sensitive customers may require private overlay or another evaluated mode |
| D6 Cost and terms | Small pilot budget, no assumed enterprise commitment | Approve dated quote, monthly ceiling, payment owner, alerts and permitted managed use; free tier is not an SLA |
| D7 Network compatibility | Verify actual site egress, DNS, TLS and reconnect behavior | Technical owner tests 7844 for Cloudflare; if blocked, select a permitted evaluated alternative rather than claiming outbound-only guarantees access |
| D8 Operations | Production origin behind forwarding; development stays private | Agree pilot hours, incident contact, restore procedure, registry outage behavior and when paid support/HA becomes mandatory |

BI-009CCC19 owns this packet. Signup, paid activation, terms acceptance and DNS changes happen only after concrete choices are available for the accountable owner. This thread captures decisions; it does not make those external commitments.

## 7. Growth stages, cost model and transition triggers

The customer bands below are planning assumptions, not measured capacity or contractual service tiers. Customer count is a review trigger; actual load, account quotas, spend, privacy and availability can force an earlier transition. Each stage must pass its entry evidence before more customers are admitted.

| Stage / indicative footprint | Architecture and operations | Transition work and gate |
| --- | --- | --- |
| G0 pilot: 1-10 customer installs, 1-2 MSPs | Third-party forwarding, narrowly exposed production registry origin, manual reviewed onboarding, per-install scoped credentials and backups; explicit pilot availability | Before first customer: resolve D1-D8; prove cellular path, isolation, revoke, connector restart and restore. Review weekly; no promise of continuous availability from one site |
| G1 early service: 11-100 installs | Keep transport replaceable; automate idempotent enroll/rotate/revoke; cursor pagination, delta registration, jittered retries, health/staleness views and reconciliation | Before customer 11 or onboarding exceeds 30 minutes/install: capacity/privacy review and automated lifecycle plan. Before a 24x7/SLA sale: funded production hosting/HA and recovery acceptance regardless of count |
| G2 managed fleet: 101-1,000 installs, multiple MSPs | Evaluate contracted platform/multi-account offering, MSP delegation, production cloud or managed registry hosting, redundant origins/connectors where independent failure domains exist | Review at 100 installs, or 70% of any actual quota, or sustained latency/error breach. Decide hosting budget, tested failover, provider support, billing allocation and account-isolation model before expansion |
| G3 ecosystem: above 1,000 installs or multi-region/regulated demand | Negotiated provider capacity; partitioned registry read models and queues by organization/relationship/region; regional residency and recovery where required | Load test intended scale; fund operations; evaluate provider concentration and exit readiness. No all-to-all mesh or full-fleet polling; cloud migration remains a deliberate decision, not assumed existing infrastructure |

Proposed pilot operating targets, to be approved in D8: registry status may be stale for at most 15 minutes before the UI labels it; reconnect backoff capped at 5 minutes with jitter; interactive diagnostic target p95 under 2 seconds excluding company workload. These are targets to measure, not achieved results. Two daily incidents, a material privacy change, 70% quota usage, or forecast spend above 80% of the approved monthly ceiling triggers an immediate review. Provider outage and customer-origin outage are reported separately. Multiple connectors on one host do not provide host/site resilience.

Cost planning uses drivers, not a desired revenue figure:

```text
monthly connectivity cost = plan base + billable tunnels + identity seats/resources
                          + metered requests/transfer/logging + domain/certificate add-ons
monthly service cost      = connectivity + registry hosting/backups/monitoring
                          + support hours * approved internal hourly rate
```

Count installs/environments, not phones, when sizing company-server tunnels. Count actual provider-managed devices/seats separately for the private overlay. Do not multiply every employee by every customer tunnel. The current Cloudflare platform capacity component is `max(0, provisioned tunnels - 1000) * $4.50/month`; inactive existing tunnels still count. That component alone would be $4,500/month at 2,000 tunnels, before other services; reprice before purchase. Tailscale's inspected public page lists Standard at $8/user/month and Premium at $18/user/month; use the quote's billing basis and resource limits. ngrok custom-domain pricing is $0.01/active hour, with plan and usage charges additional. These dated comparator prices are not a budget approval.

Before changing provider or registry host, preserve installation keys, consent/audit and ownership; export routing/registration records without copying business databases. Rotate provider-specific credentials, run overlap/cutover verification, update stable endpoints through an authenticated revision, retain rollback aliases only for the agreed window, then revoke the old connector. A hostname change cannot silently move support authority.

## 8. Registry and relationship visibility

The registry is an authenticated relationship projection, not a public list of customers and not a second company authority. Registration is outbound initiated, signed, replay-resistant, idempotent, versioned and expiring. The implementation must audit existing schema fields before introducing any persistent type. Its required facts are conceptual contracts here, not a proposed parallel table.

| Fact | Canonical owner to reuse/audit |
| --- | --- |
| Company name and organizational identity | Organization; do not derive identity from URL or transport account |
| Installation/device keys and endpoint revision | Existing installation/federation identity and durable state; endpoint is mutable |
| Seller, provider standing, agreements and service rights | PartnerAccount, PartnerAgreement, PartnerEntitlement, CustomerAccount/service contracts as applicable |
| Peer relationship, approved projection and action envelope | FederationLink, ProjectionContract, AuthorityBinding and customer consent |
| Human/agent/device identity | Principal and PrincipalAlias; no customer employee created for an MSP technician |
| Support routing and escalations | PartnerSupportRoute plus audited, scoped customer/provider-approved escalation; exact field gaps belong to the registry delivery plan |

The minimal registration contains an installation public identifier/key proof, relationship/provider reference, endpoint only for an authorized audience, protocol/version compatibility, freshness and consent revision. Legal company name, contacts, topology, logs, tickets, device inventory and operational diagnostics are separate optional projections. No secrets or business-record replication. Choose retention/deletion and pseudonymous identifier linkage before collection; the implementation must define indexes, pagination, bounded delta cursors, tombstones and anti-enumeration controls.

| Arrangement | Registry/discovery visibility | Support authority |
| --- | --- | --- |
| Direct publisher | Customer-approved publisher registration and scoped operational projection | Customer-approved publisher technicians/agents only |
| MSP-exclusive | MSP sees its customers; publisher sees the MSP and only separately permitted minimal/pseudonymous downstream registration, if any | Selected MSP only; publisher relationship does not inherit access |
| Explicit escalation | Selected issue/evidence and temporary counterpart identity, within the approved audience | Bound operations/targets/expiry; customer policy and existing additional gates still apply |
| Independent | No required support registration; any community participation follows its own agreement | Company only |

An MSP-exclusive install need not reveal its legal customer identity to publisher merely to consume open-source software. If central minimal registration is chosen as a service condition, disclose precisely what publisher learns and offer the independent mode. Decide that commercial condition explicitly; do not encode it as implied technical necessity. Registered MSP standing allows recognition, not access to all customer installs. No unrelated MSP can enumerate another MSP's customers.

Introductions and forwarding remain opt-in and constrained by their existing contracts. Audit `introductions.ts`, `channel-demand.ts` and `cross-org-sharing.ts`: platform-demand sharing, customer-identity disclosure and support-access escalation are three separate permissions. A public platform bug may be shared without opening the customer's diagnostics or business data; customer/provider identifiers in that bug must still follow its permitted projection. Revoked relationships invalidate cached discovery/projection eligibility and pending escalations. Re-pairing cannot resurrect old consent.

## 9. Customer, mobile and MSP experience

Reuse existing Connections, installation/setup, partner and MSP workbench surfaces. Show three primary facts: **Remote access**, **Support provider**, **Access granted**. Each has an independent status and recovery action. A healthy connector with missing customer consent is not support-ready. A trusted relationship with a disconnected origin is not remotely reachable.

Mobile setup uses a QR/link with a stable verified company endpoint and bounded invitation, then company authentication. It shows company identity before sign-in; a descriptor is descriptive evidence, not authority. Distinguish wrong company, expired invite, private-network client required, blocked network, origin offline and authentication denied. Offline cached work remains visibly stale and high-risk approvals require current authority. Audit the remaining localhost default and all network callers rather than assuming URL centralization completed provisioning.

Customer support settings show seller separately when different, verified provider, covered sites/assets, actions, technicians, duration and recent activity. Offer Suspend, Remove, Replace and a scoped escalation action. Explain which registry metadata or diagnostic evidence will leave the company before confirmation. Removal must not require the provider's cooperation. The MSP workbench preserves customer/site/asset context beside every action and never offers unapproved bulk targets.

Use existing theme tokens, keyboard order, screen-reader names, generous mobile targets and text status labels. Validate light/dark, empty, denied, disconnected, expired and partially configured states. Keep provider product/account details in progressive setup disclosure; everyday users should not have to understand tunnels, NAT or grant enums.

## 10. Open decisions and scope ownership

| Question | Proposed direction / unresolved nuance | Accountable scope / blocking point |
| --- | --- | --- |
| Which first public forwarding product/account? | Cloudflare candidate; reconcile new platform offering and existing evaluation; retain ngrok fallback | Platform technical recommendation and publisher commercial approval; blocks signup |
| Who owns customer domains, accounts and billing? | Customer/MSP ownership preferred for independence; managed hostname/account optional with transfer terms | Customer/MSP/publisher business agreement; blocks customer enrollment |
| Does publisher receive any MSP-only customer registration? | No legal identity by default; optional minimal pseudonymous projection with explicit purpose | Customer and MSP agreement, plus publisher registry policy; blocks registry field baseline |
| Who may authorize escalation? | Customer-approved standing policy may permit bounded MSP escalation; sensitive operations retain extra gates | Customer business policy; platform only implements enforcement |
| Where does the initial registry run and what availability is promised? | Existing production publisher server behind forwarding, pending feasibility and restore proof; no public dev route | publisher operations owner; blocks pilot launch |
| Which API paths are public/private? | Private operator MCP/internal A2A by default; explicit authenticated customer/federation routes | Platform route-classification/security review; blocks exposure |
| What are registration retention, staleness and offline limits? | Minimal purpose-bound retention; proposed §7 targets need ratification | Data/operations craft plus customer policy; blocks production collection |
| When does managed hosting become necessary? | Earlier of availability commitments, quota/load/cost triggers or G2 review | publisher business/operations owner; blocks expansion past approved envelope |

WWMD resolves platform contracts; WWWD resolves each organization's business commitments; WSID resolves data/security/operations craft. The active installation's unrelated organization mission is not a substitute for publisher or customer decisions. Funding allocation is unresolved on this Workroom; do not infer a token quota or spend authority. Refactoring work below is concrete integration work; its investment allocation belongs to the recorded funding owner.

## 11. Delivery map and sequence

These rows are delivery routing, not a newly approved implementation plan. Existing items keep their own plans, approvals and ownership. Each implementation thread must reconcile overlap, obtain its required scope/plan reviews and bind exact evidence before acting. New items below remain triaging until their own contracts are admitted.

| Order / deliverable | Canonical live item(s) | Dependency / completion evidence |
| --- | --- | --- |
| R0 Reference design capture | BI-2B011C61 under EP-58240092 | This document, source checks, protected publication and durable handoff; no runtime claim |
| R1 Stranded-work evidence recovery | BI-0ED2EDEC under EP-58240092 | §3 inventory completed before reimplementation; reconcile source/PR/deployment evidence with owners |
| R2 Provider/signup and growth decision packet | BI-009CCC19 under EP-58240092 | §§5-7,10; D1-D8 concrete owner choices before external commitments |
| R3 Exposure/security/transport packaging | BI-E2E8BD27, BI-19D3A187, BI-2FAF481C, BI-55F12490; private path BI-CAF86466 | R1/R2; reuse prior security fixes, deny unintended routes/ports and prove connector/host failure behavior |
| R4 Mobile/company off-LAN acceptance | BI-F6A39E36; existing mobile provisioning owner to reconcile in R1 | R3; actual phone on cellular and private-overlay scenario, identity confirmation and reconnect |
| R5 Registry/exclusivity projection | BI-9D674EA7 under EP-58240092 | R1/R2, field audit and authority integration; signed registration, isolation and outage tests |
| R6 Cross-NAT introduction and exchange | BI-26091014; optional application relay BI-D43D3D76 | R3/R5; distinguish reachable introduction from payload routing; no bespoke packet relay |
| R7 Delegated support authority/dispatch | BI-FF04B423, BI-E4E037F2 | Existing Oct12 design D1/D3; identity/scope/revision checks before queued and active work |
| R8 Provider setup, controls and handover | BI-3CC2E798, BI-D07F2DE9, BI-FB8DCBC1 | R5/R7; direct/MSP-only/escalation/replacement runtime scenarios; retain customer independence |
| R9 Purpose-aware integration | BI-AE128860 and existing successor BI-F8E2C191 | Reconcile owner/supersession in R1; profile confirmation never creates grants |

The new R1 item is evidence recovery, not duplicate implementation of delivery-evidence utilities. R2 is procurement/readiness, not a second reachability adapter. R5 supplies registry/discovery privacy across provider boundaries; MSP setup and fleet controls remain R8. Historical EP-MSP-FEDERATION and EP-PARTNER-CHANNEL did not resolve in prior live reads: retain their historical references, never invent replacement state.

Refactoring/integration backlog within the owning slices: converge URL resolution and advertised endpoint revision; reuse one Principal/AuthorityBinding evaluation path; centralize relationship-filtered discovery and projection checks; reuse signed exchange/idempotency/retry handling; remove duplicate/contradictory setup instructions after recovery. Measure removed duplicate paths and preserve parity/negative tests. Do not refactor unrelated modules to manufacture an effort percentage.

## 12. Acceptance, verification and compatibility

| Acceptance ID | Objective IDs | Statement | Verification owner/evidence |
| --- | --- | --- | --- |
| AC-CONN-01 | OBJ-CONN-01 | Every referenced deliverable has an immutable evidence/state entry and next action; retained branches and reviews are checked before replacement work. | R1 recovery ledger and owning-install readback |
| AC-CONN-02 | OBJ-CONN-02, OBJ-CONN-05 | A real phone off LAN reaches the intended company through the chosen third party, authenticates correctly and recovers after connector restart; unintended routes/services fail probes. | R3/R4 served runtime and external-device evidence |
| AC-CONN-03 | OBJ-CONN-03, OBJ-CONN-04 | Signed registration rejects forged/replayed/expired identity and reveals only the relationship-approved fields; another MSP cannot enumerate customers. | R5 API/negative tests and authenticated readback |
| AC-CONN-04 | OBJ-CONN-04 | MSP-exclusive support grants publisher no customer diagnostics or action authority; separately permitted minimal registration matches its consent exactly. | R5/R8 publisher and unrelated-provider negative controls |
| AC-CONN-05 | OBJ-CONN-04, OBJ-CONN-05 | Escalation is scoped, expiring and audited; revoke/replace denies new and queued work and terminates active sessions within the accepted lease bound. | R7/R8 runtime tests including disconnected executor limits |
| AC-CONN-06 | OBJ-CONN-02, OBJ-CONN-03 | Registry/provider outage leaves company local operation usable and shows stale/disconnected remote state; restore preserves identity and consent. | R3/R5 failure and restore rehearsal |
| AC-CONN-07 | OBJ-CONN-02, OBJ-CONN-06 | D1-D8 have named accountable owners, dated provider evidence, account/DNS/credential choices, approved spending ceiling and exit path before signup. | R2 approved decision packet |
| AC-CONN-08 | OBJ-CONN-05 | Setup/support screens pass mobile, keyboard, screen-reader, light/dark and failure-state checks with understandable identity and access summaries. | R4/R8 served UX evidence |
| AC-CONN-09 | OBJ-CONN-06 | The next growth stage passes load, quota/cost, relationship isolation, backup and availability review before expansion; no silent collection cap or all-to-all fan-out. | R2/R5 measured stage report |
| AC-CONN-10 | OBJ-CONN-01, OBJ-CONN-06 | New provider or registry-host migration preserves stable installation identity, scope, revocation and rollback; replaced credentials are retired. | Owning stage migration rehearsal |

Document capture checks cover formatting, local references, generated doc index and source-policy gates. They do not satisfy runtime criteria above. Runtime delivery requires affected unit/API tests and typechecks plus the governed runtime build/served verification. Freeze direct customer, two unrelated MSPs, MSP-only customer, independent install and explicitly escalated customer fixtures. Include CGNAT, blocked egress, provider outage, origin outage, stale endpoint, key rotation, revoke during queued/active work and provider replacement. Record exact software release, provider configuration and observed limitations.

This document adds no schema migration. Later persistent changes require normalized canonical ownership, field/index/retention audit, forward-compatible expand/backfill where needed, old-version behavior and rollback. Existing installs remain opt-in; backfill creates no support grants or public connectors. Discovery caches are disposable projections, not authority backups. Do not remove a provider by tearing down company data or identity.

## 13. Next-thread handoff

Start with EP-58240092 and this design, then read the exact delivery item's current status and R1 evidence. Resolve R2's signup decisions while recovering prior work. Implement the smallest approved end-to-end pilot before a larger registry or transport rollout. Preserve all still-open questions in §10; source-local success, merged documents and process completion never substitute for off-LAN customer acceptance.

At authoring, no new provider account, purchase, DNS change, public exposure, registry deployment or runtime acceptance has occurred. Review/publication state belongs in the Workroom and BI-2B011C61 evidence; subsequent threads must refresh it rather than infer completion from this document's presence.
