---
status: draft
---

# Production Authority and Development Companion Installations

**Date:** 2026-10-27

**Status:** Draft; awaiting independent spec approval

**Backlog:** `BI-CCE04F19` (umbrella, xlarge, decomposed) under `EP-E1F1DB58`

**Decisions:**
- `DI-973C39F336D1`: authority/companion relationship
- `DI-5B370FD391FD`: guidance snapshot
- `DI-4C32B9A6AF40`: claim refs
- `DI-98D3AAFB09E0`: home-owned rooms
- `DI-A5BD051F5659`: issued agent identity

**Builds on:**
- [Cross-Install A2A Coordination](2026-08-11-a2a-coordination-layer-design.md). Its 2026-10-21 revision adds the transport, prod/non-prod trust, offline contract and validation recipes, under review on branch `doc/a2a-cross-network-tasking`.
- [Installation identity and agent stance](2026-08-22-installation-identity-and-agent-stance-design.md)
- [Federated A2A with GAID](2026-08-08-federated-a2a-gaid-coordination-design.md)
- [Authenticated work attribution and cross-install coordination](2026-06-20-authenticated-work-attribution-and-cross-install-coordination-design.md)
- [Zero-touch organization federation](2026-08-23-zero-touch-organization-federation-design.md)
- [Work Room multi-agent communication](2026-08-12-work-room-multi-agent-communication-substrate-design.md)
- [Local-first delivery throughput](2026-09-03-local-first-agentic-delivery-throughput-design.md) §10
- [Investment allocation](../../user-guide/investment-allocation.md)

## 1. What the operator asked for

The organization runs one production installation (the operator PROD install, a macOS laptop). It wants development installations associated with that production install, starting with a Windows workstation. The operator's requirements:

1. Development follows production's guidance (its WWWD business direction) and budgets, without replicating the knowledge corpus.
2. The two installations coordinate so they never do the same work twice.
3. A thread on one installation can interact with a thread on the other, and Workroom membership matters on both.
4. Production is the master source of agent identity. GAID lets production provide identity and credentials that the other installation accepts.

The operator decided on 2026-10-27 that the Windows workstation becomes the operator's development companion. Production governs a development companion with **guidance plus budget limits**:
- companion decisions use production's WWWD as their source;
- a companion cannot fund work outside production's allocation;
- spend is reported back;
- production approves nothing day to day.

This is the organization's WWWD control-scope stance for development companions. It does not decide remote upgrade or teardown of a companion; control-plane Slice 4, `BI-67219237`, stays open.

## 2. Where the platform stands (verified 2026-10-27)

Code was read on `origin/main` `7d67ef2f4f1`. Live state was read from both databases on the operator's Mac (read-only DB fallback, because no MCP tool lists federation links) and from the Windows install's public well-known endpoints.

### 2.1 Built and usable

| Capability | Evidence |
| --- | --- |
| Estate identity separates who operates an install from the business it runs: "a dev/prod pair is one estate where the dev side may carry a demo organization" | `apps/web/lib/install/estate-identity-contract.ts:10-15` |
| Same-organization membership matches normalized estate names; the Ed25519 device id is the identity | `apps/web/lib/federation/organization-membership.ts:81-98`; contract `:99-123` |
| Production holds the organization certificate authority (step-ca password present; the membership sign route answers rather than 404) | `apps/web/lib/federation/membership-relay.ts:95-98`; live check |
| Installation DID is derived from the installation Ed25519 key | `apps/web/lib/federation/instance-identity.ts:57` |
| Operating intent has a `development-companion` reading; investment funding fails closed for companion intent | `packages/db/src/installation-operating-intent.ts`; [purpose-aware design](2026-08-08-purpose-aware-installation-ecosystem-productivity-design.md), "Implemented boundary slice (BI-50136281)" |
| Same-org work sync pulls backlog items and epics every five minutes | `apps/web/lib/federation/work-sync.ts`; live: 2,999 items and 217 epics mirrored on production, `synced` |
| Durable outbox holds while a peer is unreachable | `apps/web/lib/federation/demand-delivery.ts`; head-of-line defect fixed in PR #6633 (`BI-26E3B9C9`) |
| Each install inventories the repository's open PRs and branches | `apps/web/lib/queue/functions/contributor-inventory-sync.ts` |
| Federated room admit/mirror primitives and a remote-principal mirror exist, but are never called and the flag is off | `apps/web/lib/work-management/federated-room.server.ts:10,26,56-137`; `apps/web/lib/identity/principal-linking.ts:505-519` |

