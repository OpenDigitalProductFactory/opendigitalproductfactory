# Supply Chain and Desired-State Assurance Design

| Field | Value |
|-------|-------|
| **Status** | Draft — architect-reviewed 2026-05-21 |
| **Created** | 2026-05-21 |
| **Author** | Codex + Mark Bodman |
| **Architect review** | Opus 4.7 (chief architect persona) 2026-05-21 — substrate-verified existing models, flagged finding-substrate reconciliation as the top open issue (see §3.3) |
| **Primary Surfaces** | Build Studio, Product Registry, AI Operations Map, Compliance, Edge Node |
| **Related live epics** | `EP-ASSURANCE-LEDGER`, `EP-BUILD-STUDIO`, `EP-AI-OPSMAP`, `EP-MCP`, `EP-CI-GATES`, `EP-PROVENANCE` |
| **Research baseline** | Black Duck SCA, Puppet Enterprise, Chef Infra / Automate / InSpec, CycloneDX, SPDX, NTIA SBOM minimum elements, SLSA, OpenSSF Scorecard |

---

## 1. Problem Statement

DPF has the beginning of a governed product factory: Build Studio records artifact revisions,
tool calls write receipts, compliance has control/evidence tables, the Product Registry has
digital products, and the Edge Node work is building runtime inventory. But the platform still
does not have a single assurance answer to:

- What open-source, third-party, container, AI model, and infrastructure components are in this
  product?
- Which vulnerabilities, license obligations, end-of-life packages, or malicious-package signals
  affect them?
- Which running assets are out of desired state, missing patches, or drifting from approved
  configuration?
- Which findings block a build, which findings become backlog work, and which findings prove a
  compliance control is satisfied?
- Which remediation action is safe, scheduled, reversible, and backed by evidence?

The current posture is fragmented. `apps/web/lib/integrate/security-scan.ts` is a useful local
diff scanner, but it is regex-based, scans changed lines, and is not a software composition
analysis or fleet compliance engine. The SBOM Management Agent and Security Auditor Agent prompts
describe the right jobs, yet their core grants are documented as aspirational. The approved tools
registry exists, but `packages/db/data/approved_tools_registry.json` currently contains an empty
`tools` array. DPF can say that supply-chain and security agents should exist; it cannot yet persist
the evidence those agents need to operate.

This spec defines a shared **Assurance Ledger** that brings together Black Duck-style supply-chain
assurance and Puppet/Chef-style desired-state assurance without turning DPF into a clone of any one
tool. The DPF advantage should be that assurance findings are tied to products, builds, coworkers,
runtime assets, controls, provenance receipts, and backlog decisions in one governed operating
system.

---

## 2. Research and Benchmarking

### 2.1 Commercial products

