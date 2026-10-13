---
status: draft
---

# MSP customer setup and delegated support

**Date:** 2026-10-12
**Status:** Researched design; independent approval and implementation pending.
**Scope owner:** DPF platform for reusable authority/edge hardening; IT Managed Services for the provider operating experience. Customer organizations own their support consent and business policy.
**Archetype:** `it-managed-services`, category `professional-services`. Customers retain their own archetype.
**Coordination:** BI-AE128860 / WC-D41BBB6E. This is the bounded MSP successor scope, not a replacement for its development-companion increment.

## 1. Problem and existing architecture

A reseller can install DPF for a customer, but attribution, provider pairing, external technician access, customer consent, and edge operations need one understandable setup and support lifecycle. Identifying the seller cannot implicitly authorize that company to administer the customer. The provider must serve multiple customers from its own instance without becoming their employee or acquiring unrelated business data.

This addendum extends [managed-services federation](2026-06-24-managed-services-delivery-and-cross-org-federation-design.md), [partner identity](2026-06-04-partner-reseller-archetype-identity-design.md), and the [MSP channel path](2026-07-22-local-msp-channel-readiness-path.md). Those documents own the wider topology and commercial program. Historical DONE/OPEN labels in them are not current runtime evidence.

Source inventory at commit `8156f50dc5b1670f2e5405aeee6a5eb309ac25fa`:

| Existing substrate | Use and constraint |
| --- | --- |
| `packages/storefront-templates/src/archetypes/professional-services.ts` | Existing IT Managed Services leaf, managed-service-provider activation profile and offers; no new MSP archetype or customer reclassification. |
| `packages/db/prisma/schema/crm-commerce.prisma`: PartnerAccount, PartnerAgreement, PartnerEntitlement, PartnerSupportRoute | Commercial provider identity, standing, terms, offering entitlement and support routing. Commercial rights are not runtime administration grants. |
| `apps/web/lib/identity/principal-linking.ts`, partner principal tests | External technician identity converges on Principal and aliases; never create EmployeeProfile for support convenience. |
| `packages/db/prisma/schema/core-identity.prisma`: AuthorityBinding, subjects and grants | Extend the canonical authorization contract after a field/grant audit; no second MSP permission table or password store. |
| `packages/db/prisma/schema/edge-federation.prisma`: FederationLink, ProjectionContract, FederatedRemediationProposal, RemoteAction | Dual-approved link, permitted egress and customer-executed proposals. Link principal identifies the peer, not the individual technician. |
| `apps/web/lib/federation/remediation-consent.ts` | Already permits automatic customer execution when the customer's own policy allows the action band. Provider policy cannot grant that permission. |
| `apps/web/lib/remote-action/dispatch-orchestrator.ts`, `apps/web/lib/edge-node/scope.ts` | Scoped edge pull/claim/results and signed envelopes. Enrollment is independent of action authorization. |

Live ownership: EP-0AC73AEA owns IT Managed Services readiness, with BI-ACC0D04A as its baseline. EP-1FABA22D owns shared installation/federation coordination. Queries for historical EP-PARTNER-CHANNEL / EP-MSP-FEDERATION did not resolve in this install; do not fabricate or recreate their IDs. Some historical item reads returned `authority_evidence_unavailable`, so their current state remains unknown. Refresh overlap before implementation and reconcile any rediscovered owner instead of implementing twice.

## 2. Research & Benchmarking

Primary sources inspected on 2026-10-12; mutable upstream branches describe that inspection, not pinned dependency versions. No package, service or subscription is adopted by this design.

