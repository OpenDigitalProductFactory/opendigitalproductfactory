# Data Management Governance — Design

- **Date:** 2026-07-17
- **Status:** Approved for planning (research complete; plan at `docs/superpowers/plans/2026-07-17-data-management-governance-plan.md`)
- **Epics:** EP-DATA-GOVERNANCE (new umbrella), EP-DATA-RETENTION (reopened for lifecycle completion); composes with EP-ESTATE-SOVEREIGNTY, EP-MDM, EP-GRC-001, EP-PLATFORM-SUBSTRATE-CONVERGENCE (BI-PSC-006 bounded contexts)
- **Author:** Claude (external surface), capsule WC-450D7558
- **Goal statement (founder, 2026-07-17):** better data management across (1) projection of tables into the graph, (2) forever-growing tables, (3) retention rules and access sensitivities per industry (patient records, financial records), (4) see/work-with vs. retain distinction, (5) sovereignty — where stored vs. where accessed, (6) encryption and masked exposure, (7) no coworker or human should need to personally know every regulation, and (8) processes so no future feature ships with these concerns unhandled.

## 1. Problem

Data is the "I" in IT and the highest-consequence asset the platform holds. A data leak or an unmet retention obligation can end a customer's business — or DPF's credibility. Today the platform has strong *pockets* of data governance but no *system* of it:

1. **Classification stops at routes and agents.** A 4-level sensitivity taxonomy (`public|internal|confidential|restricted`) classifies routes, coworkers, and AI endpoints (`apps/web/lib/tak/agent-sensitivity.ts`) — but **no table, column, or record carries a classification**. There is no registry saying "StorefrontInquiry.customerEmail is personal data" or "AgentMessage.content is customer content." Every downstream control (masking, encryption, projection scope, retention) lacks its anchor.
2. **Lifecycle covers 19 of ~385 models.** The EP-DATA-RETENTION engine (`apps/web/lib/operate/retention/`) is a sound declarative registry — but the ranked worst unbounded growers are unenrolled: `UserFact` (coworker memory, supersession chains never pruned), `PortfolioQualityIssue` (written every minute by the alert bridge), `BacklogItemActivity`, `AdminActivity`, `IntegrationToolCallLog`, `RouteOutcome`, `ToolExecutionReceipt`, `CoworkerActionEnvelope`, edge/federation streams (`EdgeEvent`, `ChangeEvent`, `RemoteAction`), discovery streams, and all 13 revision/snapshot tables. **Zero growth observability exists** — no table-size metric, no admin view of the retention matrix, no alert as unenrolled tables grow.
3. **Projection into graph/embeddings is governed six different ways.** Six projection families (Prisma→EA ERD, schema drift steward, code graph→Neo4j, 14 SysML parity domains, discovery→portfolio+Neo4j, 4 Qdrant embedding collections) each hand-roll scope, triggers, deletion, and staleness. Deletion semantics diverge sharply: code-graph hard-deletes, the EA mirror soft-tombstones (`mirrorRemoved`) without driving Neo4j deletes (orphan risk), Qdrant `agent-memory` has **no deletion path at all**. Most are fire-and-forget with no "this projection has been dark for N hours" signal (the code-graph reconciler gained one only after a 13-day silent outage).
4. **Sensitive content flows into derived stores ungated.** Coworker conversation content is embedded into Qdrant `agent-memory` on every turn — raw content, 300-char preview, userId — with **no sensitivity gate at storage time**, even though the same request computes route sensitivity to gate *provider selection* (`apps/web/lib/actions/agent-coworker.ts`, `apps/web/lib/inference/semantic-memory.ts`). Embeddings persist after source deletion.
5. **See/work-with vs. retain is not separated.** Encryption covers only credentials/tokens/API keys (`credential-crypto.ts`). Customer PII (`StorefrontInquiry`, `StorefrontOrder`, donors, CRM engagements), coworker chat, memory facts, and raw transcripts are plaintext. No field-level masking exists for AI exposure — sensitivity gates *which provider* sees a prompt, never *which fields* enter the context. No DSAR/erasure flow exists (explicitly deferred by the retention spec). Audit "immutability" is append-only convention with no tamper evidence.
6. **Compliance knowledge is derived by string-matching, not modeled.** Archetypes carry no typed regulatory metadata; `compliance-library.ts` string-matches archetype ids and `BusinessContext` flags at runtime. Retention industry floors exist, but nothing tells a coworker (or a Build Studio agent adding a table) *what regime applies to which data*.
7. **Nothing stops the next feature from repeating all of the above.** New Prisma models ship with no forced lifecycle, classification, or projection decision. The platform's own history proves passive doctrine fails (§12 UX-Fit gate exists because a documented rule was ignored); data needs the same enforced-gate treatment.

