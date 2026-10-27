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

**Installation and fleet continuation (2026-10-19):** Registration of identity and relationships must be considered during installation and remain available afterward. A company's production and development installations have separate identities and purposes while belonging to the same company. MSP installations and remote Edge Nodes participate in the same connectivity architecture. Remote identification, discovery and connection are a distinct concern intrinsic to every supported deployment topology, not an optional support-only add-on.

**Mobile relationship continuation (2026-10-19):** One app can serve a customer, an employee, or a person who is both at the same instance. That person may also be a customer, employee or authorized external support technician at other instances. The common connectivity and identity pattern stays canonical; each archetype supplies its own permitted journeys. MSP use is part of this base pattern, not a separate mobile app or an assumption that provider staff are customer employees.

**Failure and continuity continuation (2026-10-19):** Every topology needs explicit failure behavior, especially when an Authority is unreachable. Distinguish loss of the company's own authority from loss of a registry, provider route, identity service, MSP or individual device. Define permitted degraded operation, blocked actions, uncertainty, recovery and operator evidence before calling the connectivity/support pattern ready.

This is the single program reference across the existing connectivity, federation and MSP designs. It governs their integration, evidence reconciliation, provider decision packet and growth triggers. Existing designs still own their detailed contracts. This document does not approve a subscription, accept vendor terms, deploy infrastructure, expose an installation, create support grants or certify a working feature.

**OBJ-CONN-01:** Recover and reconcile prior work into one evidence-backed delivery map without losing source, ownership or review history.

**OBJ-CONN-02:** Provide replaceable third-party reachability for a small initial footprint without requiring publisher cloud infrastructure.

**OBJ-CONN-03:** Discover the correct company and support counterpart while keeping identity, transport, commercial relationships and action authority distinct.

**OBJ-CONN-04:** Enforce direct support, MSP-exclusive support, independent operation and explicitly authorized escalation through customer-owned policy.

**OBJ-CONN-05:** Give operators clear setup, connection, consent and recovery experiences.

**OBJ-CONN-06:** Grow through measured operational and commercial thresholds without changing sovereign customer identity or creating an all-to-all network.

**OBJ-CONN-07:** Establish installation identity, purpose, relationship registration and remote connection during setup and later maintenance for company instances, prod/dev companions, MSPs and Edge Nodes, using each participant's canonical enrollment and authority contract.

**OBJ-CONN-08:** Support customer-only, employee-only, combined customer/employee and delegated MSP mobile contexts per instance, with safe switching across instances and archetype-specific experiences over the same connectivity and authority contracts.

**OBJ-CONN-09:** Contain connection and authority failures without expanding access, losing or duplicating work, confusing uncertain outcomes with failure/success, or blocking unrelated healthy instances and relationships; recover through verified identity, current policy and reconciled durable evidence.

Non-goals: a bespoke NAT traversal stack, a new remote-desktop product, mandatory customer cloud hosting, shared customer databases, automatic publisher access, or a general repair of DPF's delivery process. Existing review/process repairs remain with their owners.

## 2. Canonical references and precedence

| Reference | Continuing responsibility | Reconciliation here |
| --- | --- | --- |
| [Deployment contracts](2026-05-09-deployment-contracts.md) | Runtime configuration, lifecycle, identity, edge, observability, secrets and client/API surfaces; Contracts 2-5, 7-8, 10-12 are affected | Every provider wraps these contracts; no alternate authorization path |
| [Mobile companion and remote access](2026-06-12-archetype-aware-mobile-companion-remote-access-design.md) | Mobile jobs, runtime URL provisioning, principal/device convergence | A remembered URL and descriptor do not establish NAT reachability |
| [Multi-business mobile spaces](2026-06-14-multi-business-town-super-app-design.html) and [field employee mobile](2026-08-06-field-employee-mobile-ai-automation-design.md) | One binary, per-instance spaces and customer/employee journeys | Extend the earlier single-persona presentation to multiple verified relationships at one instance; retain per-instance identity and archetype ownership |
| [Managed services and sovereign peers](2026-06-24-managed-services-delivery-and-cross-org-federation-design.md) | Topology A: MSP-owned customer estates; Topology B: separate company and provider installs | The requested customer-owned server uses Topology B; Topology A remains valid |
| [Federated demand network](2026-07-19-federated-demand-network-design.md) | Minimized exchange, provenance, forwarding and optional application relay | Packet forwarding and application store-and-forward have different responsibilities |
| [Discovery/pairing redesign](2026-08-07-federation-discovery-pairing-redesign.md) | LAN discovery and hub-mediated introduction | Hub introduction alone does not route traffic through two NATs |
| [Public reachability](2026-09-02-install-public-reachability-design.md) | Vendor-neutral exposure contract and optional first provider | Third-party forwarding required initially; no publisher-operated payload relay is assumed |
| [MSP delegated support](2026-10-12-msp-customer-setup-delegated-support-design.md) | External technician authority, setup, dispatch, sessions and revocation | Add the registry/exclusivity contract; retain its authority and UX delivery items |
| [Installation estate identity](2026-08-25-installation-estate-identity-design.md) | Installation identification and purpose presentation | Distinguish company identity from the stable identity and purpose of each production/development instance |
| [Same-organization federation](2026-09-02-zero-configuration-organization-federation-design.md) and [portal-mediated membership](2026-09-03-portal-mediated-organization-membership-design.md) | Durable installation identity, membership proof and trusted same-company pairing | Setup consumes the canonical join package; do not add redundant approvals or make an Edge Node a membership prerequisite |
| [Binding Edge Node contract](2026-05-09-dpf-edge-node-design.md) and [remote provisioning topology](2026-06-19-edge-node-deployment-topology-and-remote-provisioning-design.md) | Machine identity, scoped enrollment, outbound communication and fleet lifecycle | Share reachability infrastructure while retaining node-specific credentials, capabilities and customer/site binding |

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
| Mobile spaces and role/session separation | `apps/mobile/src/stores/spaces.ts`, `packages/types/src/mobile-manifest.ts`, `apps/mobile/src/features/auth/auth.store.ts`, `apps/mobile/src/repositories/SecureStorage.ts` | Spaces/session metadata exist; inspected auth store and secure token keys remain global. Multi-context isolation is not established by the spaces model alone; customer auth, dual roles and MSP support require implementation evidence |
| Mobile failure/replay handling | `apps/mobile/src/hooks/useOfflineStatus.ts`, `useOfflineSync.ts`, `apps/mobile/src/stores/offlineQueue.ts` | Inspected status is one boolean from the selected server's health endpoint; queued records omit original instance/actor/context and flush against current server/token; HTTP errors and network errors share retry treatment. These are source-level gaps against §§4.3-4.4, not evidence of an observed cross-instance incident |
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

