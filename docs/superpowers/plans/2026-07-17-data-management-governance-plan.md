# Data Management Governance — Implementation Plan

- **Date:** 2026-07-17
- **Spec:** `docs/superpowers/specs/2026-07-17-data-management-governance-design.md`
- **Epics:** EP-DATA-GOVERNANCE (new), EP-DATA-RETENTION (reopened)
- **Capsule:** WC-450D7558

Phases are ordered so that (1) the classification spine lands before everything that consumes it, (2) the highest-risk live exposure (agent-memory embeddings) is closed immediately without waiting for the spine, and (3) enforcement gates land before large enrollment waves so new work cannot regress while we fix old debt. Each backlog item is independently shippable and PR-sized (or explicitly xlarge for decomposition at build time).

## Phase 0 — Stop the live exposure (no dependencies)

**BI-DG-001 — Sensitivity gate + deletion propagation for agent-memory embeddings** (`feature`, medium)
`storeConversationMemory` honors the request's already-computed route sensitivity before writing to Qdrant `agent-memory`: `restricted` → skip storage; `confidential` → store with masked preview (no raw `contentPreview`, no PII fields in payload) per policy. Add deletion propagation: deleting an `AgentMessage`/`AgentThread` (including the retention sweep's `purgeStaleAgentThreads` handler) enqueues `deleteVectors` for the affected message ids. Tests: restricted-route turn produces no vector; purged thread leaves no orphan vectors.
*Files:* `apps/web/lib/inference/semantic-memory.ts`, `apps/web/lib/actions/agent-coworker.ts`, `apps/web/lib/operate/retention/policies.ts` (custom handler), queue function for vector cleanup.

## Phase 1 — Classification spine + growth observability

**BI-DG-002 — Data classification registry with build-failing coverage tests** (`feature`, large)
`apps/web/lib/govern/data-classes.ts` per spec §5.1: closed unions, one entry per Prisma model (~385 — bulk-classified by category with the sensitive minority given field-level entries), `subjectKind` links, `lifecycleClass` total function, `projectionPolicy`, `residencyClass`, `regulatoryBases`. Test suite validates: full coverage against `parsePrismaSchema` facts; purge/retained cross-consistency with the retention registry; invariant rules (credential-secret never embedded; restricted never raw-embedded). Registry projects into the EA data-model mirror as element properties.

**BI-DG-003 — Data-Impact Gate CI check + Build Studio prompt rule + AGENTS.md §11 addendum** (`tool`, medium)
`scripts/check-data-impact.mjs` + workflow job per spec §5.6: PRs adding/renaming Prisma models must touch `data-classes.ts` or carry `Data-Steward-Decision:` trailer. Red-team fixture tests. Matching rule added to `build-agent-prompts.ts`; AGENTS.md documents the gate (pointer to spec).

**BI-DR-101 — Table growth observability + Data Management admin surface** (`feature`, large)
Scheduled collector sampling `pg_total_relation_size`/`reltuples` into a purge-enrolled time-series table + Prometheus export. Admin page (report-kit, UX-fit gated) rendering: retention matrix from the classification registry (enrolled/retained/capped/unbounded), current sizes + growth rates, last sweep results from `ScheduledJob.metadata.recentRuns`, dry-run preview button (existing `dryRun` event). Alert (PlatformIssueReport) when an `unbounded-accepted` or unclassified table exceeds growth thresholds.

**BI-DG-004 — Steward drift detectors for data governance** (`feature`, small)
Extend `runDataArchitectureSteward` with `unclassified-model`, `unenrolled-growth-table`, `classification-projection-conflict` detectors filing self-healing `EaConformanceIssue` rows.

## Phase 2 — Lifecycle completion (EP-DATA-RETENTION reopened)

**BI-DR-102 — Enroll ranked unbounded tables in the retention registry** (`chore`, large)
Per-table policy decisions from spec §5.2.2: `UserFact` (superseded-fact purge; active facts exempt), `PortfolioQualityIssue` (resolved > 180d), `BacklogItemActivity`, `AdminActivity`, `Activity` (CRM — respect regulated floors), `IntegrationToolCallLog`, `RouteOutcome`, `ToolExecutionReceipt`/`CoworkerActionEnvelope`/`AgentActionProposal` (365d audit alignment), `EdgeEvent`/`ChangeEvent`/`RemoteAction` (terminal-state-aware), discovery observation streams, `InboundChannelMessage`/`WorkItemMessage` (chat-class), `IntegrationImportStagedRecord`. Purge indexes migration where composite-only indexes would seq-scan (follow `20260614180000` precedent).

**BI-DR-103 — Revision-cap executor strategy for version/snapshot tables** (`feature`, medium)
New `revision-cap` strategy in `execute.ts` (`keepLast N` + `maxAgeDays`, never dropping current/published) enrolling the 13 revision/snapshot tables (spec §5.2.3).

**BI-DR-104 — Status-aware datasets (old Slice 3)** (`feature`, medium)
Terminal-state-aware enrollment for `TaskRun`/`TaskMessage`/`TaskArtifact`/`TaskNode`, `DecisionInteraction` (+ `EscalationCapture`/`DeferralCapture`).

**BI-DR-105 — Legal hold + disposition evidence** (`feature`, large)
`LegalHold` model (scope = classification categories and/or subject; operator-gated create/release, audited) checked by the sweep engine before any delete; `DispositionRecord` written by every destructive lifecycle action (policy, count, cutoff, checksum). Precedence tests: retention > deletion; longest wins; hold suspends all. Blocks: BI-DG-008 (erasure must respect holds).