## 2. Goals / Non-goals

**Goals**

- **G1 — One classification spine.** A single, code-defined, test-guarded data classification registry covering every Prisma model (and sensitive fields), from which lifecycle, projection, masking, encryption, residency, and retention policies all derive. Policies bind to classifications, never to physical table names.
- **G2 — Complete the lifecycle surface.** Every model has an explicit lifecycle disposition: enrolled purge policy, regulated retention, revision cap, or a deliberate `unbounded-accepted` with rationale. Growth becomes observable and alertable.
- **G3 — Correct retention algebra.** Three distinct modeled concepts — retention floor (regulated minimum), deletion mandate (maximum), and **legal hold** (a separate, superior object that suspends disposition) — with Purview-style precedence: retention beats deletion until expiry; longest retention wins; hold trumps everything. Disposition produces evidence.
- **G4 — Governed projection.** One projection-contract registry for all graph/embedding/derived-store pipelines: classification-aware scope, deletion propagation (tombstones drive Neo4j/Qdrant deletes), and uniform dark-projection staleness escalation.
- **G5 — Protection plane.** Field-level envelope encryption for personal data with per-subject keys (crypto-shredding capable); classification-driven masking **before context assembly** for AI exposure; DSAR/erasure flows that enumerate derived copies (Qdrant, Neo4j, logs); hash-chained tamper evidence on audit tables.
- **G6 — Compliance knowledge modeled once.** Typed regulatory metadata on archetypes feeding classification defaults and retention floors; a policy decision point (MCP tools) coworkers and humans *ask* instead of *know*.
- **G7 — Enforced forward process.** A CI **Data-Impact Gate**: any PR that adds/changes a Prisma model must carry a classification-registry entry and lifecycle disposition, or an explicit `Data-Steward-Decision:` attestation — same enforced-gate pattern as the Spec/Plan/Doc and UX-Fit gates.

**Non-goals**

- Building a general-purpose data catalog product (OpenMetadata/DataHub scale). We adopt their *models*, scoped to DPF's own schema and stores.
- Replacing the existing retention engine — it is extended, not rewritten.
- CADA assurance items already owned by EP-ESTATE-SOVEREIGNTY (SBOM signing, EU-steward posture, estate assessment) — this design supplies the classification/residency substrate they consume; those BIs stay in their epic.
- Master-data survivorship/crosswalk (EP-MDM owns canonical-record stewardship).
- Multi-region physical storage topology. DPF is local-first single-install today; residency classes and the local-only inference gate are the sovereignty controls in scope. Physical geo-sharding arrives with the cloud/TAPPaaS deployment work.
- Clinical-record (EHR-class) data modeling. DPF does not model diagnoses/charts today; the design covers the personal data the platform *does* hold and the floors healthcare archetypes require.

## 3. Research & Benchmarking

Read data models, not feature lists. Full source list at the end of this section.

### Open source