### 4.1 Participant identity, topology and route resolution

Use one connectivity approach with typed participants. Each relationship answers separately: **Who is this? Who owns it? What relationship exists? How can an authorized caller reach it? What may that caller do?** Stable identity survives endpoint changes; a DNS name, IP address, tunnel token or display name is not identity proof.

| Participant / relationship | Identity and ownership | Connection direction and route | Authority boundary |
| --- | --- | --- | --- |
| Company production instance | Owning Organization plus its durable installation/device identity; production environment and declared purpose | Approved private route or selected HTTPS forwarding to the production Authority Core | Company policy; a production label grants no action rights |
| Same-company development companion | Same organization membership, different installation ID/key and declared development purpose; explicit companion relationship | Prefer private overlay/LAN; use the shared provider abstraction for cross-site reachability without a public development route | Reuse membership-proof pairing; membership does not authorize direct production mutation or copying all production data |
| MSP's own DPF instance | MSP Organization and installation identity, separate from each customer company | Reachable MSP endpoint or approved private overlay; scoped federation with each customer | External-provider link and customer delegation, never same-company membership to simplify support |
| Customer under an MSP | Customer Organization/installation in sovereign-peer topology; CustomerAccount/CustomerSite estate in MSP-hosted topology | Approved customer/provider route from the shared connectivity stack | Explicit customer/site and projection scope; no cross-customer lateral reach |
| Edge Node at a company/customer site | EdgeNode machine identity linked to Principal/Alias; issued by its owning Authority Core and bound to the appropriate organization/customer/site | Node initiates outbound HTTPS through the Authority's selected forwarding endpoint or private route; heartbeat, telemetry and supported action pull/results use the canonical node channel | Scoped node credentials/capabilities; enrolling or reaching a node grants no shell, desktop or arbitrary network access |
| Mobile/device client | Human/agent-bound identity and device alias/session under company policy | Client reaches its company's verified endpoint using public HTTPS or an enrolled private route | User/agent authorization and independent device revocation |

In sovereign-peer topology, the customer's Authority Core normally enrolls its site's Edge Nodes; the MSP acts through its scoped customer relationship. In MSP-hosted managed-estate topology, the MSP Authority Core enrolls nodes into the correct CustomerAccount/CustomerSite scope. Do not enroll a node into both authorities as a shortcut to direct MSP access; rehoming is an explicit revoke/re-enroll lifecycle with historical audit retained.

Remote identification and route resolution form a shared integration contract above existing canonical records, not a universal credential or registry table. Reuse identity and endpoint/projection ownership; audit field gaps before adding types. Installation, Edge Node and mobile records retain their separate lifecycle and token namespaces, as required by the binding Edge Node design. A combined fleet view is an authorized read projection, not merged enrollment storage.

### 4.2 Edge and companion connectivity contract

An Edge Node behind NAT normally needs no inbound port, per-node public hostname or separate tunnel: it reaches its Authority through the same approved third-party/private path used by other clients. To identify or operate that node remotely, the authorized operator resolves its stable node identity within the owning Authority's scoped fleet and uses the existing governed node channel. A provider cannot turn an address lookup into direct access to the host's services. Interactive sessions or private-network gateway capabilities require their own explicit capability, customer consent, bounded credentials and termination evidence.