| Comparator and inspected contract | Pattern absorbed | Pattern rejected / DPF difference |
| --- | --- | --- |
| [MeshCentral source](https://github.com/Ylianst/MeshCentral/blob/master/meshuser.js), consent and MESHRIGHT/SITERIGHT definitions | Different permissions for remote control, terminal, files and administration; separate user notification/consent flags. | A broad administrator bit must not stand in for customer-specific delegated permission. Translate only an already-authorized DPF action to a provider capability. |
| [Tactical RMM client models](https://github.com/amidaware/tacticalrmm/blob/develop/api/tacticalrmm/clients/models.py) and [account models](https://github.com/amidaware/tacticalrmm/blob/develop/api/tacticalrmm/accounts/models.py) | Client -> Site ownership, expiring deployment record, role capability flags and client/site visibility relations, individual mesh user identity. | Its centralized estate is a comparator for Topology A, not authority to merge sovereign customer databases into the MSP. DPF's Principal remains the identity home. |
| [Microsoft GDAP relationship workflow](https://learn.microsoft.com/en-us/partner-center/customers/gdap-obtain-admin-permissions-to-manage-customer) | Customer-visible relationship, requested granular roles, bounded duration and customer acceptance. | Do not copy Microsoft-specific role vocabulary or require Microsoft accounts. A sales relationship never substitutes for customer authorization. |
| [ConnectWise ScreenConnect role permissions](https://docs.connectwise.com/ScreenConnect_Documentation/Get_started/Administration_page/Security_page/Define_user_roles_and_permissions/List_of_role-based_security_permissions) | Remote-session consent and session capabilities are distinct controls. | Unattended endpoint access is not a prerequisite for ordinary DPF support. Clipboard, files, terminal, input and elevation require explicit permissions. |

[NIST SP 800-207](https://csrc.nist.gov/pubs/sp/800/207/final) supplies the zero-trust reference: authenticate and authorize the subject and action rather than treating site/network placement as permission. DPF applies this at the customer boundary and again at dispatch. The HiHop reference in the request is an analogy; its exact product behavior was not verified and is not used as a contract.

Alternatives evaluated: (A) shared customer-admin login, rejected because it loses individual attribution and revocation; (B) separate MSP control plane and permission store, rejected because it duplicates existing authority and edge contracts; (C) canonical partner identity + customer-scoped delegation + federation + customer execution, selected because it composes existing boundaries and supports both topologies. No settled customer business policy is inferred from platform direction.

## 3. Objectives

**OBJ-MSP-01:** Reuse and harden a single customer-owned authorization path for identified external technicians across DPF, federation and edge operations.

**OBJ-MSP-02:** Let customer setup identify the seller and support provider, pair the provider instance, and obtain explicit limited support consent without employee membership.

**OBJ-MSP-03:** Run permitted edge and endpoint work with current authority, isolated scope, bounded sessions, and verifiable revocation.

**OBJ-MSP-04:** Give customers and MSP technicians clear support controls and operational fleet views using existing UI primitives.

**OBJ-MSP-05:** Prove the complete lifecycle on the served runtime and retain a durable archetype-linked handoff with honest completion evidence.

## 4. Business operating model

The provider sells Managed IT Support and related existing catalog offers. It can also resell DPF; reseller attribution and ongoing support are separate facts. Terms, pricing, SLA, tier and geography are customer/provider business decisions, not defaults invented here. A seller, primary support provider, specialist provider and platform publisher may be different organizations. Initial UI handles one primary provider; the underlying contract must not assume they are identical or erase historical attribution on provider change.

| Portfolio | Required business evidence |
| --- | --- |
| Foundational | Trusted identities, current authority, scoped data, provider standing and audit. |
| Manufacture and deliver | Customer provisioning, site enrollment, service request, approved work, verification and handover. |
| For employees | Provider technicians' fleet workbench; customer's administrators' consent/settings. External provider technicians are not customer employees. |
| Products and services sold | Existing support offer, service agreement and reseller attribution; commercial settlement remains with its canonical owner. |

Reuse the value streams in [archetype business value streams](../../architecture/archetype-business-value-streams.md): connect intake and qualification to the service agreement, authorized delivery and verified follow-up. Monitoring/tickets/SLA evidence are service outcomes; a connected node alone is not a productive customer. Validate normal-day, bad-day and periodic scenarios through BI-ACC0D04A's baseline contract.

Topology A: MSP-owned install with strictly scoped CustomerAccount/CustomerSite estates. Topology B, the requested case: separate MSP and customer installs, connected by explicit revocable FederationLink. Never use same-organization membership or development-companion permissions to represent an external MSP. The same action/consent contract works across both topologies; their custody boundaries remain distinct.

## 5. Authority and data contract

Commercial relationship -> verified provider peer -> identified technician -> customer-approved binding -> permitted action -> customer execution -> result. No preceding arrow implies the next permission.

The customer is the final authority. Effective access intersects authenticated technician identity, verified provider affiliation/standing, current link trust, binding validity, explicit operation, target customer/site/asset, data projection and applicable approval policy. Record the originating provider and individual actor separately. Fail closed if either identity is missing or the assertion cannot be verified. The provider can assign staff only within the customer's approved envelope; it cannot widen that envelope.

| Permission family (conceptual labels, not new grant enums) | Proposed initial envelope |
| --- | --- |
| Observe/support | Scoped operational health, edge connectivity, approved diagnostic summaries and support tickets. Business records and secrets remain excluded. |
| Basic DPF administration | Explicitly approved diagnostic/recovery operations already supported by the platform, such as retrying a failed support job or restarting a supported component within an agreed maintenance policy. Each operation maps to an existing capability; unsupported operations remain unavailable. |
| Edge maintenance | Named-node enrollment/rotation/update and approved diagnostics within covered sites. No inference that it grants terminal or desktop control. |
| Endpoint actions | Named allowlisted commands/patches on selected assets, routed as customer-side proposals under the existing consent policy. |
| Interactive session | Separately authorized, expiring connection, explicit view/control/clipboard/file/terminal/elevation capabilities and customer/end-user consent policy. Disabled until the broker and revocation proof exist. |
| Consequential administration | Authority changes, credential issuance, sensitive data access, deployment advances, restore/delete and broad scripts require their existing additional gates; never bundled into basic support. |

BI for canonical authority audit must enumerate actual grants/actions and their owning handlers before implementation. This design authorizes no new standing shell access. Routine work may use customer-approved policy rather than asking for every identical action; consent version and reason are recorded. Requested work outside that envelope returns a clear permission/approval remedy rather than changing grants.

No new model is justified yet. Extend the existing typed commercial and AuthorityBinding contracts only where the implementation field audit proves a gap. Required semantic facts: provider/link, external technician, customer, target scope, approved operations, consent revision, effective start/end, approver and revocation. Keep historical seller attribution independent of active support permission. Do not hide authority in arbitrary FederationLink.metadata. Any new persistent fields require data-impact classification, indexes, retention, forward migration/backfill, compatibility and rollback review in the owning delivery BI.

## 6. Lifecycle and customer experience

Setup: **Support arrangement -> Verify provider -> Review permissions/sites/duration -> Customer approval -> Pair instance -> Enroll edge -> Verify support readiness.** Allow an invitation and an independent path. Invitations are expiring single-use candidate facts bound to the correct customer/provider; consuming one does not mint grants. Retry/resume is idempotent; partial enrollment displays the precise remaining step.

The customer confirms provider identity with a name and verified organization/instance, support contact and agreement reference. Show seller separately when different. The permission screen offers independent DPF/edge/endpoint/session choices with clear descriptions, no prechecked broad access, and an explicit expiry. The final confirmation summarizes who can do what, where, and until when. Pairing trust and access approval remain distinct canonical writes.

Customer settings: provider identity/status first, covered sites/assets, permission summary, technician roster, recent actions and **Suspend access / Remove provider / Replace provider**. Removal confirmation explains active sessions and pending work; one customer action must revoke the runtime envelope without requiring the MSP's approval. Accessible keyboard order, readable labels, theme tokens, mobile/list parity and recoverable error states are required. Compose the existing setup/capability resolver and report-kit; do not add a parallel activation wizard.

MSP workbench: existing workspace/estate/service-desk surfaces gain a scoped customer fleet projection. First viewport shows customer, outstanding requests, health, permission limits and actionable work. Within a customer, persist the customer/site/asset context beside every action. Bulk operations preview the complete target set and exclude unapproved targets; the server repeats scope checks. Approval needs appear as work on the existing attention surface, not technical grant names.

State projection is derived from canonical records: candidate, awaiting approval/pairing, ready, limited/disconnected, suspended, expired, revoked. These are presentation states, not another lifecycle table. A ready link with no approved operations is not support-ready. Provider replacement creates a new approved envelope and retains the old relationship/audit; no automatic privilege transfer.

## 7. Runtime and revocation

Customer platform actions enter the existing governed customer handler. Endpoint work uses the existing signed RemoteAction envelope and edge pull channel; commercial entitlement, peer trust and customer approval are revalidated before acceptance, claim and execution. A queued action carries consent/binding revision, actor/provider, target, TTL and idempotency identity. A stale/revoked binding cannot be resurrected by replay or re-pairing. The customer owns authoritative execution/result evidence; the MSP receives only the authorized projection.

Interactive control is a separate broker capability, not an edge enrollment side effect. Reuse existing control/session design and supported adapters; this research does not choose or install MeshCentral, Tactical RMM or ScreenConnect. The broker must prove target identity, bounded individual credentials, permission attenuation and session termination before enablement. No direct provider-to-desktop network bypass may confer authority.

On revocation, deny new/queued work immediately at the customer authority; signal active sessions and cancel unstarted work. Connected executors acknowledge termination. Disconnected executors can only act within a short issued lease and must stop when it expires; the system must report pending acknowledgement rather than claim instantaneous offline termination. Establish and measure the maximum lease/termination bound in the broker/dispatch BI. No offline approval permits a new session. Log cancellation, expiry and any residual operation already executed; revocation cannot undo past changes.

## 8. Compatibility, hardening and verification

Existing installs retain current behavior and require explicit opt-in consent; backfills never create grants or employee accounts. Old links remain subject to existing projections/policies and appear as needing support consent where the new contract requires it. Rollback disables new support actions/sessions while preserving consent and audit, and keeps customer standalone operation. Rotate/revoke delegated credentials through canonical mechanisms; never tear down customer data or nodes to remove a provider.

Shared platform investment follows the recorded founder target: 80% refactoring/integration/reliability repair, 20% new capability, cumulatively across funded work. This supersedes this chat's earlier per-task token-quota wording. Archetype/customer scope keeps its owner's policy; the server's default for that scope is 20% refactoring, 80% new capability unless explicitly changed there. Consolidate verified duplicate authorization/identity/pairing/dispatch checks, keep thin boundary adapters, measure removed duplicate paths, and preserve negative/parity tests. Do not rename/refactor unrelated modules to manufacture a percentage.

| Acceptance ID | Objective | Observable contract |
| --- | --- | --- |
| AC-MSP-01 | OBJ-MSP-01 | Every exposed action rejects missing technician identity, wrong provider, invalid consent, expired authority and out-of-scope target using the same canonical policy contract. |
| AC-MSP-02 | OBJ-MSP-01 | Shared refactor preserves existing customer/federation behavior; an audited grant/action matrix and parity tests precede deletion of duplicate checks. |
| AC-MSP-03 | OBJ-MSP-02 | Independent setup, invited setup, resume and add-later identify seller separately from provider; no grant or employee is created by attribution, discovery or pairing alone. |
| AC-MSP-04 | OBJ-MSP-02 | Customer approval explicitly binds provider, technician envelope, operations, sites/assets and expiry, with visible pending/denied/retry states. |
| AC-MSP-05 | OBJ-MSP-03 | Queued/claimed endpoint and DPF actions revalidate authority and scope; replay, revoked consent and a second customer's assets cannot execute. |
| AC-MSP-06 | OBJ-MSP-03 | An authorized interactive session is bounded, individually attributed and independently permissioned; revocation/lease expiry ends it within the measured bound, with offline limitations visible. |
| AC-MSP-07 | OBJ-MSP-04 | Customer settings and the MSP fleet show current permissions, target context and audit; keyboard/mobile/light/dark and denied/disconnected states work on the served target. |
| AC-MSP-08 | OBJ-MSP-04 | Customer suspend/remove/replace works without provider cooperation; standalone operation and historical attribution survive, with no authority transfer. |
| AC-MSP-09 | OBJ-MSP-05 | Frozen normal-day, bad-day and periodic scenarios run for both topologies and multiple customer archetypes, with negative controls and persisted readback. |
| AC-MSP-10 | OBJ-MSP-05 | Design, live BIs, dependencies, review/publication state and remaining risks have a durable handoff; task completion is never reported as verified product acceptance. |

Verification matrix: normal day provisions provider -> customer consent -> site edge -> allowed diagnostic -> verified result; bad day wrong-customer/revoked technician/expired invitation -> refused, then revoke a queued action and an active session; periodic day rotates credentials, reviews provider standing, expires access and replaces provider while the customer remains usable. Exercise a generic small business and a sensitive-business fixture with no sensitive records projected. Include concurrency races, failed enrollment, disconnected edge and stale session. Source tests establish contracts; served runtime and authorized readback establish functionality. No runtime checks have passed for this design yet.

## 9. Delivery and closeout ledger

Research/documentation is separately tracked from runtime delivery. Each independently shippable slice has a live BI and canonical design section; successor IDs are added below after governed capture. Platform slices stay with shared owners; the archetype epic links their IDs rather than copying their implementation.

| Key | Owning epic/scope | Deliverable | Design / acceptance | Dependencies | Live BI |
| --- | --- | --- | --- | --- | --- |
| D0 | EP-0AC73AEA / archetype leaf | Research/design and durable handoff | All sections / AC-MSP-10 | None | BI-B40BE0E5 |
| D1 | EP-1FABA22D / platform | Canonical delegated authority and identity refactor | 5,8 / AC-MSP-01,02 | D0 review | BI-FF04B423 |
| D2 | EP-0AC73AEA / archetype leaf | Customer provider setup, attribution and consent | 4,6 / AC-MSP-03,04 | D1 | BI-3CC2E798 |
| D3 | EP-1FABA22D / platform | Edge dispatch/session revocation hardening | 7,8 / AC-MSP-05,06 | D1 | BI-E4E037F2 |
| D4 | EP-0AC73AEA / archetype leaf | Customer support controls and MSP fleet experience | 6 / AC-MSP-07,08 | D2,D3 | BI-D07F2DE9 |
| D5 | EP-0AC73AEA / archetype leaf | Runtime acceptance and operating handover | 8 / AC-MSP-09,10 | D2,D3,D4 | BI-FB8DCBC1 |

BI-AE128860 remains the topology integration owner; BI-ACC0D04A remains the archetype baseline. This doc does not close either feature. Before implementation, obtain independent design/architecture/UX/security/data review, bind the canonical scope baseline and record plan/backlog coverage. No source code, new grant, database migration, vendor integration, runtime deployment or gate bypass is included in D0.

Gate hardening remains with existing repairs: BI-26512B65 and BI-7E75F6E6. The 2026-10-11 audit proved design-intent claim admitted WC-D41BBB6E; it did not prove the entire process. FB-2C9216AC's 9/9 task count included blocked summaries and failed full verification at that observation. Re-read current state before reuse. This design requires each delivery BI to distinguish authored, reviewed, merged, deployed and runtime-accepted evidence.

Residual risks/owners: exact grant mapping and technician assertion -> platform authority owner (D1); provider invitation abuse/consent proof -> onboarding/security owner (D2); offline session termination and adapter suitability -> edge/control owner (D3); bulk-action context and accessibility -> UX owner (D4); real operator evidence, SLAs and business suitability -> MSP owner and acceptance reviewer (D5). No risk is discharged merely by saving this document.