- **OpenMetadata** — JSON-Schema entity model. Adopted: hierarchical `Classification→Tag` with `mutuallyExclusive`, column-level tag labels carrying `labelType` (Manual/Automated/Propagated) and `state` (Suggested/Confirmed) — machine-classify-human-confirm lives in the data model; `lifeCycle` aspect (created/updated/accessed audit) feeding ROT ("is this data even used") detection; policies as `{effect, operations, resources, condition}` where conditions match on tags (`matchAnyTag('PII.Sensitive')`), deny-first. **Rejected:** `retentionPeriod` as descriptive-only metadata — unenforced retention declarations drift; in DPF an unenforced declaration is a conformance finding, not a feature.
- **DataHub (Acryl)** — entity/aspect/URN graph. Adopted: the catalog-stays-declarative / event-driven-actions split (DataHub Actions) — our queue functions react to "classification changed"/"retention expired"; typed Structured Properties as precedent for registry fields. **Rejected:** the Kafka+Elasticsearch deployment stack — DPF already has Postgres+Neo4j+Qdrant.
- **Apache Atlas** — classification as a metatype with **propagation along lineage** (per-edge opt-out), classification attributes, and `validityPeriods`. Adopted: propagate classifications along DPF's own projection edges (a `restricted` source taints its projections). **Rejected:** HBase/Solr substrate; enforcement-by-Ranger pairing (we enforce in our own runtime).

### Commercial