Keep endpoint revision, credential rotation, reconnect/backoff and status terminology consistent across adapters. Transport failure is distinct from unknown identity, membership refusal, missing support consent, wrong customer/site, revoked node and unsupported capability. Shared provider failure may affect many participants; show that common cause without merging their permissions. A route change must revalidate destination identity and preserve audience/scope; production/development names must never silently redirect a node to the wrong Authority.

The prod/dev pair is a required reference topology, not a special hardcoded installation. Test it on the same LAN and across different NATs. Use each install's operating-purpose contract and existing source-owned work boundaries. A development companion is neither a copy of the production identity nor an external MSP. Customer and MSP installs must support these same companion and scoped-edge patterns without inventing a second connectivity stack.

### 4.3 One mobile app, multiple relationships per instance

Treat the app's business/instance selection and its active relationship there as separate dimensions. The company endpoint, identity verification and transport are shared; customer, workforce and external-provider permissions are independently verified by that instance. The following are conceptual contexts, not proposed new persona enums or tables. Audit existing Principal/Alias, customer-contact, workforce, manifest and delegated-authority contracts before changing their representations.

| Verified relationship at the selected instance | Mobile experience | Permission boundary |
| --- | --- | --- |
| Customer only | Public/visitor functions where permitted, then the person's own customer account, requests, bookings or purchases | Customer relationship authorizes only the applicable customer objects/actions; an anonymous visitor has no authenticated customer rights |
| Employee only | Assigned work, approved business operations and workforce actions selected by the archetype | Current company membership and workforce grants; connecting the app grants no customer-account identity automatically |
| Both customer and employee | Both contexts remain available, with clear selection or action-level context; switching need not require signing out where identity linkage is verified | One verified person may have both relationships; each action states and validates the applicable context. Do not merge customer and employee permissions into a universal role |
| Employee of business A, customer of business B | Reuse the installed app and familiar connection journey; B presents its own branding, customer experience and sign-in | A's login, tokens, employment or provider cannot create B membership or reveal A data to B |
| MSP employee supporting customer C | MSP workforce view for their own employer, then a visibly identified support target/customer/site under C's delegated envelope | MSP affiliation plus current customer delegation; the technician is an external provider at C, even if also a personal customer or separately employed there |

Inside one instance, verified linking may connect customer and workforce aliases to the canonical person where the existing model permits it. Matching email, phone, device or display name is insufficient to link identities or acquire a second relationship. Across sovereign instances, keep install-local principals and audience-bound sessions; the app's convenience is not a global customer identity provider. Shared sign-in may later use an explicitly trusted optional upstream identity service, but it is not a prerequisite or authorization inherited from another business. Profile/contact reuse between businesses is separately opt-in and must state which facts are shared.

Every protected operation must resolve the intended instance/issuer, authenticated principal, active authorized relationship and object scope. Customer-account identity and support/customer/site targets come from verified server context, not an untrusted mode toggle. Customer mode must not silently call an employee endpoint using broader staff authority. A displayed mode is an experience choice; the server still enforces current grants, ownership, delegation, revocation and any required step-up confirmation. Employment ending removes workforce access without deleting an otherwise valid personal customer relationship. Support delegation can expire independently of both.

Partition secure sessions, query caches, files, drafts, offline mutations and notification registrations/routing by the actual instance, authenticated account/principal and applicable context/scope. Exact storage keys and token strategy belong to the reviewed mobile implementation; do not prescribe duplicated credentials when one server-validated context can provide the boundary. A mode/instance switch cancels or fences in-flight responses before rendering the new context, refreshes the server-authorized manifest and excludes stale navigation/data. Persisted work retains its original instance, actor, context, target and idempotency identity; it is never retargeted to whichever business is active at replay time. Require current authorization before replay, and visibly hold rejected/expired work for recovery.

Push and deep links identify the intended business and context without disclosing sensitive lock-screen content. Opening a notification for another instance/context requires selecting and validating that context, with reauthentication when required; it must not execute an approval under the currently active company's session. A disconnected private workforce/support route does not imply the public customer route is broken, and a public storefront route must not expose employee or MSP administration. One instance can therefore have audience-specific route descriptors under the shared transport abstraction, with server identity verified on every permitted route and no credential forwarding to arbitrary redirect targets.

The archetype chooses vocabulary, navigation, job packs/forms, public/customer/workforce features and action policies using the existing server-owned manifest/capability and authorized-surface pattern. It does not redefine enrollment, transport, principal convergence or relationship authorization. For example, a retail customer may view their purchases while a retail employee works stock; a field-service customer may request a visit while an employee completes an assigned job; an HOA member may submit a request while an authorized worker performs inspections. These are design examples, not claims that every journey is implemented. MSP support is a scoped operational projection with separately approved actions, not an all-purpose admin mode.

### 4.4 Failure, degraded operation and recovery

**Unreachable does not mean unauthorized, and neither means the action failed.** A connection timeout can occur before a request arrives or after it committed. An HTTP health response proves neither the caller's authorization nor the availability of the required database, policy check or action executor. Keep network, dependency, identity/trust, authorization and business-operation outcomes distinct. Evaluate them per instance, route, context and required dependency; one device-wide online flag cannot describe the entire fleet.

