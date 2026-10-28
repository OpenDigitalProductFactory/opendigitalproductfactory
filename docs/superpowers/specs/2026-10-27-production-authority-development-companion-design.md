---
status: draft
---

# Production Authority and Development Companion Installations

**Date:** 2026-10-27

**Status:** Draft; awaiting independent spec approval. Revised 2026-10-28 to extend the July federated demand network design instead of adding a claim store beside it (§5, "Superseded guidance").

**Backlog:** `BI-CCE04F19` (umbrella, xlarge, decomposed) under `EP-E1F1DB58`

**Decisions:**
- `DI-973C39F336D1`: authority/companion relationship
- `DI-5B370FD391FD`: guidance snapshot
- `DI-B6FFCCFBB541`: the item's home holds the only claim. Supersedes `DI-4C32B9A6AF40` (claim refs in a private repository).
- `DI-98D3AAFB09E0`: home-owned rooms
- `DI-A5BD051F5659`: issued agent identity

**Extends:** [Federated demand network](2026-07-19-federated-demand-network-design.md). That design already names this pairing (same-organization link, "Founder Hub Mac ↔ Founder Hub Windows", carrying "shared platform demand, disposition, claims, release notices", §4), makes exactly one installation the portfolio authority that others mirror or adopt from (§4.1), and puts an environment class on every link (§4.1). This design fills in what that design left open for a production authority and its development companion. It adds no second store, queue or transport.

**Also builds on:**
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

Two standing directions constrain every choice below:
- **One queue.** Platform work lives in one backlog. A second list of who is doing what, kept anywhere else, is hidden work: it cannot be prioritized, limited or seen to wait.
- **Absorb, don't adopt** (commandment, `docs/founder-kernel/wiki/principles/absorb-dont-adopt.md`). New capability goes into the substrate that exists. The failure it names is "a second store beside a canonical model".

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
| A receiving install can offer help on a peer's demand; the offer travels to the source install, which decides | `dpf.demand.help-offered`, `apps/web/lib/federation/demand-response.ts:110`, `apps/web/lib/actions/federated-demand.ts:150-171`; contract `packages/db/src/federated-demand-contract.ts:87` |
| A link's environment class is read when demand reaches the founder portfolio | `apps/web/lib/federation/founder-portfolio.ts:107` (`resolveFounderDemandEnvironment`) |
| The local Workroom claim refuses a second claim on one install | `apps/web/lib/work-capsules/backlog-workroom-ownership.ts:49-53,112-127` |
| GitHub issues mirror ready backlog items; the backlog stays the source of truth | `apps/web/lib/build/issue-bridge.ts` (`BacklogItem.upstreamIssueNumber`, `closeUpstreamIssueForTerminal`); [DB to GitHub delivery sync](2026-04-05-db-github-delivery-sync-design.md) |
| What is shared with the public repository is decided per change, not per install | `FeatureBuild.disposition` (`private` or `shareable`, default `private`), `apps/web/lib/integrate/disposition.ts`; [hive contribution architecture](2026-06-19-hive-contribution-architecture-and-egress-model.md) |
| Federated room admit/mirror primitives and a remote-principal mirror exist, but are never called and the flag is off | `apps/web/lib/work-management/federated-room.server.ts:10,26,56-137`; `apps/web/lib/identity/principal-linking.ts:505-519` |

### 2.2 Missing

| Requirement | Gap | Evidence |
| --- | --- | --- |
| Guidance | WWWD profile and material resolve only from the local database. With no local organization profile, a companion silently falls back to the founder platform profile. No federated record type carries doctrine. | `apps/web/lib/decision-perspective/material.ts:377-385,508-518`; `packages/db/src/federated-record-sync.ts:9-21` |
| Budgets | Funding bindings are pinned to `installationRef`. Mirrored items carry no organization, portfolio or funding. Companion spend is never reported. | `apps/web/lib/portfolio/investment-balance-server.ts:87-91,173-227`; `packages/db/src/federated-work-contract.ts:55-85` |
| No duplicate work | The July design lists claims among what the same-organization link carries, but nothing carries them. The synced item has no claim holder. The claim check reads only the local database, so a mirrored item can be claimed locally. The help-offer response exists only on the demand channel, not on items mirrored by work sync. | `packages/db/src/federated-work-contract.ts:57-86`; `backlog-workroom-ownership.ts:49-53`; July design §4 |
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