| Product | What it does well | Pattern DPF should adopt | Pattern DPF should not copy |
|---------|-------------------|--------------------------|-----------------------------|
| [Black Duck SCA](https://www.blackduck.com/software-composition-analysis-tools/black-duck-sca.html) | Software composition analysis, SBOM import/export, vulnerability management, license compliance, policy enforcement, SDLC integrations, container/binary/snippet analysis, post-deploy risk monitoring. Black Duck lists SPDX and CycloneDX export, vulnerability/security advisory data, remediation guidance, malicious-package detection, and continuous monitoring across the SDLC. | Treat SBOM as a persistent product artifact, not a generated report. Track component identity, provenance, vulnerability/license/policy findings, emergent risk, and release gates. | Do not make DPF a proprietary scanner database. Use vetted scanner adapters and commercial connectors where approved, but keep the ledger and decision model platform-owned. |
| [Puppet Enterprise](https://www.puppet.com/products/puppet-enterprise) | Desired state, patch workflows, vulnerability remediation, CIS/STIG compliance, event-driven automation, self-service automation, impact analysis before code merge, and edge/network device management. Puppet explicitly surfaces patch groups, scheduling, blackout windows, Windows/Linux patch status, and impact preview. | Desired-state policy should be visible before execution, with impact preview, maintenance windows, and role-based approvals. Drift and patch findings need the same evidence model as build findings. | Do not create a second automation authority that fights DPF's own deployment/runtime orchestration. Puppet documentation warns that patch remediation can loop when desired-state management reverts package changes. DPF must model ownership and locks up front. |
| [Chef Infra](https://www.chef.io/products/chef-infra) + [Chef Automate](https://docs.chef.io/automate/) + [Chef InSpec](https://docs.chef.io/inspec/) | Policy-as-code configuration, drift correction, mixed fleet management, cookbooks/recipes, InSpec compliance profiles, dashboards, change history, queryable node data, CIS/STIG reporting, and auditable compliance history. Chef Automate consolidates infrastructure, compliance, application, and security automation data. | Desired-state checks should be reusable policy objects with run history, trend views, and audit-ready reports. Compliance controls should consume machine evidence rather than manual screenshots. | Do not expose a code-first configuration system as the first DPF UX. DPF operators need product and fleet posture first, with code/policy detail available through inspectors and advanced flows. |

### 2.2 Standards and open ecosystem

| Standard or project | Why it matters to DPF | Design implication |
|---------------------|------------------------|--------------------|
| [CycloneDX](https://cyclonedx.org/guides/sbom/external-references/) | Common SBOM format with support for components, services, vulnerabilities, external references, and modern software supply-chain use cases. | First-party BOM persistence should support CycloneDX import/export in Phase 1. Store normalized data, not only raw JSON. |
| [SPDX](https://spdx.dev/use/overview/) | Linux Foundation standard for SBOMs and license expression; SPDX publishes specifications, standard license data, and implementation tooling. | DPF should support SPDX export/import after CycloneDX foundation, and normalize license IDs to SPDX expressions where possible. |
| [NTIA SBOM Minimum Elements](https://www.ntia.gov/report/2021/minimum-elements-software-bill-materials-sbom) | Defines SBOM as a formal record containing details and supply-chain relationships of components used in software, with minimum elements and use cases for transparency. | DPF BOM records must capture identity, supplier, version, relationship/dependency, author/timestamp, and machine-readable format. |
| [SLSA](https://slsa.dev/spec/v1.2/about) | Provides vocabulary and levels for software supply-chain integrity, artifact trust, provenance, and tamper-resistant evidence. | Build Studio should not only generate a BOM. It should link BOM, build provenance, receipts, and verification summaries to a release candidate. |
| [OpenSSF Scorecard](https://scorecard.dev/) | Automated checks for open-source project risk across source, dependency, build, maintenance, and security practices. | Dependency acceptance should include project posture signals, not just CVEs. Scorecard-like checks belong in tool/dependency evaluation adapters. |

### 2.3 Adopted principles

1. **Ledger first:** Findings, BOMs, desired-state runs, and remediation attempts are durable
   product evidence, not transient job logs.
2. **Evidence over claims:** A coworker cannot assert "SBOM complete" or "fleet compliant" unless
   a stored run and receipt can be inspected.
3. **Policy before automation:** Automated remediation follows a recorded policy, impact preview,
   approval rule, maintenance window, and rollback plan.
4. **Adapters, not embedded vendors:** Open-source scanners, commercial platforms, package
   managers, OS patch feeds, and edge probes enter through tool-evaluated adapters.
5. **One finding substrate:** SCA vulnerabilities, license obligations, config drift, missing
   patches, end-of-life software, failed CIS checks, and package-maintainer risk all use the same
   lifecycle and evidence semantics. (See §3.3 for the unresolved reconciliation against existing
   finding-shaped tables — this principle is aspirational until that is addressed.)
6. **Background by default:** Every assurance scan, BOM generation, and desired-state probe runs as
   an async job with progress visible through the coworker panel and the assurance center, never
   blocking a route or page render. This follows the `background-eval-probes` operator feedback.
7. **Hive contribution by construction:** Adapter quality telemetry, normalized component identity,
   and de-identified finding patterns flow through `contribute_to_hive` where the privacy filter
   permits. Vulnerability intelligence aggregated across installs is a primary DPF differentiator
   over single-tenant tools.
8. **Coworker improvement loop per agent:** SBOM Management Agent and Security Auditor Agent each
   get an improvement loop — feedback on false positives, missed findings, severity miscalls, and
   remediation-plan quality flows back to prompt + adapter tuning. Per the platform principle that
   every coworker gets an improvement loop.
9. **DPF is a conduit, not a partner:** Commercial scanner adapters (Black Duck, Snyk Enterprise,
   etc.) require the operator to bring their own license and credentials. DPF never enrolls as a
   commercial partner or brokers vendor relationships. Reuses the integration-conduit principle.

### 2.4 Rejected patterns

- **Report-only SBOM generation.** A downloadable CycloneDX file is necessary, but it is not enough.
  DPF needs normalized components, findings, ownership, and lifecycle state.
- **Route-owned compliance state.** Compliance evidence must not be hidden under a page-specific
  JSON blob. The Compliance module should consume ledger evidence through stable links.
- **Auto-remediation as a first slice.** Puppet/Chef style patching is powerful and dangerous.
  DPF should begin with read-only discovery and human-approved proposals.
- **Scanner sprawl.** Every scanner must pass the Tool Evaluation Pipeline and write into a
  common adapter contract. Do not let every route invent its own severity/status values.

---

## 3. Current DPF Grounding

### 3.1 Existing anchors

| Anchor | Current evidence | How this spec uses it |
|--------|------------------|------------------------|
| `DigitalProduct` | `packages/db/prisma/schema.prisma` has the Product Registry model at `DigitalProduct`. | Product is the primary assurance scope for Build Studio and customer-facing releases. |
| `InventoryEntity` / `InventoryRelationship` | Runtime inventory models already exist and Edge Node plans normalize multi-source observations into canonical inventory. | Fleet assurance attaches desired-state and patch posture to inventory entities instead of creating a separate asset table. |
| `ToolEvaluation` | Tool Evaluation Pipeline tables exist and AGENTS.md requires external MCP/npm/API adoption to pass evaluation. | Scanner and remediation adapters must be evaluated tools. |
| `ToolExecution` / `ToolExecutionReceipt` | Tool calls and receipts exist with build linkage and output digests. | Assurance runs should create receipts or receipt-linked evidence so findings are auditable. |
| `BuildArtifactRevision` / `ArtifactReceiptUsage` | Build artifacts can be versioned and tied to receipt usage. | BOM documents and scan outputs should become first-class build artifacts or receipt-linked assurance artifacts. |
| `ComplianceEvidence`, `Control`, `Regulation` | Compliance already has evidence and control models. | Assurance evidence should satisfy controls without manual copy/paste. |
| `IntegrationCoverageProvider` | Integration coverage models exist for provider posture. | External scanner/connectors can be represented as coverage providers once evaluated. |

### 3.2 Current gaps

| Gap | Evidence | Consequence |
|-----|----------|-------------|
| SBOM agent lacks persistence capability | `prompts/specialist/sbom-management-agent.prompt.md` documents `sbom_read`, `sbom_write`, dependency graph read, tool evaluation read, and integration test create as aspirational. | The agent can describe SBOM management but cannot formally read/write the artifact it owns. |
| Security auditor lacks scan/finding capability | `prompts/specialist/security-auditor-agent.prompt.md` documents `vulnerability_scan`, `dependency_audit`, `supply_chain_verify`, and `finding_create` as aspirational. | The role exists on paper but cannot produce durable machine-readable findings. |
| Approved tools registry is empty | `packages/db/data/approved_tools_registry.json` has `"tools": []`. | Scanner adoption is not yet governed by populated approved-tool metadata. |
| Current scanner is local and narrow | `apps/web/lib/integrate/security-scan.ts` scans git diffs for regex patterns such as SQL injection, XSS, command injection, hardcoded secrets, dependency additions, and destructive schema operations. | It should remain as one adapter/input, but it cannot stand in for Black Duck-style SCA or Puppet/Chef-style desired-state assurance. |
| Initial live MCP check did not surface a direct assurance epic | `list_epics` was queried on 2026-05-21 for assurance/supply/edge overlap. The connector returned the broad live epic set with adjacent work (`EP-BUILD-STUDIO`, `EP-AI-OPSMAP`, `EP-MCP`, `EP-CI-GATES`, `EP-PROVENANCE`) but no direct Assurance/SBOM/desired-state epic title. After architect review and a second overlap sweep, `EP-ASSURANCE-LEDGER` was created with Phase 0/1 backlog items and plan link. | `EP-ASSURANCE-LEDGER` is now the canonical implementation epic for this spec. |

### 3.3 Critical reconciliation: existing finding-shaped models

The current schema already contains at least six tables that carry finding-shaped data and have
overlapping lifecycle semantics. Architect-verified 2026-05-21 against
`packages/db/prisma/schema.prisma`:

| Existing model | Domain | Overlap with proposed `AssuranceFinding` |
|----------------|--------|------------------------------------------|
| `PortfolioQualityIssue` (~L3420) | Portfolio quality reports | Severity, status, ownership, affected object |
| `AuditFinding` (~L5745) | Compliance audits | Status, severity, evidence link, control linkage |
| `WikiLintFinding` (~L7817) | Wiki/documentation lint | Status, severity, normalized run output |
| `EaConformanceIssue` (~L5116) | Enterprise architecture conformance | Severity, owner, lifecycle |
| `LicenseReadinessIssue` (~L3068) | Licensing readiness | Severity, status, evidence |
| `PlatformIssueReport` (~L4084) | Cross-platform issue intake | Status, owner, severity |

This means the "one finding substrate" principle (§2.3 #5) is asserted but not yet structurally
true. The architect-level decision required before Phase 1 lands:

**Option A — Extract a shared `Finding` base now.** Migrate the six existing tables behind a
polymorphic `Finding` row plus per-domain extension tables. Highest long-term value, highest
near-term cost (touches Compliance, EA, Portfolio, Wiki, Licensing, Platform Issues — six teams
of code).

**Option B — Scope `AssuranceFinding` narrowly and tag the divergence as tracked debt.** Phase 1
ships `AssuranceFinding` as a supply-chain + fleet-only table, with an explicit `TechDebt` row
filed for "Unify finding substrate across PortfolioQualityIssue / AuditFinding / WikiLintFinding /
EaConformanceIssue / LicenseReadinessIssue / PlatformIssueReport / AssuranceFinding" before any
seventh finding-shaped model is introduced. Lower immediate risk.

**Architect recommendation: Option B for Phase 1**, with a hard gate before Phase 2 — Phase 2's
compliance linkage forces a real decision because `AuditFinding` and `AssuranceFinding` will both
need to satisfy controls. If both still exist by Phase 2 entry, the unification work moves into
the Phase 2 critical path.

This reconciliation is not optional and must not be papered over. The §2.3 #5 principle should
read "one finding substrate" as a stated direction; the schema does not yet honor it.

---

## 4. Goals

1. **Product-level supply-chain visibility:** Every releasable digital product has a current BOM,
   normalized components, vulnerability/license/policy findings, and provenance links.
2. **Runtime desired-state visibility:** Every managed asset can report desired-state policy
   membership, drift status, missing patch/vulnerability posture, and last successful check.
3. **Build gate integration:** Build Studio sees assurance as a release gate, not a separate
   after-the-fact audit page.
4. **Compliance evidence reuse:** Controls consume assurance evidence directly, preserving
   collection time, source, scope, and receipt digest.
5. **Governed remediation:** Remediation starts as proposals with blast radius, owner, approval,
   maintenance window, rollback, and post-check evidence.
6. **Excellent operational UX:** Operators get dense, calm, scan-friendly posture surfaces with
   drill-downs, filters, saved views, and action drawers. No marketing hero, no decorative clutter.
7. **Refactoring-first foundation:** At least 20% of the first implementation slice is reserved for
   extracting scanner/finding/grant foundations so future adapters do not duplicate logic.

---

## 5. Non-Goals

- Replacing Black Duck, Puppet, Chef, Snyk, Trivy, Grype, OSV, or OpenSSF Scorecard.
- Shipping automatic patching or configuration mutation in Phase 1.
- Building a complete package vulnerability intelligence database inside DPF.
- Moving existing compliance, inventory, or build data into new tables without a migration plan.
- Supporting every SBOM format in the first slice. CycloneDX comes first; SPDX follows.
- Creating customer-specific one-off policy packs instead of reusable platform policy templates.

---

## 6. Architecture

### 6.1 Conceptual model

```
DigitalProduct / Build / InventoryEntity / ReleaseBundle
            |
            v
      AssuranceScope
            |
            v
  AssurancePolicy ---- AssuranceRun ===1:1=== ToolExecution + ToolExecutionReceipt
            |                 |
            |                 v
            |          AssuranceFinding
            |                 |
            |                 v
            |          RemediationPlan -----> RemediationRun ----> post-check AssuranceRun
            |                 |
            v                 v
    ComplianceEvidence <--- AssuranceEvidenceLink
            |
            v
       Control / Obligation
```

The ledger is shared. Supply-chain scans and desired-state checks differ in inputs and adapters, but
they write the same run/finding/evidence lifecycle.

**Required coupling — `AssuranceRun` ↔ `ToolExecution`:** Every completed `AssuranceRun` must
reference exactly one `ToolExecution` and its `ToolExecutionReceipt`. The relation is logically 1:1
at terminal status. `AssuranceRun` exists in addition to `ToolExecution` because it adds the
semantic envelope tool execution does not carry: policy linkage, scope binding, normalized run
status, and rollup summary. Implementation should treat the FK as required (`toolExecutionId
String`, not `String?`) once the run reaches `passed | failed | partial | error`. While `running`
the FK may be null. This is how supply-chain and desired-state assurance reuse the existing receipt
substrate without duplicating audit semantics.

The semantics are:

- Scope: product, build, artifact, inventory entity, node group, environment, organization,
  release bundle (see `ReleaseBundle` ~L4372 — the existing release-promotion substrate).
- Policy: what should be true.
- Run: when a tool checked it, with versioned adapter metadata and receipt.
- Finding: what failed, severity, ownership, status, and affected object.
- Evidence link: which control, build gate, product release, or backlog item the finding supports.
- Remediation: what action is proposed or executed, by whom, under what approval/window.

### 6.2 Supply Chain Assurance

Supply Chain Assurance answers "what is in this product and is it acceptable to ship?"

Inputs:

- `pnpm-lock.yaml`, `package.json`, workspace manifests.
- Dockerfile/container images and base image digests.
- Generated build artifacts from Build Studio.
- AI model/provider dependencies where model provenance or license obligations matter.
  **First-class AI-model components are required, not deferred:** DPF is an AI-native platform and
  ships agent grants against named model snapshots. `BomComponent.componentType = "model"` must
  carry: provider, family, version/snapshot ID, weights provenance (open weights vs hosted), license
  expression (where declared), context-window/capabilities snapshot, evaluation receipt linkage
  (Tool Evaluation row for the provider), and an `aiModelMetadata` JSON column for provider-specific
  fields. Treating models as ordinary library components loses the differentiator and creates
  duplicate license/safety tracking later.
- Commercial/open-source scanner outputs through evaluated adapters.

Core outputs:

- `BomDocument`: versioned CycloneDX/SPDX document attached to product/build/artifact.
- `BomComponent`: normalized component identity.
- `BomComponentOccurrence`: where a component appears in a product/build/image/service.
- `AssuranceFinding`: vulnerability, license, malicious-package, policy, end-of-life, maintainer
  risk, provenance, or quality finding.
- `ComplianceEvidence`: evidence for secure development, SBOM availability, license review,
  vulnerability remediation, and release approval controls.

First scanner candidates to evaluate:

- `Syft` for SBOM generation.
- `Grype`, `OSV-Scanner`, or `Trivy` for vulnerability scanning.
- `OpenSSF Scorecard` for upstream project posture signals.
- `Black Duck` connector for commercial SCA if the operator has a subscription and the tool passes
  DPF Tool Evaluation.

### 6.3 Desired-State Fleet Assurance

Desired-State Fleet Assurance answers "are my running assets still in the state I approved?"

Inputs:

- Edge Node inventory and telemetry.
- OS package inventory and patch status.
- Configuration snapshots from supported adapters.
- CIS/STIG/InSpec-like check results where available.
- DPF deployment contracts and service health checks.

Core outputs:

- `DesiredStatePolicy`: declarative expectation with target selector and severity.
- `DesiredStateCheckResult`: per-asset result from edge/agentless/adapter checks.
- `AssuranceFinding`: drift, missing patch, unsupported OS/package, failed control, unauthorized
  service, open port, stale agent, or policy mismatch.
- `RemediationPlan`: dry-run impact, required approval, maintenance window, rollback plan, and
  post-check criteria.

First desired-state candidates:

- Read-only Windows/Linux package and patch inventory from Edge Node.
- DPF service/version policy checks for local installs and worktrees.
- CIS/STIG profile ingestion as evidence, not authoring a full profile language yet.
- Puppet/Chef connector import as a future adapter if an operator already uses those systems.

### 6.4 One finding lifecycle

Fixed enum values must be added to TS union definitions and MCP tool schemas in the same commit
before data uses them.

Recommended finding statuses:

| Status | Meaning |
|--------|---------|
| `open` | Finding is active and needs triage or action. |
| `accepted` | Risk is knowingly accepted with approver, expiry, and reason. |
| `planned` | Remediation has been selected and scheduled. |
| `blocked` | Remediation is blocked by dependency, vendor, access, or policy. |
| `resolved` | Remediation completed and post-check evidence passed. |
| `false-positive` | Finding was invalid, with evidence. |
| `deferred` | Not in current scope, must have review date. |

Recommended finding kinds:

| Kind | Typical source |
|------|----------------|
| `vulnerability` | CVE, GHSA, OSV, vendor advisory, scanner feed. |
| `license` | SPDX expression, commercial license, unknown license. |
| `malicious-package` | Scanner/reputation/intelligence source. |
| `policy-violation` | DPF assurance policy. |
| `provenance` | Missing/invalid SLSA or receipt evidence. |
| `configuration-drift` | Desired-state check. |
| `missing-patch` | OS/package patch inventory. |
| `unsupported-component` | EOL runtime, unsupported OS, deprecated dependency. |
| `maintainer-risk` | OpenSSF Scorecard-like posture signal. |

Severity should separate **technical severity** from **business/release impact**, and add
**reachability/exposure** as a first-class dimension so policy can reason about it without
parsing raw scanner output:

- `sourceSeverity`: raw scanner severity (`critical`, `high`, `medium`, `low`, `info`, or vendor
  score).
- `policySeverity`: DPF policy-normalized severity.
- `releaseImpact`: `block`, `warn`, `track`, or `none`.
- `reachability`: `reachable` | `not-reachable` | `unknown` (call-graph or runtime evidence).
- `exposure`: `external` | `internal` | `lab` | `unknown` (deployment-surface evidence).

The combination feeds the WWMD Decision Perspective Kernel (`build-studio-gate.ts`) so release
gating becomes a principle-weighted decision rather than a hand-coded severity ladder.

#### 6.4.1 Stable `findingKey` formula

`findingKey` MUST be deterministic so reruns merge rather than create duplicate rows:

```
findingKey = sha256(
  adapterKey + "::" +
  findingKind + "::" +
  affectedType + "::" +
  affectedId + "::" +
  vendorIdentifier            // e.g. "CVE-2024-12345" or "CIS-1.1.1" or policy ruleKey
).slice(0, 24)
```

Rules:

- `vendorIdentifier` falls back to a normalized title hash if the scanner emits no stable ID, with
  a `findingIdentifierStability` flag set to `weak` so the normalizer knows merge confidence is
  reduced.
- The de-dup contract belongs to the central normalizer (§9.2), never to individual adapters.
- Resolved findings that re-appear must update `lastSeenAt`, increment `reopenCount`, and transition
  status `resolved → open` — never insert a duplicate row.

---

## 7. Proposed Data Model

All models are additive. Names are proposals; final implementation should align with surrounding
Prisma naming and relation conventions.

### 7.1 Shared assurance tables

```prisma
model AssurancePolicy {
  id             String   @id @default(cuid())
  policyKey      String   @unique
  name           String
  description    String?
  policyKind     String   // "supply-chain" | "desired-state" | "compliance" | "release-gate"
  scopeSelector  Json     @default("{}")
  ruleBody       Json     @default("{}")
  severity       String   @default("warning")
  enforcement    String   @default("warn") // "observe" | "warn" | "block" | "proposal-only"
  ownerAgentId   String?
  ownerUserId    String?
  status         String   @default("active")
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

model AssuranceRun {
  id                 String   @id @default(cuid())
  runKey             String   @unique
  policyId           String?
  scopeType          String   // "product" | "build" | "artifact" | "inventory-entity" | "node-group" | "release-bundle" | "org"
  scopeId            String
  adapterKey         String
  adapterVersion     String?
  toolExecutionId    String?  // required at terminal status — enforced in app layer + check constraint, see §6.1
  toolReceiptId      String?  // required at terminal status — same enforcement
  status             String   // "running" | "passed" | "failed" | "partial" | "error"
  startedAt          DateTime @default(now())
  completedAt        DateTime?
  inputFingerprint   String?
  outputDigest       String?
  summary            Json     @default("{}")
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@index([scopeType, scopeId, completedAt])
  @@index([adapterKey, status])
  @@index([policyId, status])
}

model AssuranceFinding {
  id                 String   @id @default(cuid())
  findingKey         String   @unique
  runId              String
  policyId           String?
  findingKind        String
  title              String
  description        String?
  affectedType       String
  affectedId         String
  sourceSeverity     String?
  policySeverity     String
  releaseImpact      String   @default("track")
  reachability       String   @default("unknown") // "reachable" | "not-reachable" | "unknown"
  exposure           String   @default("unknown") // "external" | "internal" | "lab" | "unknown"
  identifierStability String  @default("strong")  // "strong" | "weak" — see §6.4.1
  reopenCount        Int      @default(0)
  status             String   @default("open")
  firstSeenAt        DateTime @default(now())
  lastSeenAt         DateTime @default(now())
  resolvedAt         DateTime?
  acceptedUntil      DateTime?
  ownerAgentId       String?
  ownerUserId        String?
  source             Json     @default("{}")
  evidence           Json     @default("{}")
  remediationHint    Json     @default("{}")
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@index([findingKind, status])
  @@index([affectedType, affectedId])
  @@index([policySeverity, releaseImpact])
  @@index([lastSeenAt])
}

model AssuranceEvidenceLink {
  id                   String   @id @default(cuid())
  findingId            String?
  runId                String?
  complianceEvidenceId String?
  controlId            String?
  buildId              String?
  backlogItemId        String?
  linkKind             String   // "satisfies-control" | "blocks-build" | "tracks-work" | "release-evidence"
  createdAt            DateTime @default(now())

  @@index([findingId])
  @@index([runId])
  @@index([controlId])
  @@index([buildId])
}
```

### 7.2 BOM tables

```prisma
model BomDocument {
  id                String   @id @default(cuid())
  bomKey            String   @unique
  productId         String?
  buildId           String?
  artifactRevisionId String?
  format            String   // "cyclonedx-json" | "cyclonedx-xml" | "spdx-json" | "spdx-tag-value"
  formatVersion     String
  serialNumber      String?
  version           Int      @default(1)
  documentDigest    String
  sourceRunId       String?
  rawDocument       Json
  generatedAt       DateTime
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([productId, generatedAt])
  @@index([buildId])
}

model BomComponent {
  id              String   @id @default(cuid())
  componentKey    String   @unique
  packageUrl      String?
  cpe             String?
  name            String
  version         String?
  supplier        String?
  componentType   String   // "library" | "application" | "container" | "os" | "model" | "service"
  licenses        Json     @default("[]")
  hashes          Json     @default("{}")
  externalRefs    Json     @default("[]")
  lifecycleState  String   @default("observed")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([packageUrl])
  @@index([name, version])
}

model BomComponentOccurrence {
  id              String   @id @default(cuid())
  bomDocumentId   String
  componentId     String
  scope           String?  // CycloneDX scope or DPF scope
  dependencyPath  Json     @default("[]")
  evidence        Json     @default("{}")
  createdAt       DateTime @default(now())

  @@unique([bomDocumentId, componentId, scope])
  @@index([componentId])
}
```

### 7.3 Desired-state tables

```prisma
model DesiredStatePolicy {
  id              String   @id @default(cuid())
  policyKey       String   @unique
  name            String
  targetSelector  Json     @default("{}")
  policyKind      String   // "patch" | "package" | "service" | "config" | "control" | "dpf-version"
  checkBody       Json     @default("{}")
  remediationMode String   @default("proposal-only")
  status          String   @default("active")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model DesiredStateCheckResult {
  id                String   @id @default(cuid())
  policyId          String
  inventoryEntityId String
  runId             String
  status            String   // "pass" | "fail" | "unknown" | "not-applicable"
  observedValue     Json     @default("{}")
  expectedValue     Json     @default("{}")
  checkedAt         DateTime @default(now())
  createdAt         DateTime @default(now())

  @@unique([policyId, inventoryEntityId, runId])
  @@index([inventoryEntityId, checkedAt])
  @@index([policyId, status])
}
```

### 7.4 Remediation tables

```prisma
model RemediationPlan {
  id                 String   @id @default(cuid())
  planKey            String   @unique
  findingId          String
  actionKind         String   // "upgrade-package" | "patch-os" | "change-config" | "replace-tool" | "accept-risk"
  targetType         String
  targetId           String
  dryRunSummary      Json     @default("{}")
  blastRadius        Json     @default("{}")
  approvalStatus     String   @default("draft")
  maintenanceWindow  Json     @default("{}")
  rollbackPlan       Json     @default("{}")
  createdByAgentId   String?
  createdByUserId    String?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}

model RemediationRun {
  id                 String   @id @default(cuid())
  runKey             String   @unique
  planId             String
  toolExecutionId    String?
  toolReceiptId      String?
  status             String   // "scheduled" | "running" | "succeeded" | "failed" | "rolled-back"
  startedAt          DateTime?
  completedAt        DateTime?
  postCheckRunId     String?
  summary            Json     @default("{}")
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}
```

### 7.5 Polymorphic FK rationale and constraints

`AssuranceRun.scopeType/scopeId` and `AssuranceFinding.affectedType/affectedId` are intentionally
polymorphic because the ledger spans `DigitalProduct`, `Build`, `BuildArtifactRevision`,
`InventoryEntity`, `ReleaseBundle`, and `BomComponent` — Prisma cannot express a non-degenerate
union FK without one column per relation. The trade-off is accepted with three guardrails:

1. **Closed enum, enforced at the app layer.** `scopeType` and `affectedType` are TypeScript union
   types in shared `packages/db` exports; adapter normalizers and route handlers validate before
   write.
2. **Resolver helpers, not raw joins.** Reads go through `resolveAssuranceTarget(type, id)` rather
   than ad-hoc joins per route. Missing rows fail-loud, not silent-null.
3. **Convenience FKs for the hottest scopes.** `AssuranceFinding` gets nullable typed FKs for the
   three highest-volume affected types — `bomComponentId`, `inventoryEntityId`, `buildArtifactRevisionId`
   — populated alongside the polymorphic pair when applicable, so the UI can join without the
   resolver. This is the standard Prisma pattern for "polymorphic + integrity for the common case."

### 7.6 Hive contribution surface

```prisma
model AssuranceHiveContribution {
  id                String   @id @default(cuid())
  contributionKey   String   @unique
  findingId         String?
  runId             String?
  contributionKind  String   // "adapter-quality" | "component-identity" | "vulnerability-pattern" | "policy-template"
  payloadDigest     String
  payload           Json
  redactionProfile  String   // "public" | "anonymized" | "blocked"
  submittedAt       DateTime?
  hivePrUrl         String?
  status            String   @default("pending") // "pending" | "submitted" | "accepted" | "rejected" | "blocked"
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([contributionKind, status])
}
```

The hive pathway is not optional. Per platform principle, every governed substrate contributes
anonymized telemetry where the privacy filter allows it. For assurance this means: adapter
quality (precision/recall against operator feedback), normalized component identity (which
package URLs resolve to which canonical components), and vulnerability-impact patterns
(reachability rates, false-positive rates by adapter × kind). Raw scanner output, customer-specific
package names, and internal service names MUST be filtered out by the redaction profile before
submission. The existing `contribute_to_hive` MCP tool is the dispatch surface — do not invent a
parallel path.

### 7.7 Storage anti-patterns

Do not put BOMs, vulnerability results, patch state, or desired-state drift inside
`InventoryEntity.properties` or `DigitalProduct.metadata` as primary storage. Those JSON fields can
cache rollups for fast UI rendering, but the ledger needs queryable rows with stable keys,
indexes, lifecycle state, and evidence links.

---

## 8. UI and UX Design

The Assurance experience should feel like a serious operator console: dense, legible, fast to scan,
and calm under pressure. It should use the DPF theme variables from AGENTS.md (`--dpf-bg`,
`--dpf-surface-1`, `--dpf-surface-2`, `--dpf-text`, `--dpf-muted`, `--dpf-border`, `--dpf-accent`)
and must not hardcode color classes.

**Async-first UX contract:** No assurance action — scan, BOM generate, fleet probe, remediation
dry-run — runs synchronously in a route handler or server action. Every trigger enqueues a
background job, returns immediately, and surfaces progress through the coworker busy state and
the assurance center activity rail. Tables and KPIs update on job completion, never block render,
and degrade to last-known state when an adapter is unreachable.

### 8.1 Navigation

Recommended IA:

- `/platform/assurance` as the cross-cutting assurance center.
- Product Registry product detail: `Supply Chain` tab.
- Inventory/AI Operations Map: `Drift & Patch` panel per asset/group.
- Build Studio: `Assurance Gate` card in verification/release steps.
- Compliance: `Executable Evidence` tab that shows linked assurance runs and controls.

This should not live under a single scanner route. The assurance center is the command surface; the
same findings appear contextually wherever the operator is already working.

### 8.2 Assurance Center

Layout:

- Top row: compact KPIs for release blockers, high-risk open findings, stale BOMs, assets drifting,
  unapproved adapters, and evidence collected in the last 24 hours.
- Left rail: saved views and scope filters (`Products`, `Builds`, `Fleet`, `Controls`, `Adapters`).
- Main table: findings with stable columns: severity, release impact, affected object, source,
  owner, status, last seen, next action.
- Right drawer: finding detail with evidence timeline, affected dependency/asset graph, policy,
  scanner output, remediation options, linked controls, linked backlog items, and receipt digest.

Controls:

- Use segmented controls for scope.
- Use filter chips for kind/status/severity/release impact.
- Use icon buttons with tooltips for refresh, export, create backlog item, accept risk, and open
  remediation drawer.
- Use drawers for detail and modals only for irreversible actions.

### 8.3 Build Studio Assurance Gate

The Build Studio card should answer four questions without making the operator leave the workflow:

| Question | UI treatment |
|----------|--------------|
| Is there a current BOM for this build? | Green/warn/block state with document version, generated time, and digest. |
| Are release-blocking findings open? | Compact grouped list by kind and affected artifact. |
| Which policy produced the block? | Inline policy label with link to drawer. |
| What is the next safe action? | Primary action: create remediation plan, update dependency, accept risk with expiry, or rerun scan. |

The card should preview the exact PR/release consequence: `blocks PR`, `warns but allows PR`,
`creates backlog item`, or `evidence only`.

### 8.4 Product Supply Chain Tab

Product detail should show:

- BOM history by build/release, with current/stale marker.
- Component table with package URL, version, supplier, license, scope, vulnerability count, and
  policy status.
- Dependency graph view with limited depth controls and search.
- License obligations summary.
- AI model and container/base-image rows as first-class components.
- Export actions for CycloneDX and, later, SPDX.

### 8.5 Fleet Drift and Patch View

Inventory and AI Operations Map should show:

- Asset posture badge: compliant, drifting, missing patch, unsupported, unknown.
- Policy membership: which desired-state policies target the asset.
- Last check: time, source adapter, receipt digest, and run status.
- Drift details: observed vs expected, with clear diff.
- Patch remediation preview: affected nodes, package changes, restart/reboot needs, maintenance
  window, rollback, and post-check.

### 8.6 Compliance Evidence View

Compliance should not ask the operator to re-upload proof. It should show assurance evidence as:

- Control coverage matrix: controls mapped to latest passing/failing assurance runs.
- Evidence detail: run, tool, adapter version, scope, input fingerprint, output digest, collection
  time, retained raw document.
- Exception list: accepted risks with expiry and approver.
- Auditor export: filtered evidence bundle with BOM, findings, policies, and run receipts.

---

## 9. Refactoring Budget

Reserve at least 20% of the first implementation slice for cleanup that prevents scanner and
finding sprawl.

### 9.1 Extract scanner adapter contracts

Current `security-scan.ts` should become one adapter behind a shared interface:

```ts
export interface AssuranceAdapter {
  adapterKey: string;
  adapterVersion: string;
  supportedScopes: AssuranceScopeType[];
  run(input: AssuranceRunInput): Promise<AssuranceRunOutput>;
}

export interface AssuranceRunOutput {
  status: "passed" | "failed" | "partial" | "error";
  summary: Record<string, unknown>;
  findings: NormalizedAssuranceFinding[];
  artifacts: AssuranceArtifact[];
}
```

Benefits:

- Existing regex diff scan keeps working.
- Syft/Grype/OSV/Trivy/OpenSSF/Black Duck connectors plug in without route-specific logic.
- Build Studio, Compliance, and AI coworkers read one normalized output.

### 9.2 Centralize finding normalization

Create a single normalizer that maps vendor output into DPF kinds/severities/statuses. Do not let
each adapter decide enum strings.

Responsibilities:

- Stable `findingKey` generation.
- Severity and release-impact mapping.
- Affected object resolution (`BomComponent`, `InventoryEntity`, `BuildArtifactRevision`, etc.).
- Evidence digesting and raw-output retention.
- De-duplication across repeated runs.

### 9.3 Centralize capability/grant readiness

The platform currently has agent grants that are listed but aspirational. Before enabling the SBOM
and Security Auditor agents, add a shared readiness check that can answer:

- Is this grant present in the catalog?
- Is it mapped to a runtime tool?
- Is the current user role allowed?
- Is the current agent profile granted?
- Does the MCP token scope allow it?
- Does the selected adapter pass Tool Evaluation?

This prevents UI and coworkers from claiming actions that cannot run.

### 9.4 Create a scanner/tool catalog reader

Do not hardcode scanner names in UI components. Use a registry reader that can combine:

- `approved_tools_registry.json`.
- Tool Evaluation rows.
- Integration coverage providers.
- Runtime adapter availability.

The first slice can show an empty/needs-evaluation state honestly when no scanner is approved.

---

## 10. Governance and Safety

### 10.1 Tool Evaluation Pipeline

All scanner/remediation adapters are external tools and must pass EP-GOVERN-002 before adoption.
This applies to open-source binaries, commercial APIs, MCP servers, package-manager plugins, and
OS patch providers.

Minimum evaluation dimensions:

- Security of installation and execution.
- Network behavior and credential handling.
- License/commercial terms.
- Output format stability.
- Update cadence and version pinning.
- Sandbox behavior and rollback.
- Data retention and privacy.

### 10.1.1 Commercial scanners — conduit, never partner

DPF does not enroll as a commercial partner for Black Duck, Snyk Enterprise, Veracode, or any
similar product. Operators bring their own license, credentials, and vendor agreement; DPF
provides the adapter, the ledger, and the UX. The Tool Evaluation pass for a commercial scanner
must record the operator's license source and renewal expectations. This protects DPF from the
broker liability that would otherwise come with shipping connectors to paid SaaS.

### 10.2 Coworker improvement loops (required)

The SBOM Management Agent and Security Auditor Agent each ship with an improvement loop, per the
platform principle that every coworker gets one. Loop inputs:

- Operator acceptance / dismissal of findings (false-positive signal).
- Reopen rate per finding kind × adapter (false-negative signal).
- Remediation-plan execution success and rollback rate (action quality).
- Time-to-triage and time-to-resolution by severity (operational health).

Loop outputs feed prompt revisions, adapter selection weights, and severity-normalization tuning.
Improvement loops MUST land in the same phase as the agent's first writeable grant — no aspirational
loops.

### 10.3 Remediation guardrails

No auto-remediation in Phase 1 or Phase 2. Later remediation must enforce:

- Human approval for every production-changing action until policy proves it is safe.
- Maintenance window support.
- Dry-run/impact preview before execution.
- Single owner of desired state for a package/config path to prevent Puppet-style remediation loops.
- Locking around assets/packages during remediation.
- Pre-check and post-check evidence.
- Rollback plan and rollback receipt.
- Backlog linkage when remediation cannot be completed immediately.

### 10.4 Data governance

- BOM raw documents may contain proprietary package names or internal service names; treat them as
  confidential by default.
- Vulnerability findings may reveal exploitable systems; restrict access by role and agent grants.
- Exported auditor bundles should redact secrets and internal-only URLs unless the export policy
  explicitly permits them.
- Accepted risks require expiry, approver, and reason. No permanent silent accepts.

---

## 11. Implementation Phases

### Phase 0 - Spec, backlog, and foundation refactor

Deliverables:

- This spec approved.
- Re-sweep `origin/main` and `query_backlog` for the keywords `assurance`, `SBOM`, `supply-chain`,
  `desired-state`, `vulnerability`, `drift`, `patch` immediately before backlog creation, to honor
  the continuous-overlap-sweep principle. Concurrent sessions may have filed adjacent work since
  this spec was drafted.
- Verify live epic `EP-ASSURANCE-LEDGER` remains the canonical epic for this spec. If a future
  overlap sweep surfaces an older or duplicate epic in this space, reconcile it and document the
  decision.
- Verify the finding-substrate debt record `BI-REFACTOR-CC46703A` remains linked to the Phase 0
  evidence trail.
- Add backlog items for Phase 1.
- Extract scanner adapter interfaces and finding normalization contracts.
- Add readiness checks for aspirational SBOM/security grants.

Exit criteria:

- Existing Build Studio regex scanner still passes current tests.
- No new UI claims an unavailable scanner capability.
- Backlog is linked to the approved spec.
- `EP-ASSURANCE-LEDGER` (or the reconciled epic) exists in the live system and shows this spec
  as its design-doc reference.
- Finding-substrate tech-debt row exists and is visible in Portfolio Quality.

### Phase 1 - Read-only Supply Chain Assurance

Scope:

- Generate CycloneDX BOM for the web workspace from `pnpm-lock.yaml`.
- Store `BomDocument`, `BomComponent`, and `BomComponentOccurrence`.
- Run one evaluated vulnerability scanner adapter in read-only mode.
- Persist normalized findings.
- Show Product Supply Chain tab and Build Studio Assurance Gate read-only state.

Candidate tools:

- Syft for BOM generation.
- Grype or OSV-Scanner for vulnerability findings.
- Existing regex scanner remains a Build Studio local-code adapter.

Exit criteria:

- A build can produce a BOM with a digest.
- Product view shows components and findings.
- Build Studio shows warn/block state from policy.
- Export CycloneDX JSON works.
- No automatic remediation.

### Phase 2 - Compliance and provenance linkage

Scope:

- Link assurance runs/findings to `ComplianceEvidence`, `Control`, and `ToolExecutionReceipt`.
- Add auditor evidence view.
- Add SLSA/provenance summary in Build Studio by linking BOM, receipts, and build artifacts.
- Add backlog creation from findings.

Exit criteria:

- A control can show latest passing/failing assurance evidence.
- A release candidate can show BOM + scan + receipt bundle.
- Findings can create/link backlog items without losing source evidence.
- Finding-substrate reconciliation (§3.3) has a landed decision: either `AssuranceFinding` and
  `AuditFinding` are unified, or the deferral has a dated `TechDebt` row with an explicit owner
  and a "no seventh finding table" guard at the schema-review layer.
- First `AssuranceHiveContribution` rows exist locally (status `pending` or `submitted`) with
  adapter-quality telemetry and de-identified component identity for the platform's own
  dependencies. Hive contribution is not a Phase 5 polish item.

### Phase 3 - Read-only Desired-State Fleet Assurance

Scope:

- Add desired-state policy/check result tables.
- Ingest Edge Node package/version/patch/readiness observations for Windows/Linux first.
- Show Drift & Patch view in inventory/AI Operations Map.
- Persist drift/missing-patch/unsupported-component findings.

Exit criteria:

- Assets show last desired-state check and drift status.
- Findings link to inventory entities and policies.
- No configuration or patch changes are made automatically.

### Phase 4 - Remediation proposals

Scope:

- Generate remediation plans from findings.
- Support dry-run/impact preview.
- Support approval workflow, maintenance windows, rollback plan, and post-check criteria.
- Create planned backlog items for remediation work.

Exit criteria:

- Operator can create a remediation plan from a finding.
- Plan shows blast radius and rollback before approval.
- Plan does not execute changes yet unless marked lab-only.

### Phase 5 - Governed remediation execution

Scope:

- Execute low-risk remediation through approved adapters.
- Record `RemediationRun`, `ToolExecutionReceipt`, and post-check `AssuranceRun`.
- Support rollback execution and evidence.

Exit criteria:

- Only approved policy categories can execute automatically.
- Production changes require configured approvals.
- Every execution has pre/post evidence and rollback status.

---

## 12. Testing and Verification

### 12.1 Unit and contract tests

- BOM parser fixtures for CycloneDX JSON.
- Component identity normalization fixtures, including package URL and missing supplier cases.
- Finding normalizer fixtures for scanner outputs.
- Stable key generation tests for findings and components.
- Grant/readiness resolver tests for present, aspirational, unmapped, denied-role, denied-agent,
  insufficient-token-scope, and unapproved-adapter cases.
- Desired-state result tests for pass/fail/unknown/not-applicable.

### 12.2 Integration tests

- Build Studio build produces BOM and assurance run.
- Scanner output creates findings and de-duplicates on rerun.
- Compliance evidence links to a control.
- Backlog item creation from finding preserves finding/evidence references.
- Edge Node inventory result creates desired-state check result in read-only mode.

### 12.3 UI verification

For every UI slice:

- Verify light/dark/brand theme using DPF CSS variables only.
- Verify table columns do not overflow at desktop and mobile widths.
- Verify empty states for "no approved scanner", "no BOM yet", and "adapter unavailable".
- Verify drawer detail includes source, evidence, owner, status, and next action.
- Verify Build Studio gate copy makes release impact explicit.
- Verify Compliance evidence view distinguishes current evidence from stale evidence.

### 12.4 Build gate

Implementation branches must follow AGENTS.md:

- Affected unit tests.
- `pnpm --filter web typecheck`.
- Production build for final implementation slices.
- UX verification against the Docker-served app for UI changes.
- Migration applies cleanly for schema slices.

---

## 13. Acceptance Criteria

This spec is accepted when:

1. It is linked from a live epic or backlog item after MCP overlap check.
2. Phase 1 has a backlog slice that is read-only and does not auto-remediate.
3. The first implementation slice reserves explicit refactoring work for adapter/finding/readiness
   foundations.
4. The data model uses queryable ledger rows rather than JSON blob primary storage.
5. UI design places assurance inside Build Studio, Product Registry, Inventory/AI Ops Map, and
   Compliance instead of only creating a scanner page.
6. External scanner adoption is gated by Tool Evaluation Pipeline.
7. Compliance evidence linkage is part of the design, not a later manual export.
8. The §3.3 finding-substrate reconciliation has a recorded decision (Option A or Option B) with
   a `TechDebt` row if Option B.
9. AI model components are first-class in `BomComponent` from Phase 1, not deferred.
10. `AssuranceRun` ↔ `ToolExecution` is 1:1 at terminal status — no orphan assurance runs.
11. Every assurance trigger is a background job; no synchronous scan/probe blocks a route.
12. SBOM Management Agent and Security Auditor Agent ship with their improvement loops wired in
    the same phase as their first writeable grant.
13. Hive contribution rows are produced by Phase 2; no scanner adapter ships without a redaction
    profile.
14. Commercial scanner adapters require operator-supplied license; DPF records no partner
    relationship.

---

## 14. Open Questions

Architect-resolved where possible; remaining items flagged with **OPEN**.

1. **Commercial vs open-source first.** *Architect call: open-source first.* Phase 1 uses Syft +
   Grype/OSV only. A Black Duck adapter is welcome but enters the Tool Evaluation Pipeline as a
   tier-2 candidate, never on the Phase 1 critical path. Operators with Black Duck subscriptions
   can opt in once the adapter passes evaluation. This avoids licensing the whole platform's
   visible value to a single commercial dependency.
2. **Route.** *Architect call: `/platform/assurance`.* Cross-cutting operating surface, not a
   tool page.
3. **Release-block policy matrix.** **OPEN** — needs principle-weighted decision through the WWMD
   kernel. Recommended starting policy for Phase 1: `policySeverity=critical AND
   reachability!=not-reachable AND exposure=external` → `block`; everything else → `warn` or
   `track`. Refine through operator feedback rather than hand-tuning.
4. **Desired-state policy authoring language.** *Architect call: DPF-native JSON DSL first;
   InSpec ingestion as evidence-only.* Authoring a profile language is a multi-quarter rabbit
   hole. Ingest InSpec output where it already exists, but do not adopt InSpec as the DPF
   authoring layer — that would couple us to a Chef-specific runtime.
5. **First Windows patch feed.** **OPEN** — needs Edge Node team input. Two viable candidates:
   Windows Update Agent COM API (online) and WSUS scan results (where managed). Decision belongs
   in Phase 3 scoping, not in this spec.
6. **Retention policy.** **OPEN** — recommend default 365 days for raw scanner output, 7 years
   for exported auditor bundles (aligns with common SOX/audit retention), and per-org override
   capability. Finalize during Phase 2 compliance linkage.

---

## 15. Recommended First Slice

Create a Phase 1 implementation plan with one narrow, durable outcome:

> For a Build Studio build of the DPF web workspace, generate a CycloneDX BOM from the pinned
> dependency graph, persist the BOM and normalized components, run one approved read-only
> vulnerability scanner adapter, show the result in a Build Studio Assurance Gate card, and expose
> the BOM/component list on the product detail Supply Chain tab.

This gives DPF the Black Duck-inspired supply-chain foundation first, while the refactoring work
creates the substrate Puppet/Chef-inspired desired-state assurance will reuse. That ordering avoids
two separate assurance systems and gives the platform a visible win without touching production
configuration.