**Authority loss is not authority transfer.** A registry, relay, MSP, development companion, mobile cache or Edge Node cannot become the company Authority because the primary is offline. Additional customer autonomy must already exist in a reviewed policy; support personnel cannot grant it to themselves during an outage. Failover to another authoritative replica requires a separately approved replication/fencing/recovery design, not a DNS change or promoting the dev copy. Distinguish redundancy of the connector from redundancy of the company server/database.

| Failure scenario / consequence | Containment and degraded behavior | Recovery evidence / accountable delivery |
| --- | --- | --- |
| Company Authority Core unreachable; employee/customer/MSP cannot obtain authoritative results | Preserve policy-permitted cached reads and local drafts, visibly stale; hold live transactions and operations requiring current authority. Reachability of other businesses is unaffected | Confirm destination identity and current authorization before reconciliation; R3/R4/R7/R11 |
| Publisher registry/introducer unavailable; remote lookup or new pairing unavailable | Previously verified company routes and local company work continue where their own authority dependencies are healthy. Cache only permitted coordinates with explicit freshness; hold registration/new discovery | Retry bounded signed registration; revalidate stale endpoint/relationship; no alternate identity inference; R5/R6 |
| Forwarding provider/DNS/connector fails; origin may still be healthy | Show remote-path unavailable/unknown, not assumed company data loss. Existing approved LAN/private route may be used after identity verification; no automatic public exposure or insecure TLS fallback | Separate origin/connector/provider observations; restore approved route, keep stable identity and consent; R2/R3 |
| MSP or MSP affiliation/authority service unavailable; support assurance cannot be refreshed | Customer standalone work continues. No new support action if a required identity, standing or delegation cannot be verified; only already-issued bounded authority remains eligible under its policy | Refresh affiliation/link/customer delegation before resuming; no fallback from MSP-exclusive support to publisher administration; R7/R8 |
| One Edge Node/site unreachable; management and recent telemetry missing | Other sites remain usable. Mark that node's evidence stale; retain approved bounded collection/buffer behavior, deny new principals/scopes and expired actions | Reauthenticate the node, reconcile sequences/results, apply revocation and current site scope before accepting uploads or work; R7/R10 |
| Identity provider/session refresh/policy dependency unavailable while portal answers | Separate sign-in failure from portal health. Existing session validity follows the customer's approved contract; no invented credentials, indefinite session extension or offline privilege elevation | Recover through an already configured identity/recovery path and verify issuer/audience/current grants; R4/R7/R11 |
| Request times out after server may have committed, including bookings, payments or remote commands | Mark outcome unknown and retain the operation identity. Do not blindly repeat a charge, reservation, approval or host action, or mark a local draft complete | Query/reconcile durable operation/result and any external processor receipt through its canonical owner; retry only with the original idempotency contract; R4/R7/R11 |
| Relationship revoked, session expired or policy changed during partition | Client cannot know a remote revocation instantly. Existing delegated work is limited by its issued expiry and revocation contract; new privileged work cannot start on stale rights | Customer authority rejects revoked/expired work at acceptance/claim/execution; offline executor stops by lease expiry and later acknowledges; R7/R8 |
| Wrong instance/issuer, stale DNS, restored clone or compromised endpoint | Stop credential forwarding and action replay; quarantine that connection while unrelated contexts remain available. Do not trust matching display name, domain or email as recovery proof | Verify durable identity/trust chain and endpoint revision through approved rotation/recovery; R5/R10/R11 |
| Queue/cache full, corrupted, unavailable or device lost | Stop accepting work that cannot be durably stored; show unsaved state and recovery options. Bound encrypted local data and retention; no silent eviction of unsent evidence or cross-context fallback | Recover/export only permitted local work, report explicit loss/gaps, revoke lost-device credentials via the owning authority; R4/R10/R11 |
| Reconnect storm, quota/rate limit or slow dependency | Backoff with jitter and Retry-After where provided; bound concurrency, per-customer queues and work age. Keep one tenant/site from starving others; never retry authorization denials as network outages | Observe backlog age/size, retries and dependency status; stagger replay and reconcile operations; R2/R3/R5/R10/R11 |
| Authority restored from backup or two writers claim authority; revisions/idempotency history may disagree | Fence the stale/duplicate writer and hold consequential replay. No automatic dev takeover, permission rollback or claim that restored data includes later receipts/revocations | Approved restore reconciles identity, keys, revocation/consent revisions and external side effects; test recovery-point gaps and audit continuity; owning installation/backup delivery with R1/R7/R10 |

#### What may continue without a live Authority