This is the July design's arrangement, not a new one. July §4.1 makes exactly one installation the portfolio authority for an environment; the others "mirror or adopt from it; they do not co-write its portfolio and there is no database leader election". It also gives every link an environment class and keeps development demand out of the production portfolio unless an operator promotes it. This section says how a production install and its development companion realize that.

**The authority** is the organization's production install: environment class `production`, purpose `operate-organization`, and holder of the organization CA. It is the July design's portfolio authority for the estate.

**A companion** is an installation of the same estate whose attested environment class is `development` or `test` and which is paired with the authority. A companion may carry a demo organization. The estate, not the organization row, makes it the same organization.

**The relationship is derived, never stored as a role.** The binding stance design rejected an `installationRole` enum, so the July designation is read from attested facts rather than typed into a field. The relationship comes from four things:
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
| Claim requests and decisions (§5) | Requester → item's home, then back | The existing help-offer response, extended to work-synced items; claim state rides the existing work-sync page | The item's home install decides; one Workroom claim |
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

## 5. One queue, one claim: no duplicate work (`DI-B6FFCCFBB541`)

The item's home holding the only claim scored 13.29 (margin 5.14). The alternatives:
- Detection at PR time only scored 8.16. Duplicate work is found after it is done.
- The home's claim plus git refs while the installs are apart scored 7.59. That keeps two claim stores consistent.
- Git claim refs in a new private repository scored 6.23. That adds a second store of work state, a repository and a credential per install.

The earlier choice, `DI-4C32B9A6AF40`, is superseded ("Superseded guidance" below).

### 5.1 Where a claim lives

**In the one place the item lives.** Every backlog item has a home: the installation that created it. Work sync already makes the home the only writer and every other copy read-only (`apps/web/lib/federation/work-sync.ts:7-12`; 2026-08-23 design §5.11). The claim follows the same rule. It is an ordinary Workroom claim on the home install. Nothing about who is working on what is kept anywhere else.

For platform work the home is normally the authority, because platform items are filed on production's backlog. The companion files only its own demo organization's work at home.

### 5.2 Claiming an item homed on the other install

1. **Ask.** The companion claims a mirrored item by sending a claim request to the item's home. The request is the existing `dpf.demand.help-offered` response (`demand-response.ts:110`), extended to items mirrored by work sync. It names the requesting installation, its Workroom, repository and branch. No new event family or channel.
2. **Decide.** The home runs its normal claim check (`assertBacklogWorkroomClaimAvailable`). If the item is free it records a Workroom claim whose executor is the companion installation, and accepts. If the item is claimed it refuses and names the holder. Either answer travels back on the same link.
3. **Show.** The synced item gains three fields: claim holder installation, holder Workroom, and lease expiry (`federated-work-contract.ts:57-86`). Both installs therefore show the same claim on the same item.
4. **Renew and release.** The companion's Workroom heartbeat reaches the home on the next sync and renews the lease there. Releasing, finishing or abandoning closes the home's claim the same way.

**Takeover.** A lease that lapses past its grace period (default 7 days, per the paused-work principle) is released at the home like any stale local claim. A takeover opens a new Workroom.

**The Workroom id is the fence.** Every PR and evidence record already names its Workroom. PR health refuses a PR whose Workroom is no longer the item's current claim, so a holder that wakes after a takeover cannot land its work. No separate fencing number is needed.

### 5.3 When the two installs cannot reach each other

- The companion may start a **visible, unconfirmed** Workroom. It appears in the companion's own list as unconfirmed, and its claim request waits in the outbox, which holds while a peer is unreachable.
- On reconnect the home decides as in §5.2. If the home refuses, the companion's Workroom is told who holds the item and stops before opening a PR.
- **GitHub is the backstop.** Both installs' PRs meet in one repository. PR health already reads open PRs (`contributor-inventory-sync.ts`) and refuses a second open PR that names the same backlog item.
- This keeps the 2026-06-20 rule "never hard-block local editing". The residual risk is duplicate effort inside one offline window. It is caught before merge, never after.

### 5.4 GitHub's role