### 2.2 Missing

| Requirement | Gap | Evidence |
| --- | --- | --- |
| Guidance | WWWD profile and material resolve only from the local database. With no local organization profile, a companion silently falls back to the founder platform profile. No federated record type carries doctrine. | `apps/web/lib/decision-perspective/material.ts:377-385,508-518`; `packages/db/src/federated-record-sync.ts:9-21` |
| Budgets | Funding bindings are pinned to `installationRef`. Mirrored items carry no organization, portfolio or funding. Companion spend is never reported. | `apps/web/lib/portfolio/investment-balance-server.ts:87-91,173-227`; `packages/db/src/federated-work-contract.ts:55-85` |
| No duplicate work | Claims, Workrooms, branches and PRs never cross. The claim check reads only the local database. A mirrored item can be claimed locally. The specified claim plane (`refs/claims/<BI-id>`) was never built. | `apps/web/lib/work-capsules/backlog-workroom-ownership.ts:49-53,112-127`; 2026-06-20 design §4.5 |
| Cross-install threads | No `dpf.room.*` events and no shared room id. Mirroring skips the membership gate. Membership lives in two local stores. `AgentThread` has no room link. | `federated-room.server.ts:104-137`; `room-agent-access.server.ts:44-89`; `ai-coworker.prisma:832` |
| Issued identity | GAID is an unsigned `gaid:priv:dpf.internal:<agentId>` minted identically on every install. "Verified" is a JSON flag. Agent Cards are unsigned. Certificates bind only a hostname. There is no SSO or token exchange between installs. | `principal-linking.ts:48,71`; `coworker-service-catalog/gaid-authority.ts:24-51`; `apps/web/lib/a2a/agent-card.ts:121`; `apps/web/lib/federation/csr.ts:11-14` |

### 2.3 Live findings that shaped this design