| Operation class | Allowed degraded behavior | Boundary |
| --- | --- | --- |
| Previously cached customer/workforce reads | Only cache that context's policy permits; show last verified time and read-only status | Sensitive data may require online access or a shorter cache lifetime. Logout/revocation/device policy governs local removal; no claim of immediate remote wipe while disconnected |
| Employee field notes, photos or form drafts | Capture locally only for archetype-approved offline actions with durable protected storage and explicit pending state | Submission is not accepted work until the company acknowledges it; no guaranteed persistence when storage is unavailable |
| Customer transaction intent | Keep a draft/request where permitted; do not promise booking, stock, price, payment or fulfillment | On reconnect revalidate availability/price/version and obtain renewed confirmation if terms changed or the intent expired; do not silently execute a stale purchase |
| Edge heartbeat/discovery/policy cache | Follow the binding Edge Node per-scope soft-fail contract: known scopes only, with its existing windows and bounded local buffering | Heartbeat tolerance is not unlimited authority or queue capacity. Binding defaults distinguish discovery submission (24h), policy cache (1h), and MCP/A2A gateways (0: deny); timer enforcement must be verified, not inferred from the spec |
| New grants, identity enrollment, high-risk approvals, privileged support/gateway actions and new interactive sessions | Wait for the required live authority and existing gates | No offline approval or mode switch mints authority. Previously issued actions/sessions only continue where the existing customer policy explicitly allows them, within the already-issued lease |

Existing scopes keep their owning offline contracts; this table does not broaden them. Local observation, an unsent intent, an accepted operation and a verified result are different facts. Different archetypes can permit different offline forms/read caches, but they cannot turn local drafts into inventory, financial, booking or authorization truth. If a use case requires continuous local transactions during company-server failure, that is an explicit additional business-continuity design with replicated authority and conflict policy, not an implied mobile feature.

#### Recovery protocol and uncertainty

1. **Retain original context and intent.** Persist operation ID, original instance/issuer, actor, relationship, target, creation/expiry and version/consent reference where applicable. Store the payload securely within its allowed capacity/retention. A transport retry does not create a new business operation.
2. **Classify the response.** Connection failure/dependency 5xx, rate limit, authentication expiry, authorization refusal, validation rejection, version conflict and unknown execution require different remedies. Authenticate again only through a verified issuer; do not automatically retry 403, invalid data or expired consent. A conflict requires reconciliation, not overwriting the server.
3. **Verify before reconnecting.** Prove server identity, intended environment, current session/relationship, target scope and required dependency health. Re-read current policy, revocations, operation receipts and object versions before dispatching held work. A healthy `/api/health` alone never triggers unqualified replay.
4. **Reconcile unknown outcomes first.** Ask the canonical operation/result owner using the original identifier. Idempotency requires durable server deduplication and retention compatible with the retry horizon, not just a client-generated ID. If authoritative history is unavailable or expired, keep outcome unknown for accountable reconciliation rather than choose success or duplicate execution.
5. **Replay eligible work gradually.** Use original actor/context/target and current authorization; expire or reject incompatible work visibly. Independent operations may proceed while a dependent chain is held. Cancellation distinguishes not sent, cancellation requested, confirmed cancelled and already committed; a cancelled client request cannot undo a completed server action.
6. **Report the recovered state.** Separate locally saved, waiting to send, sent/outcome unknown, accepted/processing, verified complete, rejected/conflicted, expired and cancelled in the read projection. Keep source times, receipt IDs, retry decisions and any remaining gaps auditable; do not create a second generic lifecycle table when existing operation records can project them.

Each owning slice must define deadlines/timeouts, cache age, allowed offline action classes, maximum queue bytes/items/age, idempotency retention, retry/concurrency limits and session/action lease duration before release. Lease clocks must not reset on process restart, retry or wall-clock rollback; an untrustworthy clock cannot extend authority. Revocation has a measurable maximum disconnected-executor window, with pending acknowledgement visible; it cannot undo changes already performed. The current design does not assign fabricated universal durations or claim these mechanisms are implemented.

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

Fleet planning also counts company instances, companion instances, Edge Nodes per customer/site, mobile clients, concurrent sessions and telemetry separately. Do not assume one Edge Node equals one billable tunnel or require all employees/nodes to join a provider mesh when an outbound HTTPS path suffices. Include node heartbeat/action-pull fan-in, telemetry cardinality and per-customer quotas in G1/G2 capacity reviews; use jitter/backpressure and incremental fleet projections. Introducers expose only eligible counterpart candidates, never the entire prod/dev/MSP/node topology to every participant.

Count mobile devices, verified relationships and concurrent authorized contexts separately: customer+employee at one business does not inherently need two devices or two tunnels. Provider seat/resource billing still follows the selected vendor's terms; workforce/private support connectivity may have different costs and enrollment requirements from public customer access.

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

Company membership/enrollment and external publisher support registration are separate choices. A company may establish its prod/dev relationship and enroll Edge Nodes while declining external support registration. An MSP may register its own provider identity without publishing its customers or every customer's node inventory. Node identity and health remain at the owning Authority unless a permitted projection explicitly shares them. Environment/purpose and owning-authority identifiers must accompany authorized instance/fleet views so operators can distinguish production, development, provider and customer targets remotely.