- **Microsoft Purview** — the most complete retention lifecycle model. Adopted: the retention-label anatomy (duration + trigger event + end-of-retention action + disposition review), the precedence algebra (retention > deletion; longest retention wins; explicit label > broad policy), **legal hold as a separate superior object** (Preservation Lock satisfies SEC 17a-4 hold-beyond-retention), disposition records as proof-of-destruction, and the DSPM-for-AI pattern (agents honor the *user's* ACLs; sensitivity labels block agent processing; outputs inherit source labels). **Rejected:** the split-brain of two disconnected taxonomies (Data Map classifications vs. compliance-portal labels) — DPF gets exactly one taxonomy.
- **Collibra** — policy-as-asset (a Retention Policy is itself a governed asset related to data categories). Adopted: policies are first-class, discoverable records. **Rejected:** the BPMN/stewardship-committee operating model — DPF's stewards are AI coworkers; keep the model, discard the process weight.
- **Immuta** — ABAC enforcement at query time: policies bind to (user attributes × data tags × declared **purpose**), so policy count stays flat as tables multiply, and an *agent is just another subject with attributes and a purpose* — nothing agent-specific to build. Adopted wholesale as the policy-decision-point shape. **BigID** — adopted: correlation of data to *subjects* (prerequisite for DSAR), ROT surfacing as deletion *candidates*, and native deletion executors that close the policy→action loop.

### Regulatory baseline

| Regime | Requirement | Direction |
|---|---|---|
| GDPR Art. 5(1)(e), 17 | Storage limitation; right to erasure. EDPB: pseudonymization alone is **not** erasure — derived copies (caches, indexes, vectors) count | Deletion maximum + on-trigger |
| HIPAA 45 CFR 164.316 | Documentation/audit logs 6y; PHI safeguards (encryption addressable, access controls, audit trails); record retention itself is state law | Retention minimum |
| SOX / SEC 17a-4 | 6–7y financial records; WORM **or** complete time-stamped audit trail (2022 amendment); system must support hold beyond retention | Retention minimum + hold |
| PCI DSS v4 | Never store SAD post-auth; CHD only with need + quarterly purge; logs 12mo | Deletion mandate + log minimum |

The industry-consensus conflict resolution (retention wins until expiry → then deletion executes; hold suspends all disposition) requires **three modeled concepts, not one "retention period" field** — the single most important schema decision in this design.

### Technical patterns (Postgres substrate)

Adopted: pg_partman-style declarative lifecycle class per table with partition-drop for the largest streams (DELETE-loop purging causes bloat/vacuum storms; partitioning cannot be retrofitted without a rewrite — hence lifecycle-class-at-creation via the gate); archive-before-drop emitting evidence (what/where/checksum); app-layer envelope encryption over pgcrypto (keys never touch the DB server); **crypto-shredding** (per-subject keys; erasure = key destruction, covering backups and immutable logs); anonymize-in-place for FK-heavy erasure (overwrite PII columns, keep the row, tombstone `anonymizedAt`, purge derived copies); RLS keyed on org/region as the residency enforcement primitive when multi-tenant/multi-region arrives.

### Anti-patterns identified

Soft-delete marketed as erasure (EDPB-rejected); a single retention field carrying three regimes; per-agent regulation knowledge in prompts (duplicated, drifting, unauditable — the entire industry direction is centralize-and-enforce, expose-as-context); catalog-only retention metadata; advisory enforcement with silent failure (enforcement without emitted evidence is indistinguishable from no enforcement); physical-asset-bound policies that break on every migration.

**Sources:** OpenMetadata `policy.json`/`rule.json`/`lifeCycle.json` (GitHub, raw); docs.datahub.com (metadata-model, policies, actions, structured-properties); atlas.apache.org (TypeSystem, ClassificationPropagation); learn.microsoft.com/purview (retention, data-lifecycle-management, data-map-classification, dspm-for-ai); Collibra operating-model + retention-policy docs; documentation.immuta.com (subscription/data policies); bigid.com (lifecycle, deletion); SEC 17a-4 analyses (min.io/cohasset, archondatastore); crunchydata + AWS pg_partman archive-then-drop; EDPB pseudonymization guidance analyses.

## 4. Current substrate (verified on origin/main — extend, don't duplicate)

| Exists today | Where | This design's relationship |
|---|---|---|
| Declarative retention engine: `PURGE_POLICIES` (19 models), `RETAINED_DATASETS` (40+ regulated, statutory bases), industry floors (banking/professional 7y, healthcare 6y, public 3y), nightly batched sweep, kill switch, dry-run, build-failing regulated-exclusion test | `apps/web/lib/operate/retention/`, spec `2026-06-14-data-retention-lifecycle-governance-design.md` | Extend: new enrollments, revision caps, legal hold, archival, partition strategy (its own §9 slices 3–6) |
| Route/agent/endpoint sensitivity taxonomy + local-only residency gate in routing | `apps/web/lib/tak/agent-sensitivity.ts`, `routing/pipeline-v2.ts`, `inference/local-only.ts` | Reuse the 4-level taxonomy as the sensitivity axis of the data classification registry; extend gating from provider-selection to storage & context |
| Prisma→EA data-model mirror + drift steward (`EaConformanceIssue`, self-healing), nightly | `apps/web/lib/ea/data-model-mirror-apply.ts`, `data-architecture-steward-apply.ts`, EP-DATA-ARCH | The classification registry projects into this ERD; new drift detectors (unclassified-model, unenrolled-growth-table) join the steward |
| Code graph reconciler with the only staleness-escalation pattern (advisory lock, checksum increments, dark-after-N-failures → `PlatformIssueReport`) | `apps/web/lib/integrate/code-graph/` | Template for uniform projection-health escalation |
| Discovery promotion policy (the richest scope governance: taxonomy-config authority, structural denylists, provenance classifier, confidence gate, self-healing demotion) | `packages/db/src/discovery-promotion-policy.ts` | Template for projection contracts; terminal-skip noise fix already in flight (BI-62846516 / PR #3163) — not re-filed here |
| Credential encryption (AES-256-GCM envelope, `enc:` format) | `apps/web/lib/govern/credential-crypto.ts` | Extend to a key-hierarchy service with per-subject data keys; fix dev-plaintext fallback + narrow prod guard |
| Compliance engine (obligation/control/evidence), regulation applicability, jurisdiction capture, BIAN archetypes | `compliance-library.ts`, `regulation-applicability.ts`, `BusinessContext`, EP-GRC-001 specs | Consumes classification; archetype compliance metadata feeds it typed instead of string-matched |
| Federation egress allowlists (`ProjectionContract.fieldAllowList`, `retentionClass`, `cadaPosture`), edge raw-stays-local boundary | `schema.prisma` federation models, EP-MSP-FEDERATION, EP-SOVEREIGN-SOC | The cross-install precedent for in-install projection contracts; naming aligned |
| Enforced CI gate pattern with attestation trailers | `scripts/check-spec-plan-doc.mjs`, `scripts/check-ux-fit-decision.mjs` | Data-Impact Gate is the third instance of this proven pattern |

## 5. Architecture — five planes on one spine

```
                    ┌──────────────────────────────────────────────┐
                    │  CLASSIFICATION SPINE (plane 0)              │
                    │  data-classes.ts — every model & sensitive   │
                    │  field → {category, sensitivity, subjectKind,│
                    │  lifecycleClass, projectionPolicy,           │
                    │  residencyClass, regulatoryBases[]}          │
                    │  Coverage test: unclassified model = red CI  │
                    └───────┬──────────┬──────────┬───────┬────────┘
                            │          │          │       │
             ┌──────────────▼──┐ ┌─────▼─────┐ ┌──▼───────▼─────┐ ┌─────────────────┐
             │ LIFECYCLE plane │ │ PROJECTION│ │ PROTECTION     │ │ POLICY plane    │
             │ retention       │ │ plane     │ │ plane          │ │ PDP: MCP tools +│
             │ registry +      │ │ projection│ │ field crypto,  │ │ archetype       │
             │ legal holds +   │ │ contracts,│ │ mask-before-   │ │ compliance packs│
             │ disposition     │ │ deletion  │ │ context, DSAR/ │ │ + Data Steward  │
             │ evidence +      │ │ propagate,│ │ erasure, hash- │ │ skill — agents  │
             │ growth observ.  │ │ dark-proj │ │ chained audit  │ │ ask, never know │
             └─────────────────┘ │ alerts    │ └────────────────┘ └─────────────────┘
                                 └───────────┘
             ┌────────────────────────────────────────────────────────────────────┐
             │ PROCESS plane: Data-Impact Gate (CI) + steward drift detectors     │
             │ — no future model ships without a classification & lifecycle call  │
             └────────────────────────────────────────────────────────────────────┘
```

### 5.1 Plane 0 — Classification spine (`apps/web/lib/govern/data-classes.ts`)

Code-defined registry (same auditable, drift-free, test-guarded pattern as `PURGE_POLICIES`), one entry per Prisma model:

```ts
type DataClassEntry = {
  model: string;                          // Prisma model name (validated against schema facts)
  category: DataCategory;                 // closed union: personal-data | customer-content | financial-record |
                                          // health-adjacent | credential-secret | audit-log | telemetry |
                                          // knowledge-content | config | master-data | derived-projection
  sensitivity: RouteSensitivity;          // reuse public|internal|confidential|restricted
  subjectKind?: "user" | "customer-contact" | "employee" | "counterparty"; // BigID-style subject link for DSAR
  sensitiveFields?: string[];             // column-level PII/PHI-adjacent fields (masking + encryption targets)
  lifecycleClass:                          // the G2 total function — every model, an explicit answer
    | { kind: "purge"; categoryRef: RetentionCategory }        // enrolled in PURGE_POLICIES
    | { kind: "retained"; basisRef: string }                   // RETAINED_DATASETS statutory hold
    | { kind: "revision-capped"; keepLast: number; maxAgeDays: number }
    | { kind: "bounded-by-entity" }                            // master data, real-world cardinality
    | { kind: "unbounded-accepted"; rationale: string };       // deliberate, visible, alertable
  projectionPolicy: {                     // may this data leave Postgres, and in what form?
    eaGraph: "structure-only" | "forbidden";
    neo4j: "allowed" | "metadata-only" | "forbidden";
    embeddings: "allowed" | "masked-only" | "forbidden";
    federation: "contract-gated" | "forbidden";               // aligns with ProjectionContract
  };
  residencyClass: "local-only" | "sovereign-preferred" | "unrestricted";
  regulatoryBases?: string[];             // e.g. ["gdpr-art5", "hipaa-164.316", "sec-17a4", "pci-dss-3.2"]
};
```

Enforcement tests (build-failing, like the regulated-exclusion guard): every model in `parsePrismaSchema` facts has exactly one entry; every `lifecycleClass: purge` entry has a matching `PURGE_POLICIES` row and vice versa; every `RETAINED_DATASETS` model is `retained`; `credential-secret` ⇒ `embeddings: "forbidden"`; `restricted` ⇒ `embeddings: "masked-only" | "forbidden"`. Classification **propagates along projection edges** (Atlas pattern): a projection target inherits the strictest source classification unless the contract narrows the payload (structure-only/metadata-only).

The registry projects into the EA data-model mirror as element properties, so the `/ea/data-model` ERD shows classification + lifecycle per model, and the data-architecture steward gains detectors: `unclassified-model`, `unenrolled-growth-table` (append-only shape detected via schema facts but lifecycleClass missing/unbounded without rationale), `classification-projection-conflict`.

### 5.2 Lifecycle plane (extends EP-DATA-RETENTION)

1. **Growth observability first** (you cannot manage what you cannot see): a scheduled collector samples `pg_total_relation_size`/`reltuples` per table into a small time-series (itself purge-enrolled), exports Prometheus metrics, and an admin Data Management surface (report-kit) shows the retention matrix (enrolled/retained/capped/unbounded per the registry), current sizes, growth rates, last-sweep results, and dry-run preview — completing the old spec's Slice 4 with the visibility that was missing.
2. **Enroll the ranked offenders** with per-table policy decisions: `UserFact` (purge superseded facts after window; active facts are memory, not log), `PortfolioQualityIssue` (purge resolved after 180d), `BacklogItemActivity`, `AdminActivity`, `Activity` (CRM, respecting regulated floors), `IntegrationToolCallLog`, `RouteOutcome`, `ToolExecutionReceipt` + `CoworkerActionEnvelope` + `AgentActionProposal` (align with `ToolExecution` 365d audit window), `EdgeEvent`/`ChangeEvent`/`RemoteAction` (terminal-state-aware), discovery observation streams, `InboundChannelMessage`/`WorkItemMessage` (chat-class 545d), import staging.
3. **Revision caps**: `keepLast N + maxAge` executor strategy for the 13 revision/snapshot tables (`WikiPageRevision`, `DocumentVersion`, `PromptRevision`, `EaSnapshot`, …) — never dropping the current/published revision.
4. **Status-aware datasets** (old Slice 3): `TaskRun`/`TaskMessage`/`TaskArtifact`/`DecisionInteraction` purged only in terminal states past window.
5. **Legal hold + disposition evidence** (G3): `LegalHold` model (scope = classification categories and/or subject; suspends all disposition; operator-gated create/release, both audited) checked by the sweep before any delete; `DispositionRecord` evidence rows (what, why, policy, count, checksum) emitted by every destructive action — enforcement without evidence is indistinguishable from no enforcement.
6. **Archival tier** (old Slice 5): export-then-delete (compressed, checksummed, to the backup volume location) for categories marked archival; restore path documented.
7. **Partition-drop strategy** (old Slice 6): registry gains per-policy `strategy: "delete" | "partition-drop"`; the top event streams migrate to native range partitions once size thresholds trip (observability from #1 tells us when); new append-only tables declare a lifecycle class at the gate so partitioning is a birth decision, not a retrofit.

### 5.3 Projection plane

A `PROJECTION_CONTRACTS` registry (`apps/web/lib/govern/projection-contracts.ts`) — one entry per pipeline family (EA mirror, steward, code graph, 14 SysML parity domains as one family, discovery→portfolio, discovery→Neo4j, entity→Neo4j syncs, 4 Qdrant collections): declared source models, target store, payload class (`structure-only | metadata-only | content`), trigger, deletion-propagation mode, staleness SLA. Enforcement:

- **Scope**: contract payload class must satisfy every source model's `projectionPolicy` (build-failing test). Content payloads (embeddings) route through the masking service (§5.4) when any source field is sensitive.
- **Deletion propagation**: the EA mirror's `mirrorRemoved` tombstone now drives `deleteEaElement`/`deleteEaRelationship` in Neo4j; entity deletes enqueue projection-cleanup events (Neo4j `DETACH DELETE`, Qdrant `deleteVectors`); a weekly orphan-reconciliation job diffs each target store against its source and reports/removes orphans (extending `infra-prune`).
- **Uniform dark-projection escalation**: generalize the code-graph pattern — every contract records last-success; a shared monitor files/auto-resolves `EaConformanceIssue`/`PlatformIssueReport` when a projection exceeds its staleness SLA. Fire-and-forget stays (Postgres remains authority; projections never fail the caller) but silence no longer does.
- **Immediate fix (ships first):** Qdrant `agent-memory` gains (a) a storage-time sensitivity gate honoring the already-computed route sensitivity (restricted → skip or mask per policy), and (b) deletion propagation from `AgentMessage`/thread deletion and from the `AgentThread` retention purge handler — closing the loop the retention sweep currently leaves open (vectors outliving purged chat).

### 5.4 Protection plane

- **Key hierarchy + field encryption**: extend `credential-crypto` into a small key service — master key (existing env) → purpose keys → **per-subject data keys** (stored wrapped, keyed by `subjectKind`+id). Encrypt registry-listed `sensitiveFields` at the application layer (helpers at the model-access seam; Prisma middleware/extension). Crypto-shredding: subject erasure destroys the subject key, invalidating backups and archives without row surgery. Fix the dev-mode plaintext fallback (fail-loud outside `NODE_ENV=development`) and broaden the prod guard beyond `CredentialEntry` counts.
- **Mask-before-context** (the "masked exposure" requirement): a `maskForContext(payload, {purpose, principal, sensitivityCeiling})` service applied **at context assembly** — coworker prompt building, semantic-memory storage, tool-result shaping — driven by `sensitiveFields` + sensitivity vs. the caller's clearance and declared purpose (Immuta shape: subject attributes × data tags × purpose). Masking is enforcement, not prompt instructions. Outputs inherit source sensitivity (Purview pattern) via the existing envelope/receipt records.
- **DSAR / erasure**: subject-access export (all rows whose registry entry carries the requesting `subjectKind`+id, via the subject correlation the registry provides) and erasure flows: anonymize-in-place for FK-heavy regulated rows (overwrite `sensitiveFields`, set `anonymizedAt`, retain the skeleton for statutory bases), crypto-shred the subject key, and enumerate **derived-copy targets** (Qdrant vectors, Neo4j nodes, notification rows, caches) from the projection contracts — EDPB-compliant because the contracts make derived copies enumerable. Legal hold blocks erasure with an operator-visible conflict record (GDPR Art. 17(3) exemptions are real; the conflict is surfaced, not silently resolved).
- **Tamper-evident audit**: hash-chain (`prevHash`+`rowHash`) on the audit-class tables (`ToolExecution` receipts, `ComplianceAuditLog`, `SecurityEvent`, `AuthorizationDecisionLog`) with a periodic chain-verification job filing a conformance issue on break — satisfying the SEC 17a-4 audit-trail alternative to WORM with app-level machinery.

### 5.5 Policy plane — so nobody has to know

- **Archetype compliance packs**: typed `compliancePack` metadata on the archetype registry (applicable regulation refs, default data-sensitivity tier, retention-floor key, PHI/CHD handling flags) replacing runtime string-matching as the *source*; `compliance-library.ts` and `industry-floors.ts` read it. BIAN/healthcare packs authored from the existing spec material.
- **Policy Decision Point (MCP + in-process)**: consolidated, grant-scoped tools (respecting the ~15-tool local budget — extend existing surfaces where possible): `get_data_policy(model|field, purpose)` → classification, lifecycle, masking requirement, residency, statutory bases, in plain language; `check_data_action(action, target, purpose)` → allow/deny/mask-first with reasons (the door coworkers ask before touching data); DSAR/hold operations behind operator-gated grants. The `dpf-data-architecture-steward` skill extends to steward classification (propose entries for new models — machine-suggest, human-confirm, the OpenMetadata `Suggested/Confirmed` state pair) and the catalog serves as agent-readable context, never as per-agent prompt regulation text.
- **Operator surface**: the admin Data Management page (§5.2.1) is also where a non-technical operator sees, in plain language, what the platform keeps, protects, and purges — progressive disclosure, report-kit components, UX-fit gated.

### 5.6 Process plane — no future regressions

- **Data-Impact Gate (CI, enforced)**: `scripts/check-data-impact.mjs` — a PR touching `schema.prisma` migrations/models must either (a) touch `data-classes.ts` with entries for every added/renamed model (the coverage test then validates content), or (b) carry a `Data-Steward-Decision:` trailer explaining why not (e.g., a rename with no data-shape change). Surface-agnostic (reads evidence, not provenance), same contract as the Spec/Plan/Doc and UX-Fit gates. Build Studio agent prompts gain the matching rule so embedded builds comply by construction.
- **Steward drift detectors** (§5.1) catch what slips past PR review at runtime, self-healing like existing conformance issues.
- **AGENTS.md §11 addendum** documenting the gate and pointing here (single source of truth).

## 6. Epic & backlog mapping

- **EP-DATA-RETENTION (reopen)** — lifecycle plane: growth observability + admin surface; ranked enrollments; revision caps; status-aware datasets; legal hold + disposition evidence; archival tier; partition strategy.
- **EP-DATA-GOVERNANCE (new umbrella)** — classification spine + coverage tests; Data-Impact Gate; agent-memory sensitivity gate + deletion propagation (first ship); projection contracts + orphan reconciliation + dark-projection alerts; field encryption + key hierarchy; mask-before-context; DSAR/erasure; tamper-evident audit; archetype compliance packs; PDP tools + steward skill; docs.
- **EP-ESTATE-SOVEREIGNTY** — unchanged; consumes `residencyClass` (a linking note added there, no duplicate BIs).
- Ordering, sizes, and acceptance criteria: see the plan.

## 7. Safety properties

1. Every destructive lifecycle action: backup-ordered, batched, capped, kill-switched, dry-runnable (inherited engine properties) + now hold-checked and evidence-emitting.
2. Classification/coverage/contract rules are **build-failing tests** — drift cannot merge.
3. Regulated floors only lengthen; holds only suspend; nothing in this design can shorten a statutory retention.
4. Masking/encryption are enforcement-layer, never prompt-layer.
5. Projections remain fire-and-forget for availability, but dark projections escalate within their SLA.
6. Erasure enumerates derived copies from contracts; crypto-shredding covers what enumeration cannot reach (backups).
7. All new operator actions (hold create/release, erasure, archival restore) are operator-gated and audited.

## 8. Verification

Unit: registry coverage/consistency suites, precedence algebra (retention/deletion/hold), masking service, key hierarchy + shredding, chain verification. Runtime-bound (canonical install / shared local-CI lease per AGENTS.md §5): sweep with holds honored + disposition records written; agent-memory gate observed live (restricted route → no raw vector); erasure end-to-end including Qdrant/Neo4j cleanup; admin surface UX; migration applies. Gate: red-team PRs (new model without classification must fail CI; regulated model enrolled for purge must fail).

## 9. References

- Prior specs this extends: `2026-06-14-data-retention-lifecycle-governance-design.md`, `2026-06-06-data-architecture-self-maintenance-design.md`, `2026-04-30-discovery-portfolio-gap-closure-design.md`, `2026-03-17-shared-memory-vector-db-design.md`, `2026-06-19-estate-sovereignty-governance-design.md`, `2026-03-17-compliance-engine-core-design.md`, `2026-06-09-bian-banking-archetypes-design.md`, `docs/architecture/2026-06-19-cada-cloud-sovereignty-architecture-note.md`.
- Kernel principles: `data-sovereignty-follows-control`, `one-data-model`, `trust-the-data-spine`, `schema-audit-before-features`, `governance-approves-evidence-not-provenance`, `fix-the-seed-not-the-runtime`.
- Research sources: §3.