**BI-DR-106 — Archival tier: export-then-delete with evidence (old Slice 5)** (`feature`, large)
Per-policy `archive: true` → compressed, checksummed export to the backup volume before delete; restore runbook; disposition record links the artifact.

**BI-DR-107 — Partition-drop strategy for top event streams (old Slice 6)** (`feature`, xlarge)
Registry `strategy: "delete" | "partition-drop"`; migrate the largest streams (per BI-DR-101 data — expected: `ToolExecution`, `AdapterRunTelemetry`, `EdgeEvent`/`SecurityEvent`) to native range partitions with automated create/drop maintenance. Defer trigger: size thresholds from observability, not calendar.

## Phase 3 — Projection governance

**BI-DG-005 — Projection contract registry + scope enforcement** (`feature`, large)
`apps/web/lib/govern/projection-contracts.ts` covering the six families (spec §5.3); build-failing test that each contract's payload class satisfies every source model's `projectionPolicy`; content-class contracts route through the masking service (after BI-DG-007; interim: sensitivity gate from BI-DG-001).

**BI-DG-006 — Deletion propagation + orphan reconciliation + dark-projection alerts** (`feature`, large)
EA-mirror tombstones drive Neo4j `deleteEaElement`/`deleteEaRelationship`; entity deletes enqueue projection-cleanup (Neo4j DETACH DELETE, Qdrant deleteVectors); weekly orphan-reconciliation job (extends `infra-prune`) diffing targets against sources; shared staleness monitor generalizing the code-graph escalation to every contract (SLA per contract, self-healing conformance issues).

## Phase 4 — Protection plane

**BI-DG-007 — Field encryption service + key hierarchy + crypto-shredding** (`feature`, xlarge)
Extend `credential-crypto` to master→purpose→per-subject wrapped keys; app-layer encryption of registry `sensitiveFields` at the model-access seam; fail-loud on missing key outside development; broadened prod guard. Migration encrypts existing plaintext PII (`StorefrontInquiry`, donors, orders contact fields, `UserFact.value` where sensitive, transcripts). Blocks: BI-DG-008.

**BI-DG-008 — DSAR + erasure flows (subject access, anonymize-in-place, derived-copy cleanup)** (`feature`, xlarge)
Subject-access export via registry `subjectKind` correlation; erasure = anonymize-in-place for FK-heavy regulated rows + crypto-shred subject key + derived-copy cleanup enumerated from projection contracts; legal-hold conflict surfacing (Art. 17(3)); operator-gated MCP/admin actions; disposition records. Blocked by: BI-DR-105, BI-DG-005, BI-DG-007.

**BI-DG-009 — Mask-before-context service for AI exposure** (`feature`, large)
`maskForContext(payload, {purpose, principal, sensitivityCeiling})` applied at coworker context assembly, semantic-memory storage (supersedes the interim gate's masking), and tool-result shaping; driven by registry `sensitiveFields` × caller clearance × declared purpose. Outputs inherit source sensitivity via envelope/receipt records.

**BI-DG-010 — Tamper-evident audit chain** (`feature`, medium)
`prevHash`/`rowHash` chaining on audit-class tables (`ComplianceAuditLog`, `SecurityEvent`, `AuthorizationDecisionLog`, `ToolExecutionReceipt`); periodic chain-verification job filing conformance issue on break; documented as the SEC 17a-4 audit-trail posture.

## Phase 5 — Policy plane

**BI-DG-011 — Archetype compliance packs** (`feature`, medium)
Typed `compliancePack` on the archetype registry (regulation refs, default sensitivity tier, retention-floor key, PHI/CHD flags) authored for the existing archetype set (BIAN/healthcare from existing spec material); `compliance-library.ts` + `industry-floors.ts` consume it, retiring string-matching as the source (kept as fallback for unknown archetypes).

**BI-DG-012 — Data policy decision point (MCP tools) + steward skill extension** (`tool`, large)
`get_data_policy` + `check_data_action` (grant-scoped, concise, provenance-free descriptions per context-economy standards; DSAR/hold ops behind operator-gated write grants); extend `dpf-data-architecture-steward` skill with classification stewardship (machine-suggest → human-confirm for new models) and PDP usage guidance; seed for in-portal coworkers.

**BI-DG-013 — Operator + user documentation** (`doc`, small)
User-guide page (plain language: what the platform keeps/protects/purges, holds, DSAR); ops runbook (hold management, erasure, archival restore, partition maintenance); AGENTS.md pointer already landed in BI-DG-003.

## Dependency graph

```
Phase 0: DG-001 (independent, ship first)
Phase 1: DG-002 ──► DG-003, DG-004, DR-101
Phase 2: DR-102..104 (after DG-002 lifecycle classes); DR-105 ──► DG-008; DR-106; DR-107 (after DR-101 data)
Phase 3: DG-005 (after DG-002) ──► DG-006, DG-008
Phase 4: DG-007 ──► DG-008; DG-009 (after DG-002, DG-005); DG-010 independent
Phase 5: DG-011 (after DG-002); DG-012 (after DG-005/DG-009); DG-013 last
```

## Verification per phase

Every BI carries unit tests in-package; runtime-bound gates (production build, migration apply, live UX/sweep evidence) run on the canonical install or the shared local-CI convergence lease per AGENTS.md §5, with `record_execution_evidence`. Red-team gate fixtures land with BI-DG-003 and stay in CI permanently.