| Arrangement | Registry/discovery visibility | Support authority |
| --- | --- | --- |
| Direct publisher | Customer-approved publisher registration and scoped operational projection | Customer-approved publisher technicians/agents only |
| MSP-exclusive | MSP sees its customers; publisher sees the MSP and only separately permitted minimal/pseudonymous downstream registration, if any | Selected MSP only; publisher relationship does not inherit access |
| Explicit escalation | Selected issue/evidence and temporary counterpart identity, within the approved audience | Bound operations/targets/expiry; customer policy and existing additional gates still apply |
| Independent | No required support registration; any community participation follows its own agreement | Company only |

An MSP-exclusive install need not reveal its legal customer identity to publisher merely to consume open-source software. If central minimal registration is chosen as a service condition, disclose precisely what publisher learns and offer the independent mode. Decide that commercial condition explicitly; do not encode it as implied technical necessity. Registered MSP standing allows recognition, not access to all customer installs. No unrelated MSP can enumerate another MSP's customers.

Introductions and forwarding remain opt-in and constrained by their existing contracts. Audit `introductions.ts`, `channel-demand.ts` and `cross-org-sharing.ts`: platform-demand sharing, customer-identity disclosure and support-access escalation are three separate permissions. A public platform bug may be shared without opening the customer's diagnostics or business data; customer/provider identifiers in that bug must still follow its permitted projection. Revoked relationships invalidate cached discovery/projection eligibility and pending escalations. Re-pairing cannot resurrect old consent.

## 9. Customer, mobile and MSP experience

### Installation and later relationship setup

The installer/first-run journey must offer **Create a company**, **Join this company's existing installation group**, and **Set up with a support provider**, with an **Add or finish connections later** path. These are entry intents into the existing setup journey, not new authorization roles. The organization step establishes or verifies company identity; a separate instance step declares this installation's label, environment and purpose. Joining imports/verifies the existing organization package rather than asking a person to retype peer URLs/tokens or approve already-proven same-organization membership again. Same-company pairing still requires a usable route; setup must surface a route failure rather than claim success from membership alone.

For the prod/dev example, show the verified production company/instance as the proposed companion, this distinct development identity and its intended role, selected private connectivity, permitted synchronization and outstanding verification. Preserve the canonical owner of each mirrored record. Restoring the same installation preserves its durable identity; cloning a second installation must mint a distinct identity and must not clone active node/instance credentials.

Support registration is a separate section: identify seller/provider, direct versus MSP-exclusive arrangement, registry audience, data shared and permission duration. Offer a provider-issued invitation or verified add-later route; confirmation of a relationship candidate grants no support authority. An MSP installation uses the same journey for its own company and then adds customer relationships with their own consent. Present company membership, connection health and support readiness as separate outcomes.

**Add an Edge Node** is an explicit option within the existing node provisioning flow, during setup or later. Select owning Authority and company/customer/site, inspect the node purpose/capabilities and issue the canonical bounded bootstrap package with the correct reachable Authority endpoint. The remote installer confirms the intended Authority identity before enrollment. The server derives scope from issued enrollment material, never a node's self-declared customer/site. Display pending enrollment, awaiting required trust, connected, limited, offline, quarantined and revoked states through existing node lifecycle projections. Do not create a full company install or employee account for a node, or require an Edge Node just to join two company instances.

Show a simple relationship summary before completion: **Company -> this instance and purpose -> companion/provider -> covered sites and nodes**, filtered to the operator's rights. Provide explicit resume/retry for unavailable internet, blocked provider egress, wrong-company package, expired invite, duplicate/clone identity and incorrect site. One successful component does not turn the whole setup green. Existing installs can reach the same options through Connections and fleet/settings surfaces; unattended installers use the same typed contract and return pending steps for later completion without silently registering externally.

### Ongoing connection and support views

The mobile header/switcher must make **Business/instance**, **Using as Customer / Employee / Support**, and any **Support target and site** legible. Offer only server-verified contexts. Customer-only users should not encounter a disabled employee dashboard; dual-role users can move between their valid contexts without reconnecting the business each time. A technician working in the MSP's employee context must explicitly enter the permitted customer support context before consequential action. Preserve personal/customer drafts and privacy when returning to workforce work; never silently choose the most privileged context as a default.

Each context gets the relevant archetype home rather than a union of every tab. A salon/retail customer, field employee and MSP technician may need different first actions while sharing the same business connection and mobile shell. Clearly label the actor/context before checkout, record submission, approval or support changes; apply additional confirmation only where the existing risk policy requires it. Losing one relationship shows its specific remedy while retaining other valid contexts. Test screen-reader labels, keyboard/focus order and accessible context indicators; color or a small avatar alone is insufficient.