GitHub is absorbed in the role the platform already gives it, not as a work store:
- **A view of ready work.** The issue bridge mirrors implementation-ready items as GitHub issues and closes them when the item finishes (`apps/web/lib/build/issue-bridge.ts`). The DB to GitHub delivery sync design calls this "a single operational queue with multiple views".
- **Where delivery meets.** PRs from both installs land in one repository through the merge queue, which is where the duplicate backstop of §5.3 runs.
- **Never the authority.** The July design: GitHub "must not become the write authority for installations" (§3, rule 8). Claims and status stay in the backlog.
- **What is public is decided per change.** The install posture is `contributing`; each change is kept local or shared by its `FeatureBuild.disposition`. Kept-local code lives on the install's `dpf/install` branch or the operator's own repository. No coordination repository is needed.

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
6. **Accept the first guidance snapshot and companion funding binding,** and enrol in the overlay (`BI-80658CD3`) for when production travels.
7. **Keep platform work on production's backlog.** The companion claims mirrored platform items through §5.2 and does not file platform work locally; its own backlog holds its demo organization's work.

## 9. Security and failure behaviour

| Threat or failure | Behaviour |
| --- | --- |
| Forged or tampered snapshot | Signature or hash mismatch: rejected; the previous valid snapshot stays |
| Replayed older snapshot | Lower `version`: rejected |
| Snapshot expired while offline | Cached hard limits enforced, no new funding, stance shows "guidance expired" |
| Companion overspends while unreachable | Bounded by the per-period envelope; reconciled on return |
| Two installs claim the same item while connected | The home grants one claim and refuses the other, naming the holder |
| Holder pauses past its lease and another takes over | The new Workroom is the claim; the stale holder's PR is refused by PR health |
| The installs cannot reach each other | The companion's Workroom is visible as unconfirmed; the home decides on reconnect; a second open PR for the same item is refused |
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
- Placement and capacity scheduling across installs (`BI-8D56F777`), which builds on the claims here.
- A second store of work state: a claim repository, a claim table outside the backlog, or claims in GitHub.

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
- Adopted: a single authority per item (the home), fencing checked where the result lands (the Workroom id at PR health), and long leases with explicit takeover.
- Rejected: create-only git refs in a separate repository. They work, but they are a second store of work state beside the backlog, which the absorption commandment and the single-queue direction rule out.

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

**What the first research missed.** The first draft's research never called the platform's own spec, principle or code-graph search; it used file searches and outside standards. It therefore missed the July design, the help-offer response, the issue bridge and per-change contribution, and it fed the claim decision inputs that rated a second store as well grounded. `DI-B6FFCCFBB541` was scored with that substrate in its context. The process gap is filed separately.

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
| AC-PAC-06 | OBJ-PAC2 | When both connected installations try to claim the same item, its home grants exactly one Workroom claim and refuses the other, naming the holder. |
| AC-PAC-07 | OBJ-PAC2 | The claim exists only as the home's Workroom claim; no other store, repository or GitHub object records it. |
| AC-PAC-08 | OBJ-PAC2 | After a takeover, PR health refuses a PR from the superseded Workroom, and refuses a second open PR naming the same item. |
| AC-PAC-09 | OBJ-PAC2 | Both installations show the same claim holder and lease on the item, and mutating the mirror is still refused. |
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
- The federated demand network design (2026-07-19), §3, §4, §6–§9, which this design extends.
- The DB to GitHub delivery sync design and the issue bridge.
- The hive contribution architecture and forge-neutral integration designs (per-change disposition).
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

- The backlog stays the one queue; a claim is a Workroom claim on the item's home.

**Decision.** Extend the July design rather than add beside it:
- claims ride the existing help-offer response and work-sync page;
- three signed, expiring projections are added on the existing outbox: the guidance snapshot, room membership and message events, and agent identity documents.

The authority/companion relationship is the July design's portfolio authority, read from attested environment class and estate, with no new role enum and no new transport.

## Superseded guidance

- **2026-06-20 design §4.5 (cross-install claim plane in git refs on a private shared remote).** Superseded by the July design's claims over the same-organization link, as realized in §5. The 2026-06-20 rules on graceful offline degradation and on not leaking work in progress publicly still hold; nothing here puts a claim in a repository.
- **`DI-4C32B9A6AF40`** (git claim refs). Superseded by `DI-B6FFCCFBB541`.
- **This design's 2026-10-27 draft** (private coordination repository, `claimRemote` snapshot part, operator decision D1). Withdrawn.
