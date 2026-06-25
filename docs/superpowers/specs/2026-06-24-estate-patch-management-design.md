# Estate Patch Management — inventory → version intelligence → governed scheduling → apply

- **Date:** 2026-06-24
- **Status:** Design (research-first). No code in this pass.
- **Author:** Claude (external coding agent), on Mark's `/goal`.
- **Epic:** `EP-PATCH-MANAGEMENT` (new; composes `EP-EDGE-NODE`, `EP-EDGE-TOPOLOGY`, `EP-ASSURANCE-LEDGER`, `EP-UPGRADE-LIFECYCLE`, `EP-SCHEDULING-SURFACE`, `EP-MSP-FEDERATION`, `EP-ESTATE-SOVEREIGNTY`, `EP-ATTENTION-SURFACE`).

---

## 1. Problem & goal

Patch management is the loop: **know what software is installed on a computer → know whether a newer (or safer) version is available → schedule the change → apply it → verify it.** DPF must run this loop for three populations of hosts:

1. **Itself** — the DPF install (already partly solved by the self-upgrade machinery, but only for DPF's own image, not the OS or third-party software around it).
2. **The discovered estate** — hosts and software found by infrastructure discovery on the local network.
3. **Remote customer networks** — reached through the **Edge Node**, the host-resident agent DPF already enrolls on customer sites.

This is a **load-bearing capability for the MSP (Managed Service Provider) archetype**: patch compliance is one of the two or three things an SMB actually pays a managed-IT provider for, and it must work unattended across many remote clients with sovereignty preserved.

The brief asks the right framing questions, so the design answers each explicitly:

- **"Understand what's installed"** → §3.1 (inventory leg — ~70% already built).
- **"Understand if a new version is available"** → §6.2 (version-intelligence leg — the first real gap).
- **"Schedule and implement the patch"** → §6.3–6.4 (scheduling reuse + the apply leg — the second real gap: the Edge Node cannot execute anything today).
- **"We may need an agent installed"** → §7 (the Edge Node *is* that agent; it needs a governed execution capability, not a new agent).
- **"Write our own or embed open-source"** → §5 (build-vs-embed decision: **embed standards, build the governance**).

---

## 2. Substrate audit — what already exists (verified against live code)

The DPF architecture is denser than the brief assumes. Three of the four legs are partly or wholly built; only two genuinely new pieces are required.

### 2.1 Inventory — mostly built

| Capability | Where | Status |
| --- | --- | --- |
| Host/asset model with version + multi-tenant scope | `InventoryEntity` — `packages/db/prisma/schema.prisma:3688` (`observedVersion`, `normalizedVersion`, `supportStatus`, `customerAccountId`, `customerSiteId`) | **Built** |
| **Per-host installed-software inventory** | `DiscoveredSoftwareEvidence` — `schema.prisma:3542` (`packageManager`, `rawVendor`, `rawProductName`, `rawVersion`, `installLocation`, `normalizationStatus`, `softwareIdentityId`) | **Built** |
| Cross-platform software collection | `packages/db/src/discovery-collectors/host.ts` — Windows (PowerShell registry), macOS (pkgutil + Homebrew), Linux (dpkg/rpm) | **Built** |
| Software normalization (raw → vendor/product/version) | `packages/db/src/software-normalization.ts` | **Built** |
| Multi-tenant / MSP estate scoping | `CustomerAccount` (`schema.prisma:2302`), `CustomerSite` (`2346`) — FK'd onto every inventory/discovery model | **Built** |
| Edge-node discovery ingestion | `POST /api/v1/edge/discovery-runs` → `DiscoveryRun` (`schema.prisma:3479`) | **Built** |
| SBOM (CycloneDX, off pnpm-lock) | `scripts/sbom/generate-platform-sbom.mjs`; `BomDocument` / `BomComponent` models | **Built (DPF's own deps)** |

> **The one dangling thread:** `DiscoveredSoftwareEvidence.softwareIdentityId` (`schema.prisma:3556`) is a nullable string with **no catalog table behind it** — there is no `SoftwareIdentity`/`SoftwareProduct` model. This is the precise seam where the catalog (§6.1) plugs in.

### 2.2 Scheduling & apply-governance — built and reusable (DPF's differentiator)

| Capability | Where | Status |
| --- | --- | --- |
| Maintenance windows + blackout periods | `DeploymentWindow` (`schema.prisma:845`), `BlackoutPeriod` (`866`); pure evaluator `apps/web/lib/self-upgrade/windows-eval.ts` | **Built** |
| Auto-selected overnight window (24/7 stores) | `apps/web/lib/self-upgrade/auto-window.ts`; heavy-job avoidance `maintenance-calendar.ts` | **Built** |
| Window-gate MCP tool (by change type + risk) | `check_deployment_windows` — `apps/web/lib/mcp-tools.ts:11050` | **Built** |
| Quiescence / graceful drain | `apps/web/lib/self-upgrade/quiescence.ts` (3-level state machine) | **Built** |
| Recovery point + layered rollback | `recovery-point.ts`, `rollback.ts` | **Built (DPF self)** |
| Change governance (ITIL) | every `SelfUpgradeRun` (`schema.prisma:5526`) mirrors to `ChangeRequest` | **Built** |
| Scheduling registry / de-confliction | `SCHEDULED_JOB_CATALOG`, `scheduling-allocator.ts` (EP-SCHEDULING-SURFACE) | **Built** |

**This is the moat.** Commodity RMM tools schedule patches; almost none of them wrap patching in change-management, quiescence, recovery points, and a governance kernel. DPF already has all of that for its own upgrades — patch management generalizes it.

### 2.3 Edge Node — enrolled, trusted… and inert

| Capability | Where | Status |
| --- | --- | --- |
| Enrolled host-resident agent, per-platform (Go native for macOS/Windows, TS container for Linux) | `EdgeNode` (`schema.prisma:10103`); spec `docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md`; runtime decision `2026-05-16-edge-node-runtime-decision.md` | **Built (Phase 0)** |
| Enrollment ceremony (bootstrap token → enroll → node token), trust lifecycle | `BootstrapToken` (`schema.prisma:10199`); `apps/web/lib/edge-node/remote-provisioning.ts` (one-liner remote install) | **Built** |
| Identity as a `Principal`/`PrincipalAlias` (`edge-node`) | AGENTS.md §11 | **Built** |
| Capability envelope with **per-capability mode** (`enabled`/`reporting-only`/`disabled`) | `EdgeNodeCapability` (`schema.prisma:10258`) | **Built** |
| Discovery submission, change-event + alert ingest, heartbeat/rotation | token scopes `discovery:submit`, `edge:heartbeat`, `edge:rotate` | **Built** |
| **Remote command/script/patch execution** | — | **ABSENT** |

The Edge Node today is a **discovery / telemetry / enrollment beacon**. There is no `action:execute` (or `patch:apply`) token scope, no `RemoteAction`/`RemoteJob`/`PatchJob` model, no dispatch-and-collect-result path. The capability envelope *reserves* future slots (`capability.discovery.software`, `capability.policy.enforcement`, etc.) but ships none of the execution side. **This is the largest single gap and the heart of the apply leg (§7).**

### 2.4 Version intelligence & remediation — npm-only, plus the right homes for more

| Capability | Where | Status |
| --- | --- | --- |
| "Is a newer version available?" for DPF itself | `apps/web/lib/self-upgrade/version.ts` (git-SHA, **not** semver; HEAD of a git remote) | **Built (DPF self only)** |
| Vulnerability scan | `scripts/sbom/scan-dependencies.mjs` → OSV.dev batch API, severity gate, `vuln-baseline.json` accept-with-expiry | **Built (npm ecosystem only)** |
| Finding model with severity, source adapter, CVE id, remediation hint, risk-accept-with-expiry | `AssuranceFinding` — `schema.prisma:4968` (`findingKind`, `affectedType`/`affectedId`, `vendorIdentifier`, `policySeverity`, `remediationHint`, `acceptedUntil`, `bomComponentId`) | **Built — reuse for patch gaps** |
| Human/audit remediation workflow tracking | `CorrectiveAction` — `schema.prisma:6666` (audit/incident-scoped, owner, due date, verification) | **Built — distinct from machine execution** |

`AssuranceFinding` already models exactly what a "patch gap" is — an affected element, a severity, a CVE identifier, a remediation hint, and a risk-accept-until date. **A patch gap is an assurance finding.** What is missing is (a) a software **catalog** to anchor identity and (b) a **version-intelligence feed** beyond npm to populate "latest safe version."

---

## 3. Research & Benchmarking (AGENTS.md §10)

### 3.1 The market (commercial)

The 2026 patch-management market splits into **cloud-native dedicated** tools, **RMM-integrated** modules, and **enterprise endpoint-management** suites. Leaders: Action1, NinjaOne, Ivanti Neurons for Patch Management, HCL BigFix, ManageEngine Patch Manager Plus, Patch My PC, Tanium, Automox, Atera. ([Action1 — best patch management 2026](https://www.action1.com/blog/10-best-patch-management-software/), [PDQ — top patch tools 2026](https://www.pdq.com/blog/best-patch-management-tools/), [NinjaOne — best for MSPs](https://www.ninjaone.com/blog/best-patch-management-software/))

- **Architecture pattern:** cloud control plane + lightweight host agent + maintenance windows + approve/test/deploy rings + compliance reporting. Automox and Action1 are "cloud-only, no infrastructure"; NinjaOne/Atera/Kaseya bundle patching into a broader RMM. ([Automox 2026 buyer's guide](https://www.automox.com/blog/automated-patching-solutions-compared-2026))
- **Pricing:** ~$5–10/endpoint/month cloud-native; free tiers exist (Action1 ≤200 endpoints); five-figure+ annual for Tanium/Ivanti.
- **Coverage is the differentiator:** Automox advertises Windows/macOS/Linux + 100+ third-party apps; ManageEngine 900+. The breadth of the **third-party application catalog** is the moat these vendors sell.

**Patterns adopted:** agent-on-host; maintenance windows + blackouts; test/approve/deploy rings (canary → broad); compliance reporting as the primary operator surface; "security patches auto, feature updates manual" as the default policy split.

**Anti-patterns identified:** (1) **The catalog supply chain is a perpetual cost** — vendors either lean on public package repos (Automox uses public Winget/Chocolatey/Homebrew) or hand-curate (Action1 builds & malware-scans every package in-house under SOC2/ISO). ([Action1 third-party repo](https://www.action1.com/patch-management/third-party-app-patch-repository/), [Automox third-party support](https://docs.automox.com/product/Product_Documentation/Third-Party_Software/Third_Party_Software_Support.htm)). DPF should **not** start by hand-curating an installer repo — that is a staffed, ongoing, audited operation. (2) Most tools are a **second control plane** with their own identity, scheduling, and change records — duplicative if you already have an authority core.

### 3.2 Open-source leaders (data models read, per §10)

- **osquery + Fleet** (osquery: Apache-2.0; Fleet core: MIT). osquery exposes the host OS as a SQL database; installed software lives in concrete tables — `programs` (Windows: name, version, install_location, publisher), `apps` (macOS), `deb_packages` / `rpm_packages` / `homebrew_packages` (Linux). The `osqueryd` agent enrolls to a TLS server with an enroll secret, runs **scheduled query packs**, and answers **distributed (live) queries**. **Fleet** layers a software-inventory → **CPE** (NVD CPE dictionary) → **CVE** (NVD feeds) pipeline on top, storing a `software` + `software↔CVE` model. ([Fleet/osquery](https://fleetdm.com/guides/osquery-a-tool-to-easily-ask-questions-about-operating-systems), [Fleet — endpoint mgmt](https://fleetdm.com/articles/rethinking-endpoint-management)). **Adopted:** osquery as the inventory engine and its tables as the canonical software shape; CPE→CVE as the gap-detection model. **Rejected:** the Fleet *server* — it is a second control plane (its own enrollment, scheduling, policies) that duplicates DPF's Authority Core + Edge Node.
- **OSV.dev + OSV-Scanner** (Apache-2.0; free API). Aggregates GitHub advisories, OSS-Fuzz, **and distribution security advisories** (Debian, Ubuntu, Alpine, Rocky/RHEL, SUSE), keyed by package + version range with fixed-in versions. OSV-Scanner ingests lockfiles, **SBOMs (CycloneDX/SPDX)**, Debian packages, and **container images**. ([OSV-Scanner](https://google.github.io/osv-scanner/)). **Adopted:** OSV as the cross-ecosystem "is this version vulnerable / what's fixed-in" oracle — DPF already uses it for npm (`scan-dependencies.mjs`); generalize it. DPF already emits CycloneDX, so the SBOM→OSV path is a short hop.
- **Tactical RMM** (source-available, **non-OSI "Tactical RMM License"**). Go agent (`tacticalagent`) + NATS transport + Django backend; Windows patching via the **Windows Update Agent (WUA) COM API**; arbitrary script execution. ([Tactical RMM review](https://www.openmsp.ai/blog/tactical-rmm-review)). **Rejected for embedding:** its license restricts using it to provide a competing commercial RMM/MSP service to third parties — a direct conflict with the MSP archetype. Studied for its agent/dispatch mechanics, not adopted.
- **Uyuni** (GPLv2; SUSE Manager upstream). Salt-based Linux fleet patch/config management with structured package lifecycles. **Rejected:** copyleft, Linux-only, heavyweight (Salt master) — wrong shape for an embeddable cross-platform agent.
- **NetLock RMM** (open-source, newer): one global "approved patches" queue + fleet compliance scoring. **Adopted (as a model):** the single approved-state queue is a clean mental model for `PatchPolicy` (§6.4).

### 3.3 Apply mechanics per OS (the executor backends)

- **Windows:** **WinGet** (CLI + PowerShell module + COM API) for applications (`winget upgrade --all --silent --accept-package-agreements --accept-source-agreements`), and the **Windows Update Agent** for OS/driver/Microsoft updates. ([winget automation](https://www.edtechirl.com/p/set-it-and-forget-it-daily-silent), [winget-cli](https://github.com/microsoft/winget-cli)).
- **Linux:** `apt` / `unattended-upgrades` (configurable security-only scope), `dnf`/`yum`.
- **macOS:** `softwareupdate` (OS) + Homebrew (apps).

**Implication:** for the *apply* backend, DPF should **drive the native package managers** rather than ship its own installer payloads. That sidesteps the curated-catalog cost (§3.1 anti-pattern 1) and inherits each platform's signing/verification.

---

## 4. The control loop (architecture overview)

```
                        ┌──────────────────────── DPF Authority Core ───────────────────────┐
                        │                                                                    │
  ┌─────────┐  inventory │  ┌────────────┐   ┌────────────────┐   ┌──────────────────────┐   │
  │ Host /  │───────────►│  │ Inventory  │──►│ Version Intel  │──►│ Patch Assessment     │   │
  │ Edge    │            │  │ (built)    │   │ (NEW: catalog  │   │ = AssuranceFinding   │   │
  │ Node    │◄───────────│  │ Discovered │   │  + OSV/feeds)  │   │  findingKind=patch   │   │
  └─────────┘  action    │  │ Software   │   └────────────────┘   └─────────┬────────────┘   │
       ▲       dispatch   │  └────────────┘                                  │ "needs patch"  │
       │                  │                                                  ▼                │
       │                  │  ┌──────────────┐   ┌───────────────┐   ┌──────────────────────┐ │
       │   RemoteAction   │  │ Schedule     │◄──│ PatchPolicy   │◄──│ Patch Plan / Job     │ │
       └──────────────────│──│ (REUSE win-  │   │ (NEW: auto-   │   │ (NEW: rings, targets)│ │
         result + evidence│  │ dows/quiesce/│   │  approve class│   └──────────────────────┘ │
                          │  │ recovery/CR) │   └───────────────┘                            │
                          │  └──────────────┘                                                │
                          └────────────────────────────────────────────────────────────────┘
```

Four legs: **Inventory** (built) → **Version Intelligence** (new feed + catalog) → **Schedule** (reuse) → **Apply** (new governed execution). The loop is read-only end-to-end until the apply leg is explicitly armed.

---

## 5. Build vs. embed — decision

**Decision: embed open-source standards for the commodity parts; build natively only the governance/orchestration that is DPF's differentiation.**

Three options were weighed and run through the governance kernel (`principle_decide`, population `external_coding_agent`). The kernel returned **no commandment conflict** for any option and a **degenerate composite (0.000 across the board)** — the options carried no structured feature scores, so it fell back to generic commandments (PR discipline, DCO) that do not discriminate an architecture call. Per DPF's honest-context doctrine, that is recorded as "kernel surfaced no blocker," **not** as a real score; the decision rests on the named principles below.

| Option | Verdict | Why |
| --- | --- | --- |
| **Build everything bespoke** (own agent + own catalog) | ✗ | Reinvents osquery and OSV; the third-party catalog is a perpetual staffed cost (§3.1); violates *Research-and-use-standards*; slowest to cover the long tail. |
| **Embed standards, build the governance** | ✓ **chosen** | osquery (inventory) + OSV/native package managers (intelligence + apply) are mature, permissively licensed, cross-platform. DPF builds only what no OSS gives it: the **governed remote-execution capability**, scheduling/quiescence/recovery reuse, change governance, kernel-gated approval, and the MSP federation boundary. Aligns with *Architecture Over Shortcuts* and *Single Source of Truth*. |
| **Adopt a whole OSS RMM** (Tactical RMM / Fleet server) | ✗ | Stands up a **second control plane** — its own identity, enrollment, scheduling, change records — duplicating the Authority Core and Edge Node (violates *Single Source of Truth* + the Edge Node spec's authority-preservation binding). Tactical RMM's license also **bars commercial MSP resale**. |

**Governing constraint (AGENTS.md §9):** osquery and OSV-Scanner are external tools and must pass the **Tool Evaluation Pipeline (EP-GOVERN-002)** before adoption (security/architecture/compliance/integration review, then version-pin in `approved_tools_registry.json`). The design assumes that gate; it does not pre-approve.

---

## 6. New & composed substrate

### 6.1 Software catalog — `SoftwareProduct` (NEW; resolves the dangling FK)

The canonical identity for a piece of software, independent of any one host's raw evidence. Backfills `DiscoveredSoftwareEvidence.softwareIdentityId` (`schema.prisma:3556`).

```
SoftwareProduct
  productKey            String  @unique         // canonical slug, e.g. "mozilla/firefox"
  vendor                String
  product               String
  edition               String?                 // Community / Enterprise / LTS
  cpe23                 String?                  // NVD CPE 2.3 URI — the CVE join key
  category              String                  // browser | runtime | db | os-package | driver | ...
  ecosystem             Json                     // coordinates per manager: {winget, choco, brew, apt, rpm, npm, pypi}
  latestStableVersion   String?                  // populated by version-intelligence feed (§6.2)
  channels              Json    @default("{}")   // {stable, lts, beta} -> latest version
  eolDate               DateTime?                // end-of-life / end-of-support
  supportStatus         String  @default("unknown")
  // relations: discoveredEvidence[], bomComponents[] (relate to existing BomComponent where overlap)
```

> **Stewardship (§11):** relate `SoftwareProduct` to the existing `BomComponent` (DPF's SBOM already models components with versions). `SoftwareProduct` is the *host-facing installed-software* identity; `BomComponent` is the *build-time dependency* identity. They share CPE/PURL keys and should cross-reference, not duplicate.

### 6.2 Version intelligence — a feed, not a hand-maintained table (NEW)

A scheduled projector (new entry in `SCHEDULED_JOB_CATALOG`) that, for each `SoftwareProduct` in use across the estate, resolves **latest safe version** and **known vulnerabilities** from:

1. **OSV.dev** (already wired for npm in `scan-dependencies.mjs`) — generalize the adapter to all ecosystems incl. OS packages and container images. Returns CVE/GHSA + affected ranges + fixed-in.
2. **Native package-manager metadata** — `winget show`, `apt-cache policy`, `dnf check-update`, `brew outdated` give "installed → available" directly on-host (collected by the Edge Node), which is the most authoritative "is an update available" signal.
3. **EOL feed** (e.g., endoflife.date) for `eolDate`.

Output is **not** a new findings table — it writes **`AssuranceFinding`** rows:

```
AssuranceFinding (existing — schema.prisma:4968)
  findingKind     = "patch-gap" | "vulnerability"
  affectedType    = "InventoryEntity" | "DiscoveredSoftwareEvidence"
  affectedId      = <host or evidence id>
  adapterKey      = "patch-intel" | "osv"
  vendorIdentifier= <CVE/GHSA id>            // already on the model
  policySeverity  = critical | high | ...
  remediationHint = { targetVersion, ecosystem, channel, applyVia: "winget|apt|wua|..." }
  acceptedUntil   = <risk-accept expiry>     // already on the model — mirrors vuln-baseline.json
```

This means **the entire read-only assessment leg (Phase 0, §8) ships with no new findings table** — it composes the Assurance Ledger. "What needs patching across the estate" is a query over `AssuranceFinding where findingKind='patch-gap'`.

### 6.3 Governed remote execution — `RemoteAction` (NEW; the apply primitive)

The Edge Node's missing execution side. Deliberately **generic** (patching is the first consumer, not the only one — script run, service restart, inventory-on-demand all reuse it). Distinct from `CorrectiveAction` (which is human/audit-workflow remediation, `schema.prisma:6666`).

```
RemoteAction
  actionKey           String  @unique
  edgeNodeId          String                    // executor
  inventoryEntityId   String?                   // target host (may equal the edge host)
  customerAccountId   String?                   // MSP scope (consistent with all estate models)
  customerSiteId      String?
  actionType          String                    // inventory.collect | patch.apply | script.run | service.restart | reboot
  parameters          Json                      // e.g. { softwareProductId, targetVersion, applyVia }
  requestedByPrincipalId String
  approvalState       String  @default("proposed")   // proposed | approved | rejected
  approvedByPrincipalId  String?
  changeRequestId     String?                   // mirrors to ChangeRequest, like SelfUpgradeRun
  scheduledWindowId   String?                   // DeploymentWindow
  recoveryPointId     String?                   // pre-action snapshot where DPF-managed
  status              String  @default("queued") // queued|dispatched|running|succeeded|failed|rolled-back|timed-out
  result              Json    @default("{}")     // exit code, stdout/stderr summary, post-version
  evidence            Json    @default("{}")     // health-check, before/after version, signatures
  rollbackOf          String?                   // self-relation for rollback actions
  startedAt / completedAt  DateTime?
  // + PatchPlan FK (§6.4)
```

**New Edge Node token scope + capability** (extends the *closed* vocabularies in the Edge Node spec):
- Token scope `action:dispatch` (server→node delivery), `action:report` (node→server result).
- Capability `capability.action.execute` with the existing per-capability **mode** (`disabled` by default; operator flips to `enabled` per node) **and an `actionType` allowlist** so a node may be allowed `inventory.collect` but not `patch.apply`.

### 6.4 Orchestration — `PatchPlan` + `PatchPolicy` (NEW)

```
PatchPlan                                   PatchPolicy (per customer/site/host-group)
  planKey        @unique                      policyKey       @unique
  scope          Json  // host group/site     scope           Json
  softwareProductId / targetVersion           autoApprove     Json  // { securityCritical:"auto-in-window",
  strategy       String // canary|rolling|all                        //   major:"manual", feature:"manual" }
  windowId       String?                       rebootPolicy    String // never|in-window|prompt
  approvalState  String                        blackoutRefs    Json
  status         String                        windowRefs      Json
  // children: RemoteAction[]                   // the "single approved-state queue" model (NetLock)
```

`PatchPlan` fans a target set into per-host `RemoteAction` children, ordered by `strategy` (canary first → observe health → rolling → broad). `PatchPolicy` is the standing rule that decides which gaps auto-promote into plans (the universal default: **security-critical auto-applies in-window; major versions are always manual**).

### 6.5 Reuse map (no new code where DPF already has it)

`DeploymentWindow` · `BlackoutPeriod` · `windows-eval` · `auto-window` · `quiescence` · `recovery-point`/`rollback` · `ChangeRequest` · `check_deployment_windows` · `AssuranceFinding` · `BomComponent` · `DiscoveredSoftwareEvidence` · `InventoryEntity` · `EdgeNode`/`EdgeNodeCapability` · `CustomerAccount`/`CustomerSite` · `SCHEDULED_JOB_CATALOG`.

---

## 7. The agent question — extend the Edge Node, don't add a second agent

The brief says "we may need an agent installed." **DPF already installs one** — the Edge Node, with a battle-tested enrollment ceremony, principal identity, trust lifecycle, per-capability modes, secure token storage, and a one-liner remote installer (`remote-provisioning.ts`). Adding a second agent (osquery's own server, a Tactical RMM agent) would fragment trust and identity.

**Plan:** the Edge Node **supervises** osquery (spawns it, reads its tables) for deep inventory, and gains a governed execution capability that shells the native package managers for apply. osquery and the package managers are *tools the node drives*, not independent agents with their own control plane.

**Security posture for execution (non-negotiable):**
1. **Off by default.** `capability.action.execute` mode is `disabled` until an operator enables it per node, per `actionType`.
2. **Every mutating action requires:** capability enabled ∧ token scope present ∧ a `ChangeRequest` ∧ (for non-security-routine) approval ∧ inside a `DeploymentWindow` and not in a `BlackoutPeriod`.
3. **Recovery before mutation** where the host is DPF-managed; **health-check after**; **auto-rollback** on failed health (reusing the self-upgrade pattern).
4. **Machine-bound trust is a prerequisite.** The Phase-0 Edge Node token is a per-node bearer, **not machine-bound** (Edge Node spec §"Phase 0 token-binding posture"). Execution capability must **depend on** the Phase-1 hardened binding (mTLS / DPoP / platform-attested key) — we do not ship `patch.apply` on a bearer token. This is an explicit cross-epic dependency on `EP-EDGE-NODE`.
5. **Least privilege, deny by default** (kernel commandment) — the `actionType` allowlist and per-node mode enforce it.

---

## 8. MSP cross-org pattern — proposal, not action

For the MSP archetype there are two topologies (from `EP-MSP-FEDERATION` / the federation design):

- **Topology A — MSP runs DPF, customer is a scoped estate.** The customer's hosts enroll Edge Nodes into the MSP's DPF. Patch actions are MSP-internal and scoped by `customerAccountId`/`customerSiteId`. The substrate is fully present; this is the near-term delivery path.
- **Topology B — both sides run DPF (customer keeps sovereignty).** The MSP must **never** execute directly inside the customer's boundary. The MSP's patch assessment produces a **proposal** carried over the `FederationLink` (the cross-org primitive proposed in `EP-MSP-FEDERATION`); the proposal lands on the customer's **Attention Surface** (`EP-ATTENTION-SURFACE`); the customer's **own Authority Core approves**, and the customer's **own Edge Node executes**. A consented, scoped projection of the result returns to the MSP. This is **proposal-not-action**, the same boundary the federation work already established for remediation.

`RemoteAction.approvalState` + the federation link are what make this safe: an MSP-originated action on a sovereign customer can reach at most `proposed`; only a customer principal can move it to `approved`.

---

## 9. Phasing (value early, risk gated)

| Phase | Deliverable | Risk | Composes |
| --- | --- | --- | --- |
| **P0 — Assessment (keystone)** | `SoftwareProduct` catalog (resolve `softwareIdentityId`) + version-intelligence feed (OSV generalized beyond npm + native "available" metadata) → emit `AssuranceFinding(patch-gap)` → **read-only "what's out of date / vulnerable across the estate" surface + MCP tool.** No execution. | **None** (read-only) | EP-ASSURANCE-LEDGER, EP-ARCH-GRAPH-LIVE |
| **P1 — Deep inventory** | osquery through the Tool Evaluation Pipeline; Edge Node supervises it; wire `capability.discovery.software` to enrich `DiscoveredSoftwareEvidence`. | Low | EP-EDGE-NODE, EP-GOVERN-002 |
| **P2 — Execution primitive (keystone)** | `RemoteAction` model + `capability.action.execute` + `action:dispatch`/`action:report` scopes; dispatch + result capture; **safest actions first** (`inventory.collect`, then DPF-self patch); ChangeRequest mirror + recovery + health-check + rollback. **Depends on EP-EDGE-NODE hardened token binding.** | Med (gated) | EP-EDGE-NODE, EP-UPGRADE-LIFECYCLE |
| **P3 — Apply backends + orchestration** | winget/apt/dnf/brew/WUA executors; `PatchPlan` (canary→rolling) + `PatchPolicy` (auto security-critical in-window); reboot handling. | Med (gated) | EP-SCHEDULING-SURFACE |
| **P4 — MSP cross-org** | proposal-not-action over `FederationLink`; customer-side approve + execute; scoped projection back. | High (sovereignty) | EP-MSP-FEDERATION, EP-ESTATE-SOVEREIGNTY, EP-ATTENTION-SURFACE |

**The keystone is P0** — it lands the single most valuable thing (a live, estate-wide "you are N patches / M CVEs behind" picture for self + discovered hosts) with **zero execution risk and almost no new tables**, because it composes the Assurance Ledger.

---

## 10. UX surface (non-technical operator)

Patch posture is a **compliance-reporting** surface, so it composes the report-kit palette (AGENTS.md §12) — `StatusBadge` / `DataTable` / `StatCard`, status→intent via `statusColors`, never a hand-rolled badge. The default view answers three plain questions (progressive disclosure, 3–5 choices, derive don't ask):

1. **"Is my estate up to date?"** — one posture badge per host/site (Green / Behind / At-risk), derived from `AssuranceFinding(patch-gap)` severity.
2. **"What needs me?"** — the patches awaiting a decision land on the **Attention Surface** ("Needs you" inbox, `EP-ATTENTION-SURFACE`), never buried in a backlog.
3. **"What happened?"** — patch history via `RemoteAction` + `ChangeRequest`, same change-ledger the self-upgrade path already populates.

The UX-Fit gate (§12) applies to every new control; "apply now vs. schedule" and "auto-approve security patches" are the only operator switches, both with safe defaults.

---

## 11. Risks & open questions

1. **Third-party catalog cost.** Driving native package managers (§3.3) avoids a curated installer repo, but coverage = "whatever winget/apt/brew know." Gaps (niche line-of-business apps) will need either vendor adapters or a curated tier later — explicitly out of P0–P3 scope.
2. **Reboot orchestration** is the operational hard part (especially Windows servers); P3 must treat reboot as a first-class, policy-gated, windowed action, not a side effect.
3. **Machine-bound trust dependency.** P2 cannot ship until Edge Node token binding hardens (§7.4). If that slips, P0/P1 (read-only) still deliver standalone value.
4. **osquery footprint.** ~50–100 MB agent; acceptable for servers/desktops, reconsider for constrained edge. The existing lightweight host collector remains the fallback.
5. **License vigilance.** osquery (Apache-2.0) and OSV (Apache-2.0) are safe to embed; **Tactical RMM and Chocolatey-for-Business are not** for an MSP offering — keep them out of the dependency boundary (New Dependency Gate, `EP-ASSURANCE-LEDGER`).

---

## 12. Backlog mapping

New epic **`EP-PATCH-MANAGEMENT`** with the phased BIs of §9; keystone = the P0 read-only assessment. Each BI names the epic(s) it composes so the work relates rather than duplicates. The osquery/OSV adoption is gated by an `EP-GOVERN-002` Tool Evaluation Pipeline item before any embed lands.