- **The Windows install's identity.** It advertises the operator's estate (`/.well-known/dpf-federation.json`) and organization "Second Chance Animal Rescue" (`/.well-known/dpf-instance.json`). That is the intended estate/demo-organization shape. The 258 archetype or animal-titled items it mirrored to production are the operator's archetype development work, and 157 cite DPF code or PRs. The boundary gap remains for a companion that hosts a genuinely separate tenant (`BI-3E31B240`).
- **Production's only trusted link.** `link_d0ea1f3a6cb948ad` goes to 192.168.0.200 over plain HTTP. It was created by membership with no human approver, and has no projection contract, no authority binding and no environment class. Production's `pairedProductionInstallationRef` points at a link revoked in August.
- **The contributor preview clone** carried production's installation identity and trusted link (`BI-8F9A3499`, fixed in PR #6635).
- **The production outbox** had attempted nothing since 2026-09-03 (`BI-26E3B9C9`, fixed in PR #6633).
- **Not verified,** because the Windows install's private state was not read: its declared environment class and purpose, its served version, and whether its native Edge node runs (`BI-0C326236`).

## 3. The relationship: authority and companion (`DI-973C39F336D1`)

Production-authority / development-companion scored 11.64 (margin 3.89). The alternatives scored lower:

| Option | Score |
| --- | --- |
| Single install with lanes | 7.75 |
| Central hosted hub | 5.61 |
| Today's sovereign symmetric peers | 5.10 |

**The authority** is the organization's production install: environment class `production`, purpose `operate-organization`, and holder of the organization CA.

**A companion** is an installation of the same estate whose attested environment class is `development` or `test` and which is paired with the authority. A companion may carry a demo organization. The estate, not the organization row, makes it the same organization.

**The relationship is derived, never stored as a role.** The binding stance design rejected an `installationRole` enum. The relationship comes from four things:
- the local environment class;
- the peer's attested environment class (`BI-0716C8A8`);
- a matching estate;
- a trusted same-org `FederationLink`.

**It is a brake, never a grant.** User capabilities, MCP grants, TAK and `AuthorityBinding` stay the only permission authorities.

Two invariants carry over from the binding designs:
- The receiving installation is sovereign over what it executes and owns.
- A synchronized item is demand visibility, never authority to mutate the peer's record.

### 3.1 What crosses, in which direction

| Flow | Direction | Carrier | Authority |
| --- | --- | --- | --- |
| Guidance snapshot: WWWD material and budget envelope (§4) | authority → companion | Federation outbox and pull, signed, expiring | Authority issues; companion enforces locally |
| Backlog items and epics | Both directions, origin-owned | Existing work sync | Origin owns mutation |
| Claims (§5) | Both directions | Refs in the private coordination repository, signed | First writer wins; authority reconciles and fences |
| Spend reports (§4.3) | companion → authority | Federation outbox | Authority reconciles |
| Room membership and messages (§6) | home ↔ mirror | `dpf.room.*` events on the outbox | Home install decides membership |
| Agent identity documents and trust bundle (§7) | authority → companion | Federation outbox and pull | Authority issues; companion verifies and still applies local grants |
| Validation and peer tasks | Per the A2A design §19.3 | A2A design §18 | Receiver |

## 4. Guidance: doctrine and budgets from production (`DI-5B370FD391FD`)

A signed, expiring guidance snapshot scored 12.96 (margin 3.68). Live remote decisions scored 9.28; manual copying scored 5.06.

### 4.1 The snapshot

The authority publishes a **guidance snapshot** for each companion. It does not replicate the corpus: the kernel, the WSID profession corpus and the user guide already ship in every image. It carries only what is organization-specific.

| Part | Content |
| --- | --- |
| `wwwd` | The authority's active organization decision profile id, plus its approved, promoted perspective material: statement, weight, dimension and provenance. Only rows the authority's resolver would use. |
| `budget` | A budget envelope per investment bucket and portfolio for this companion: amount, currency, period and funding owner. Each envelope has a `sequence`. |
| `claimRemote` | The private coordination repository for claims (§5) |
| `identity` | The GAID issuer namespace and trust bundle reference (§7) |
| `meta` | Authority installation DID, companion installation DID, `issuedAt`, `expiresAt`, `version`, and the signature by the authority's installation key |

**Signing** follows the OPA bundle model: a JWS over a manifest of content hashes.

**Freshness** follows TUF: an explicit `expires`, a monotonically increasing `version`, and refusal of any version older than the one held.

**Transport** is the existing federation outbox, as a new record type, or a pull from the authority's federation route over the overlay. The snapshot never travels through the public repository, because organization doctrine is private.

### 4.2 How the companion uses it

- **Decisions.** On a companion, `evaluate_org_business_decision` and `principle_decide(decisionDomain: org-business)` resolve the authority's snapshot profile as the organization profile.
  - Local material may only **narrow**. This is deny-overrides on the SCP model: an authority constraint always wins, and local additions can only add constraints.
  - The silent fallback to the founder platform profile is removed for a companion. A companion with no valid snapshot reports "no organization guidance" instead of borrowing another scope's doctrine.
- **Funding.** The authority's funding owner issues a **companion funding binding** inside the envelope.
  - This is the governed per-installation binding the investment guide requires (`investment-allocation.md:12`). The owner creates it on the authority and it is projected to the companion, which is not the same as copying settings.
  - The companion resolves funding only through that binding.
  - `BI-50136281`'s fail-closed rule for companion intent stays. The binding is the one path through it, and it neither creates nor widens a grant.
- **Hard limits are local.** Cloud budgets are detective controls that lag spend; GCP states that alert-only budgets do not cap spending. So the companion enforces the envelope where spend happens: at work admission and at the model-routing cost meter.
  - An exhausted envelope stops new funded work.
  - It never interrupts a running step mid-call.

### 4.3 Offline and reporting

**Offline.** The companion uses its last valid snapshot until `expiresAt` (default 14 days). After expiry:
- it keeps enforcing the cached hard limits;
- it refuses new funding;
- it reports "guidance expired" in its stance briefing and on its Connections page;
- it never falls open.

**Reporting.** Spend is reported as append-only, signed usage records on the companion's outbox. Each record carries a record id, period, amount, funding binding, backlog item and Workroom.
- The authority reconciles the records into showback for the companion's funding owner.
- A new envelope supersedes the old one by `sequence`.
- To bound overspend while unreachable, the authority issues per-period envelopes instead of relying on recalling one.

## 5. A shared claim register: no duplicate work (`DI-4C32B9A6AF40`)

Claim refs scored 11.03 (margin 1.74). The alternatives:
- An authority-hosted register scored 9.30. It blocks companion work whenever the authority laptop is offline.
- Detection from the PR inventory alone scored 6.59.

### 5.1 Where claims live

Both installations reach GitHub outbound even when they cannot reach each other. The platform repository, however, is **public**. The 2026-06-20 design requires the claim plane to live in a private-shared tier, "never the public server": "If the only shared remote is public GitHub ... claims would need a private channel" (2026-06-20 design §5, §8 O1).

This design resolves O1. Claims live in a **private coordination repository** owned by the organization: a private GitHub repository or a self-hosted GitLab. The authority names it in the guidance snapshot. The public platform repository never carries a claim.

### 5.2 Claim record

Claiming a backlog item writes a create-only ref `refs/dpf-claims/<BI-id>` in the coordination repository. The ref points at a commit whose content is a JSON claim record signed by the claiming installation's key.

| Field | Meaning |
| --- | --- |
| `itemId`, `originInstallation` | The item and the installation that owns it |
| `holderInstallation`, `holderPrincipal`, `workroomId`, `repository`, `branch` | Who holds the claim and where the work happens |
| `fence` | Monotonic fencing number: 1 on first claim, +1 on every takeover |
| `leaseUntil` | Default 7 days; renewed by a descendant commit while work continues |
| `state` | `held`, `released` or `taken-over` |

**First writer wins.** Git ref creation is atomic, so a second installation's create is rejected at claim time, not at PR time.

**Renewal, release and takeover** are fast-forward descendant commits.
- Only the holder renews.
- Anyone may take over a claim whose `leaseUntil` has passed by more than a grace period (default 24 hours, judged by the taker's clock).
- A takeover increments `fence`.

### 5.3 Fencing at merge and ingest

Timing alone is unsafe: a paused holder can wake up believing it still holds the claim. So:
- Every PR and every evidence record for a claimed item carries the claim's `fence`.
- The authority's PR-health and evidence intake reject work whose `fence` is lower than the current claim.
- The pre-push gate checks that the pushing installation holds the current claim.

### 5.4 Integration

- `claimWorkCapsuleScope` and `assertBacklogWorkroomClaimAvailable` write and check the claim ref as well as the local Workroom table.
- **When the coordination repository is unreachable,** a claim proceeds as **unconfirmed** and is confirmed or refused before a PR opens. The 2026-06-20 rule "never hard-block local editing" holds.
- **Mirrored items** show "claimed on <installation>" from the claim refs, which ride the existing contributor inventory sync.
- **Claiming a mirrored item** creates a claim that names the origin installation. Mutating the mirror is still refused, because the origin owns the record.
- **Duplicate detection** also reads open PRs and branches that name a BI id. This is the cheap fallback for work started before claims existed.

## 6. Cross-install rooms and threads (`DI-98D3AAFB09E0`)

Home-owned mirrored rooms scored 12.02 (margin 1.32). The alternatives:
- Remote-task-only interaction scored 10.69.
- A Matrix-style symmetric room with state resolution scored 8.17. It is more machinery than two or three installs need.

### 6.1 Home and mirror

**The home.** Every cross-install room has one **home**: the installation that owns the Workroom. The room's identity is the A2A `contextId` `dpf-room:<homeInstallationDID>:<caseKey>` (2026-08-12 design §6).

**Membership is decided only at the home.** The home publishes a signed `dpf.room.membership.v1` state event containing:
- the member list (local principals and verified GAIDs, §7);
- each member's role;
- a monotonic `membershipVersion`.

**The mirror** keeps a mirror room. Before writing any inbound `dpf.room.message-posted.v1`, it authorizes the sender against the latest membership state it holds. This closes today's gap: `mirrorFederatedRoomMessage` writes without checking membership.

**Posting from the mirror side.** A post goes to the home as `dpf.room.message-proposed.v1`. The home admits it against its own membership and republishes it. A non-member's post is rejected at both ends.

### 6.2 Threads

A thread joins a room through the `TaskRun` it runs under. `TaskRun.contextId` equals the room `contextId`, and the thread's coworker must be a member.
- `post_room_message` and `read_room_messages` accept the room `contextId`. A thread on the companion can therefore address a room homed on the authority, and the reverse.
- Replies route back to the thread through the same correlation `postChildResultToParent` uses for a local child, generalized to a peer.
- `read_room_messages` returns the sender's GAID for mirrored posts instead of `senderId: null`.
- `roleKind` maps `external-agent` correctly.

### 6.3 Revocation and offline

**Revocation.** Removing a member at the home publishes a new membership version.
- The home stops relaying to, and admitting from, the removed member at once.
- The mirror applies the new version on its next delivery and drops later posts from that member.
- Revocation is only as fresh as the mirror's last contact. The room header states this.

**Offline.** Posts queue on the outbox and are admitted in home order on reconnect. Presence is per install: the other install shows "last seen", never live presence.

**No shared ledger.** Each installation keeps its own Workroom log. The shared cross-install session ledger rejected in the 2026-10-07 design stays rejected.

## 7. Production-issued agent identity (`DI-A5BD051F5659`)

Production-signed identity documents scored 12.69 (margin 2.77). OIDC token exchange scored 9.93; org-CA agent certificates scored 9.12.

### 7.1 Namespace

**One issuer namespace for the estate.** The authority owns one private GAID issuer namespace: `gaid:priv:<estateNamespace>:<localId>`.
- The authority registers `estateNamespace` and names it in the link's `AuthorityBinding`, as the 2026-08-08 design §151 requires. A peer cannot self-authorize an issuer.
- This replaces the shared `dpf.internal` issuer, which GAID.md requires to carry a namespace discriminator.

**Agents on different installations are distinct subjects.** A companion's coworker gets its own GAID, for example `gaid:priv:<estateNamespace>:<companionLabel>.<agentId>`, even when its configuration is cloned. Two such GAIDs denote the same enduring subject only when a governed **continuity record** on the authority says so (2026-08-08 §143-147).

GAID never encodes the environment.

### 7.2 Identity documents

The authority mints a short-lived **agent identity document** for each coworker it hosts, and for each companion coworker it admits. The document is a JWS (EdDSA) signed by the authority's installation key. The companion holds that key's DID through attested membership (`BI-0716C8A8`).

| Claim | Meaning |
| --- | --- |
| `sub` | The GAID |
| `hostInstallation` | Installation DID that runs the agent |
| `agentId`, `role` | Local agent identity and role (display-safe) |
| `iat`, `exp` | Default lifetime 24 hours; renewed while connected |
| `status` | Reference to the authority's revocation status list (Bitstring Status List style), cached by the companion |

**Verification.** The companion holds the authority's trust bundle (installation key and rotation set) and verifies documents offline until `exp`.

**Revocation.** As in SPIFFE, short lifetime plus bundle rotation is the main tool. The status list covers revocation before expiry.

**Identity is not authority.** A verified GAID maps to a local mirrored principal (`ensureFederatedRoomPrincipal`). The receiving installation still applies its own grants, TAK and room membership.

### 7.3 Credentials

"Provide credentials across instances" is delivered in two steps:

- **This design.** Production issues agent identity documents. A companion accepts them as the identity of a remote agent in rooms (§6) and in peer tasks (A2A design §19).
- **Later, a separate item.** A verified identity document becomes an RFC 8693 `subject_token`, which the companion exchanges for a short-lived local MCP token scoped by its own grants. The `act` claim records the delegation chain. Human single sign-on between installations is out of scope here.

## 8. Re-purposing the Windows install

The Windows install today has the operator's estate, a demo organization, and a trusted membership link with production over the home LAN.

Each change below is made on the Windows install by the operator, at the machine or through remote access the operator already has. Production credentials and teardown are operator-only.

1. **Read its current state:** environment class, purpose, paired ref, served version, Edge status and PowerShell hosts. The A2A design §21.1 lists all of these as unverified.
2. **Declare it** `development` with purpose `evolve-dpf`, paired with the authority's **installation** (not a link id). An undeclared install is treated as production, so this step is required.
3. **Keep the demo organization** "Second Chance Animal Rescue". The estate stays the operator's, which is the shape the estate contract defines. Archetype test data stays on the companion; only the operator's development work crosses (`BI-3E31B240`).
4. **Re-attest membership** once `BI-0716C8A8` lands, so production records the companion's attested class.
5. **Repair production's stale paired reference** through production's "Change what this installation is" surface. It currently points at a revoked link.
6. **Accept the first guidance snapshot and companion funding binding.** Configure the claim repository, and enrol in the overlay (`BI-80658CD3`) for when production travels.

## 9. Security and failure behaviour

| Threat or failure | Behaviour |
| --- | --- |
| Forged or tampered snapshot | Signature or hash mismatch: rejected; the previous valid snapshot stays |
| Replayed older snapshot | Lower `version`: rejected |
| Snapshot expired while offline | Cached hard limits enforced, no new funding, stance shows "guidance expired" |
| Companion overspends while unreachable | Bounded by the per-period envelope; reconciled on return |
| Two installs claim the same item | Second create rejected at claim time |
| Holder pauses past its lease and another takes over | Higher `fence` wins; the stale holder's PR and evidence are rejected at merge and ingest |
| Coordination repository unreachable | Claim proceeds unconfirmed; confirmed or refused before PR open |
| Non-member posts to a mirrored room | Rejected at the mirror and at the home |
| Member removed while the mirror is offline | Home stops relaying at once; mirror applies the change on next delivery |
| Stolen identity document | Valid until `exp` (24 h) unless on the status list; grants are still local |
| Companion tries to mutate an authority record | Refused; proposal only |
| Clone carries the authority's identity | Fixed by `BI-8F9A3499` |

## 10. Out of scope

- Remote upgrade, reconfiguration or teardown of a companion (control-plane Slice 4, `BI-67219237`).
- Human single sign-on between installations.
- A shared cross-install session ledger.
- Multi-tenant companions hosting genuinely separate organizations' operational data, beyond the boundary in `BI-3E31B240`.
- Replicating the kernel or WSID corpus.
- Placement and capacity scheduling across installs (`BI-8D56F777`), which builds on the claim register here.

## 11. Research

The research compared two or three approaches per problem, using sources fetched 2026-10-27. Full notes are in the research receipt on `BI-CCE04F19`.

**Policy distribution**
- Compared:
  - [OPA signed bundles](https://www.openpolicyagent.org/docs/management-bundles): a JWT over file hashes, and the last good bundle persisted.
  - [TUF](https://theupdateframework.github.io/specification/latest/): `expires`, a timestamp role, and protection against freeze attacks.
  - [AWS SCP evaluation](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_evaluation.html): a deny at any level wins.
  - [Argo CD](https://argo-cd.readthedocs.io/en/stable/): pull and drift detection.
- Adopted: a signed manifest, expiry plus version, and deny-overrides with narrowing only.
- Rejected: central request-time evaluation, because it has no offline mode.

**Budgets**
- Compared:
  - [AWS Budgets actions](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-controls.html).
  - [GCP budgets](https://docs.cloud.google.com/billing/docs/how-to/budgets), which "doesn't automatically cap … usage or spending".
  - [FinOps allocation](https://www.finops.org/framework/capabilities/allocation/): showback before chargeback.
- Adopted: local hard enforcement, reported usage and per-period envelopes.
- Rejected: alert-only central budgets.

**Claims**
- Compared:
  - [etcd leases](https://etcd.io/docs/v3.5/learning/api/) and [Chubby](https://static.usenix.org/event/osdi06/tech/full_papers/burrows/burrows_html/index.html): sequencers; both assume continuous connectivity.
  - [Kleppmann on fencing](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html).
  - The [Git LFS locking API](https://github.com/git-lfs/git-lfs/blob/main/docs/api/locking.md).
- Adopted: create-only refs for first-writer-wins, fencing numbers checked where the result lands, and long leases with explicit takeover.
- Rejected: leases that depend on connectivity.

**Rooms**
- Compared:
  - The [Matrix server-server API](https://spec.matrix.org/latest/server-server-api/) and [room v2 state resolution](https://spec.matrix.org/latest/rooms/v2/): every server authorizes every event.
  - [A2A 1.0](https://a2a-protocol.org/latest/specification/): `contextId`.
- Adopted: per-install authorization of every event, signed membership, and A2A `contextId`.
- Rejected: symmetric state resolution. A home install gives convergence for two or three installs.

**Identity**
- Compared:
  - [SPIFFE federation](https://github.com/spiffe/spiffe/blob/main/standards/SPIFFE_Federation.md) and [trust bundles](https://github.com/spiffe/spiffe/blob/main/standards/SPIFFE_Trust_Domain_and_Bundle.md): short-lived credentials, with bundle rotation as revocation.
  - [RFC 8693](https://www.rfc-editor.org/rfc/rfc8693.html): `act`.
  - [W3C VC 2.0](https://www.w3.org/TR/vc-data-model-2.0/) and [Bitstring Status List](https://www.w3.org/TR/vc-bitstring-status-list/).
  - [RFC 5280 name constraints](https://www.rfc-editor.org/rfc/rfc5280).
- Adopted: short-lived signed documents, a trust bundle, a status list, and RFC 8693 for the later credential step.
- Deferred: a name-constrained subordinate CA per companion.

**Not confirmed by the research:** Kyverno and Azure Policy inheritance, OpenID Federation 1.0, GitHub issue-assignment semantics as a claim, and Git LFS server-side lock enforcement.

**Scoring caveat:** the `principle_decide` scores rest on option features judged by the design author. Some retrieved principles are weakly related to these decisions, for example "Jurisdiction-layered analysis for legal operations".

## 12. Objectives and acceptance

**OBJ-PAC1:** A development companion makes organization-business decisions and funds work only under the production authority's current guidance snapshot, enforces its budget envelope locally while offline, and reports spend back.

**OBJ-PAC2:** Two installations of one estate cannot both hold a claim on the same backlog item, and work produced under a superseded claim cannot land.

**OBJ-PAC3:** An agent thread on one installation can converse with a thread on the other inside a room whose membership is decided by its home installation and enforced on both.

**OBJ-PAC4:** The production authority is the issuer of agent identity for the estate; a companion verifies production-issued agent identity offline and still applies its own grants.

**OBJ-PAC5:** The Windows install operates as the attested development companion of the operator PROD install, keeping its demo organization.

| ID | Objectives | Statement |
| --- | --- | --- |
| AC-PAC-01 | OBJ-PAC1 | On the companion, `evaluate_org_business_decision` resolves the authority snapshot's profile, and reports "no organization guidance" rather than the founder platform profile when no valid snapshot is held. |
| AC-PAC-02 | OBJ-PAC1 | A snapshot with a bad signature, a changed file hash or a lower version is rejected, and the previous valid snapshot stays in force. |
| AC-PAC-03 | OBJ-PAC1 | The companion funds work only through a companion funding binding issued by the authority's funding owner, and refuses new funded work once the envelope is exhausted. |
| AC-PAC-04 | OBJ-PAC1 | After the snapshot expires while offline, cached limits stay enforced, new funding is refused, and the stance briefing reports guidance expired. |
| AC-PAC-05 | OBJ-PAC1 | Companion spend records reach the authority after reconnect and appear in the funding owner's showback exactly once. |
| AC-PAC-06 | OBJ-PAC2 | When both installations try to claim the same item, exactly one claim ref is created and the other claim is refused at claim time. |
| AC-PAC-07 | OBJ-PAC2 | Claims live only in the private coordination repository; the public platform repository carries no claim ref. |
| AC-PAC-08 | OBJ-PAC2 | After a takeover, a PR or evidence record carrying the old fence is rejected by the authority's PR-health and evidence intake. |
| AC-PAC-09 | OBJ-PAC2 | A mirrored item shows which installation holds its claim, and mutating the mirror is still refused. |
| AC-PAC-10 | OBJ-PAC3 | A thread on the companion posts into a room homed on the authority and receives the authority thread's reply in its own thread, and the reverse direction also works. |
| AC-PAC-11 | OBJ-PAC3 | A post from a non-member is rejected at the mirror and at the home, and no message row is written for it. |
| AC-PAC-12 | OBJ-PAC3 | After a member is removed at the home, the home refuses that member at once and the mirror refuses them after its next delivery. |
| AC-PAC-13 | OBJ-PAC4 | GAIDs minted after this change use the estate namespace, and the same agent id on two installations yields two distinct GAIDs unless a continuity record links them. |
| AC-PAC-14 | OBJ-PAC4 | The companion verifies a production-issued identity document offline until expiry, rejects an expired, revoked or wrongly signed one, and still applies its own grants to a verified agent. |
| AC-PAC-15 | OBJ-PAC5 | The Windows install reports environment class development, purpose evolve-dpf and paired installation the operator PROD install, and production records its attested class. |
| AC-PAC-16 | OBJ-PAC5 | Production's paired-installation reference names the companion installation, not a revoked link. |

Acceptance is functional, on the two physical installations. Unit and contract tests are prerequisites only.

## Design grounding

**Specs and plans reviewed**
- The a2a coordination design, §18–§24.
- The installation identity and stance design.
- Federated A2A with GAID, and its plan.
- The 2026-06-20 claim-plane design.
- Zero-touch federation, §5.11.
- Work Room communication, §5–§6.
- Local-first throughput, §10.
- The durable delegation ledger.
- The operational control plane.
- The purpose-aware installation design.
- The investment allocation guide.

**Code substrate reviewed**
- The estate identity contract and organization membership.
- Operating intent and the stance resolver.
- Federation work sync and the outbox.
- The WWWD material resolver.
- Investment balance and funding bindings.
- Workroom claim and ownership.
- Federated room primitives and room access.
- GAID minting, AIDoc and the Agent Card.
- Instance identity, the membership relay and the CSR.

**Source of truth**
- `FederationLink` stays the only peer trust.
- `FederatedRecordMirror` and the outbox stay the only transport.
- The authority's `DecisionPerspectiveProfile` stays the WWWD source.
- Funding bindings stay per installation, issued by the owner.
- Each installation stays sole authority over its Workroom log.

**Decision.** Add four signed, expiring projections:
- the guidance snapshot;
- claim records in a private coordination repository;
- room membership and message events;
- agent identity documents.

The authority/companion relationship is derived from attested environment class and estate, with no new role enum and no new transport.