Failure screens name the affected business/context and observed problem: **Company server unreachable**, **Remote connection unavailable**, **Sign-in required**, **Access no longer permitted**, or **Result not yet confirmed**. When the cause is unproven, say it is unknown and offer scoped diagnostics; a timeout alone does not diagnose the firewall, vendor or server. Show last successful verification, what is locally saved, what is waiting/uncertain, and the next permitted action. Do not show a generic success toast for queued work or a blanket offline banner over healthy businesses. Provide accessible stale/expiry/pending indicators, deliberate retry and original-context review. A preconfigured support contact/manual continuity route may remain readable during outage, but it does not acquire system access.

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
| How do instance/edge installation packages resolve their Authority remotely? | Reuse organization join material and node bootstrap; stable identity plus audience-scoped endpoint revision; private development routes | Platform installation/federation and Edge Node owners; blocks remote setup acceptance |
| How are clone, restore and Authority handover distinguished? | Preserve identity only for restore of the same installation; distinct clone identity; explicit node rehome with revoke/re-enroll | Identity/installation and customer operations owners; blocks fleet lifecycle release |
| How are multiple mobile relationships represented and selected? | Extend canonical spaces/manifest/auth contracts after auditing single-persona/global-session assumptions; server-validated context with least-privilege defaults | Mobile/identity platform owners; blocks dual-role release |
| Can a person reuse sign-in or profile facts across businesses? | Per-instance sessions first; optional trusted upstream sign-in or consented profile reuse must be separately designed and approved | Each business's identity/data policy; no automatic global customer identity |
| Which mobile actions may an MSP technician perform? | Scope to the customer's approved support projection and actions; separate from technician's own employee/customer relationships | Customer delegation and MSP operating policy; blocks mobile support enablement |
| Which actions/data remain usable offline, and for how long? | Per-archetype action/cache policy within platform authority invariants; reuse binding Edge Node windows rather than a global offline bypass | Customer operations/data policy and mobile/edge craft owners; blocks degraded-mode release |
| What bounds unknown outcomes, replay and disconnected revocation? | Measured timeouts, queue/retention budgets, durable idempotency horizon, clock-safe leases and receipt reconciliation | Each operation owner with security/operations review; blocks consequential replay and session enablement |
| What are the accepted recovery point/time and writer-fencing arrangements? | Explicit local-server restore and provider/registry recovery acceptance; HA authority/failover only under its own approved design | Company operations and publisher/MSP service commitments; blocks stronger availability promises |

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
| R10 Installation identity/relationship and scoped fleet connection | BI-9D674EA7 for registration/visibility integration; R9 for instance purpose; BI-BB919901 for node-install access/distribution; canonical Edge Node provisioning/lifecycle owner reconciled in R1 | §§4.1-4.2,9; reuse existing join/bootstrap writers; verify prod/dev, sovereign MSP and MSP-hosted scoped nodes before claiming setup readiness |
| R11 Mobile multi-relationship context integration | R4 mobile owner for spaces, customer/workforce auth and sessions, reconciled in R1; BI-9D674EA7 for discovery/context projection; BI-FF04B423 and R8 for external MSP delegation | §4.3,9 and AC-CONN-14..16; source references BI-MOBAPP-SPACES, but live lookup returned authority_evidence_unavailable on 2026-10-19, so owner/status remain unverified. Recover that work before creating a duplicate mobile implementation item |
| R12 Failure/continuity integration and acceptance | Existing R3/R4/R5/R7/R8/R10/R11 owners; BI-9D674EA7 owns relationship/discovery failure projection, BI-E4E037F2 owns support dispatch/lease revocation, BI-FB8DCBC1 owns MSP runtime acceptance; R1 resolves mobile offline/restore owners | §4.4 and AC-CONN-17..20; failures are acceptance obligations in each owning slice, not a new parallel recovery engine |

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
| AC-CONN-11 | OBJ-CONN-03, OBJ-CONN-05, OBJ-CONN-07 | Fresh and existing installs can establish company identity, distinct instance purpose, verified prod/dev membership and optional provider registration through one resumable setup contract; membership alone grants no production mutation or external support access. | R9/R10 installer/API and served setup evidence, including wrong-company and offline cases |
| AC-CONN-12 | OBJ-CONN-02, OBJ-CONN-04, OBJ-CONN-07 | Remote Edge Nodes enroll into the intended Authority/customer/site and reconnect through approved shared connectivity without inbound node ports; unauthorized MSP, wrong site, revoked enrollment and unsupported actions are refused. | R7/R10 remote-site runtime evidence for both MSP topologies |
| AC-CONN-13 | OBJ-CONN-03, OBJ-CONN-06, OBJ-CONN-07 | Same-install restore, distinct prod/dev clone, endpoint rotation and node rehome preserve identity/audit boundaries; fleet views identify role, Authority and scope without exposing unapproved customer or node topology. | R5/R10 lifecycle, negative visibility and migration evidence |
| AC-CONN-14 | OBJ-CONN-03, OBJ-CONN-05, OBJ-CONN-08 | One app supports customer-only, employee-only and verified dual-role access at one instance, plus employee-at-A/customer-at-B, without granting a relationship from matching identity claims or inheriting another company's rights. | R11 identity/API and served mobile scenarios across at least two archetypes |
| AC-CONN-15 | OBJ-CONN-04, OBJ-CONN-05, OBJ-CONN-08 | Context switches, in-flight responses, caches, offline replay, push/deep links and expired relationships preserve instance/actor/context/target boundaries; employee revocation retains independently valid personal customer access. | R11 negative/concurrency/offline and device notification evidence |
| AC-CONN-16 | OBJ-CONN-04, OBJ-CONN-05, OBJ-CONN-08 | An MSP employee can use their own company's workforce context and explicitly enter a customer's delegated mobile support context; unrelated customer, personal/customer-mode and revoked-support actions cannot acquire that delegation. | R7/R8/R11 scoped MSP mobile runtime and accessible context-switch evidence |
| AC-CONN-17 | OBJ-CONN-02, OBJ-CONN-05, OBJ-CONN-09 | Company-authority, registry, forwarding, identity-service, MSP and node failures produce scoped evidence/state and permitted degraded behavior without blocking unrelated healthy contexts or transferring authority to a dev instance, relay or provider. | R12 dependency-isolation runtime matrix and accessible failure-state evidence |
| AC-CONN-18 | OBJ-CONN-04, OBJ-CONN-08, OBJ-CONN-09 | Offline reads/drafts and existing node/session leases obey approved scope, expiry, storage and clock/restart limits; no new privileged grant/session starts from stale policy, and independent customer/employee/support revocation is preserved. | R7/R10/R11 partition, clock, restart, cache and lease-bound negative tests |
| AC-CONN-19 | OBJ-CONN-03, OBJ-CONN-04, OBJ-CONN-09 | Timeout-after-commit, duplicates, conflicts, cancellation and reconnect replay reconcile original durable operation/receipt identity and current authorization; uncertain, rejected or expired work never becomes an unverified success or a duplicate side effect. | R4/R7/R11 server/client fault injection, including authoritative history unavailable |
| AC-CONN-20 | OBJ-CONN-01, OBJ-CONN-06, OBJ-CONN-09 | Each release has explicit offline/cache/queue/retry/idempotency/lease and recovery-point/time bounds plus observed outage/restore/reconnect-storm evidence; unmet safety or continuity criteria restrict pilot rollout and availability claims. | R2/R12 recorded limits, restore rehearsal and accountable residual-risk review |

Document capture checks cover formatting, local references, generated doc index and source-policy gates. They do not satisfy runtime criteria above. Runtime delivery requires affected unit/API tests and typechecks plus the governed runtime build/served verification. Freeze direct customer, two unrelated MSPs, MSP-only customer, independent install and explicitly escalated customer fixtures. Include CGNAT, blocked egress, provider outage, origin outage, stale endpoint, key rotation, revoke during queued/active work and provider replacement. Record exact software release, provider configuration and observed limitations.

Add a same-company production/development pair, one mobile device and multiple Edge Nodes at two customer sites to that fixture set. Test same-LAN and cross-NAT pairing; interrupted first install and add-later completion; expired/wrong-company packages; two sites using overlapping private addresses; a node pointed at the wrong Authority; remote identity/status lookup; and revoked node action pull. These checks are required even when no publisher support relationship exists. The shared transport is successful only when each participant's own enrollment, scope and revocation behavior also holds.

Mobile fixtures also need a customer-only person, employee-only person, dual-role person at one instance, employee of A/customer of B, and MSP technician who is independently a customer of a supported business. Exercise background responses during switches, queued work under expired authority, notifications arriving for an inactive instance/context, issuer/redirect confusion, independent customer/workforce/support revocation and archetype manifest changes. Server negative tests must prove that hiding a tab or changing a client persona is not the authorization control. Source inspection alone does not establish these isolation properties.

The failure matrix must inject loss of each dependency independently, including a healthy portal with unavailable policy/database/action dependency; a split where the phone is offline but Authority/Edge remain online; and a split where the Authority is lost but mobile internet/other instances still work. Exercise timeout before arrival and after durable commit, lost response/result acknowledgement, duplicate/late/out-of-order delivery, 401/403/409/429/5xx, expired/revoked context during partition, clock rollback/restart, storage exhaustion/corruption, Authority restore with missing recent receipts, endpoint identity mismatch and simultaneous reconnect across sites. Observe both business side effects and server/device state; do not infer at-most-once behavior from a client retry count. Gate each owning slice on the relevant scenarios and record residual risks; no fault-injection result is claimed by authoring this section.

This document adds no schema migration. Later persistent changes require normalized canonical ownership, field/index/retention audit, forward-compatible expand/backfill where needed, old-version behavior and rollback. Existing installs remain opt-in; backfill creates no support grants or public connectors. Discovery caches are disposable projections, not authority backups. Do not remove a provider by tearing down company data or identity.

## 13. Next-thread handoff

Start with EP-58240092 and this design, then read the exact delivery item's current status and R1 evidence. Resolve R2's signup decisions while recovering prior work. Implement the smallest approved end-to-end pilot before a larger registry or transport rollout. Preserve all still-open questions in §10; source-local success, merged documents and process completion never substitute for off-LAN customer acceptance.

At authoring, no new provider account, purchase, DNS change, public exposure, registry deployment or runtime acceptance has occurred. Review/publication state belongs in the Workroom and BI-2B011C61 evidence; subsequent threads must refresh it rather than infer completion from this document's presence.
