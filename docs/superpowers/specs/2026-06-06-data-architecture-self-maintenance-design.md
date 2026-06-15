# Self-Maintaining Data Architecture — Design

| Field | Value |
| ----- | ----- |
| Status | Draft — EA reviewed and tightened 2026-06-06 |
| Date | 2026-06-06 |
| Epic | EP-DATA-ARCH — Self-documenting data architecture: mirror the Prisma data model into the EA tool as a live ERD |
| Live backlog | MCP verified 2026-06-06: BI-8579FB2D, BI-2167A734, BI-759537CA are `open`/`build`; BI-6E5BF91F, BI-A16FDB65, BI-8E274CD3 are `triaging`. |
| Owning coworker | AGT-BUILD-DA (Data Architect) |
| Value stream | Integrate; IT4IT §5.3.3 Design & Develop / §5.2.4 Define Architecture |
| WWMD | `principle_decide` 2026-06-06 → `opt-coworker-hybrid`, composite 12.55 vs 8.90 / 8.82, margin 3.65, high confidence, no commandment conflict |

## 1. Problem

The DPF data model lives in a 10,000-line `schema.prisma`. It is structurally central but operationally invisible: no living ERD, no domain map, no durable timeline of model and relationship changes, and no coworker-owned stewardship loop that keeps the architecture current after schema work lands.

This is not a missing-database problem. DPF already has the code graph, EA element/relationship/view/snapshot substrate, conformance issues, scheduled agent tasks, Build Studio dispatch, decision ledger, and the Data Architect persona. The gap is composition, stable mirror identity, and a governed self-maintenance loop.

## 2. Goals

1. Mirror the Prisma data model into the existing EA tool as a live data-architecture view.
2. Keep that mirror current through deterministic reconciliation, not hand-edited diagrams.
3. Record data-model evolution as snapshots with useful change summaries.
4. Give AGT-BUILD-DA a steward loop for annotations, drift findings, and impact-aware guidance.
5. Make the experience visible in the existing architecture tool without adding another dashboard or route family.

## 3. Verified Substrate

| Capability | Current substrate | Design implication |
| --- | --- | --- |
| Prisma extractor | `apps/web/lib/integrate/code-graph/extractors/prisma.ts` emits only `PrismaModel` nodes via regex (`prisma-line-v1`). | Extend the existing extractor; do not create a second schema crawler. |
| Prisma version | Repo pins Prisma 7.8.0. `@prisma/internals` is not currently a dependency. | Parser choice must be a deliberate adapter decision, not an implicit runtime import. |
| EA model | `EaElementType`, `EaRelationshipType`, `EaRelationshipRule`, `EaElement`, `EaRelationship`, `EaView`, `EaViewElement`, `ViewpointDefinition`, `EaSnapshot`, `EaConformanceIssue` exist. | Extend this substrate; no new ERD tables. |
| ArchiMate data object | `seed-ea-archimate4.ts` already seeds `data_object`; local ArchiMate mapping maps `archimate:DataObject` to `data_object`. | Prisma models map to existing `data_object` elements. |
| Relationship semantics | `accesses`, `depends_on`, `composed_of`, `flows_to`, etc. already exist, but no Prisma-specific relation type exists. | Prefer existing relationship types; store relation/cardinality metadata in `properties` unless evidence proves a new type is required. |
| Stable mirror identity | `EaElement` has `infraCiKey` and JSON `properties`, but no unique source key; `EaRelationship` has no unique composite constraint. | Phase 2 must define mirror identity and duplicate guards before writing rows. |
| Snapshots | `EaSnapshot` is scoped to `EaView` and carries `graphJson`, counts, and `changeSummary`. | Use it for evolution history; no new history table. |
| Conformance issues | `EaConformanceIssue` can attach to view and/or element with JSON details. | Use it for steward findings. |
| Scheduling | `ScheduledAgentTask` + `ScheduledJob` seed patterns already exist (`seed-hive-scout.ts`, `seed-discovery-triage.ts`). | Nightly stewarding uses the existing scheduled coworker pattern, not ad hoc cron. |
| Data Architect | `prompts/specialist/data-architect.prompt.md` is Build-Studio-sandbox-only with `sandbox_execute`. | Expand the existing persona, skill, and grants; do not create a new agent. |

## 4. Standards And Research

- **Prisma parser surface:** Prisma’s official docs describe Prisma ORM 7’s `prisma-client` generator as the default TypeScript generator and note Prisma 7’s TypeScript-based query compiler. They do not present `@prisma/internals.getDMMF` as a stable public schema API. Therefore, the design uses a local parser adapter with pinned dependency and fixture tests, rather than treating `@prisma/internals` as a timeless runtime contract.
- **Prisma schema semantics:** Prisma’s schema reference covers relation attributes, `@map`, `@@map`, `@ignore`, `@@ignore`, indexes, IDs, and generator behavior. The extractor must preserve these because EA names should distinguish Prisma model/field names from mapped table/column names.
- **ArchiMate fit:** DPF’s ArchiMate 4 seed maps `data_object` as the application-layer passive structure for data structured for automated processing. This is the correct EA type for logical Prisma models. Cardinality belongs in relationship metadata/properties; the EA graph should not invent physical database table semantics unless a later slice adds artifact-level modeling.

## 5. Decision

Use the WWMD-recommended hybrid:

- Deterministic mirror owns factual structure: models, fields, relations, mapped names, indexes, and cardinality.
- Data Architect coworker owns judgment: domain grouping, semantic annotations, drift findings, and material-change recommendations.
- Existing EA/scheduled/coworker substrate owns persistence and invocation.

Rejected alternatives:

- **CI-only static ERD:** correct but not stewarded; it decays into generated documentation nobody owns.
- **Runtime-only introspection:** useful on demand but too easy to drift from the build/source-of-truth lifecycle.
- **New ERD subsystem:** duplicates EA substrate and violates single source of truth.

## 6. Architecture

```text
schema.prisma
  -> parser adapter + line anchors
  -> enriched code-graph facts
  -> deterministic EA mirror
  -> managed Data Model view + EaSnapshot timeline
  -> Data Architect steward pass
  -> EaConformanceIssue / annotations / decision-ledger records
```

### 6.1 Extract

Extend the current Prisma code-graph extractor. The implementation may use `@prisma/internals` only through a narrow adapter that is pinned in `package.json`, covered by fixture tests, and replaceable if Prisma changes internals. If the adapter cannot be made stable in Prisma 7.8.0, use a build-time generated manifest or Prisma generator-style parser path rather than a direct runtime dependency.

Facts to emit:

- `PrismaModel`: model name, mapped table name, line range, ignored flag.
- `PrismaField`: field name, mapped column name, scalar/enum/model type, list/required/id/unique/default/updatedAt/ignored flags.
- `HAS_FIELD` from model to field.
- `RELATES_TO` between models with relation name, source fields, target fields, optional/list flags, onDelete/onUpdate, and derived cardinality.
- `HAS_INDEX` or field-level index metadata sufficient for FK-without-index checks.

Keep line anchors from the existing extractor so coworker findings can link back to source.

### 6.2 Mirror

Create `reconcileDataModelMirror()` as a deterministic, idempotent projection from enriched facts into the EA substrate.

Mirror identity:

- Use a stable source key: `prisma:model:<ModelName>` for elements and `prisma:relation:<FromModel>:<fieldOrRelationName>:<ToModel>` for relationships.
- Store the key in `EaElement.infraCiKey` and in `properties.sourceKey`; store relationship keys in `EaRelationship.properties.sourceKey`.
- Before writing, assert there is at most one active row for each source key. If duplicates exist, write an `EaConformanceIssue` and stop the mirror instead of adding more duplicates.
- If the implementation adds a unique constraint or unique index to make this enforceable, it must be a narrow migration on existing EA models with inline backfill/dedupe SQL. Do not add a new mirror table for Phase 2.

Reconcile semantics:

- Add missing elements/relationships.
- Update factual properties when facts change.
- Mark removed elements/relationships as inactive/removed in properties or lifecycle status; never hard-delete as the normal path.
- Write an `EaSnapshot` only when the canonical graph changes materially.
- Synchronize Neo4j through the existing EA sync path after Postgres commits.

The mirror never invents domains or relationship narratives. It only records structure.

### 6.3 View

Seed or upsert a `ViewpointDefinition` named `Data Model` scoped to `data_object` and the allowed relationship type slugs. Bind one system-owned `EaView` with `scopeType="data-model"` and `scopeRef="prisma"`.

The view is a managed projection:

- `EaViewElement` membership is maintained by the mirror.
- Layout uses existing EA view/canvas conventions; no new viewer unless the current EA tool cannot render the existing substrate.
- Snapshot history powers a “what changed” timeline or drawer. If Phase 3 touches reporting/list UI, it uses report-kit primitives and DPF theme tokens.

### 6.4 Steward Loop

After the deterministic mirror, AGT-BUILD-DA performs bounded judgment work:

- Domain clustering: proposes `proposedProperties.domain` / grouping metadata, leaving structural properties untouched.
- Relationship semantics: adds human-readable annotations in proposed/coworker-owned properties.
- Drift detection: files `EaConformanceIssue` for missing FK indexes, missing inverse relation, ignored/unmapped ambiguity, orphaned model, model with no domain, off-vocabulary enum, duplicate mirror key, or relation cardinality changes.
- Governed change: material removals and cardinality flips call the decision perspective / WWMD surface and record the decision outcome before the change is accepted as intentional.

The steward is cost-bounded and resumable. It must process by domain or chunk when the schema is too large for one coworker turn.

### 6.5 Role, Skill, And Tools

Expand the existing AGT-BUILD-DA persona:

- Add `dpf-data-architecture-steward` under `packages/dpf-skill-pack/skills/`, assigned to the data architect.
- Update `prompts/specialist/data-architect.prompt.md` so direct/on-demand data-architecture questions are in scope, while Build Studio schema task behavior stays intact.
- Seed grants through existing `AgentToolGrant` / registry seed paths. Keep max-10-tools discipline.
- Prefer existing tools (`explain_blast_radius`, EA read/write, ontology graph query, scheduled coworker task execution). Add a new mirror/reconcile MCP tool only if no existing side-effecting tool can safely invoke `reconcileDataModelMirror()`.

### 6.6 Triggers

| Trigger | Required substrate |
| --- | --- |
| Build Studio schema task | Existing orchestrator dispatches the Data Architect after migration-related tasks. |
| Main migration / self-upgrade | Deterministic mirror runs after migrations apply in the governed pipeline, not by direct live-portal rebuild. |
| Nightly steward | Existing `ScheduledAgentTask` + `ScheduledJob` seed pattern, with AGT-BUILD-DA as agent. |
| On demand | Existing coworker invocation path; prompt asks for refresh or explanation and routes to AGT-BUILD-DA. |

## 7. UX Fit

Decision: `fits-with-guardrails`.

- Owning area: Platform / Knowledge architecture tooling.
- Route family: existing EA/architecture tool route; no new top-level nav.
- Primary persona: founder/operator and platform contributor who need to understand schema impact without reading raw Prisma.
- Navigation layer: local page/view affordance only.
- Reuse: existing EA view renderer; report-kit for any status/timeline/table/KPI presentation.
- Empty/failure behavior: fresh install shows “Data Model view has not been generated yet” with a refresh action for authorized users; parser/mirror failures show an `EaConformanceIssue` and last-successful snapshot, not an empty diagram.
- AI boundary: view/timeline clicks do not start coworker work. Refresh/steward actions show context preview and require explicit confirmation unless they are scheduled background runs.

## 8. Decomposition

| Phase | BI | Outcome |
| --- | --- | --- |
| 1 | BI-8579FB2D | Enriched Prisma extractor with model/field/relation/index facts and parser adapter guardrails. |
| 2 | BI-2167A734 | Idempotent EA mirror with stable source keys, duplicate guards, snapshot-on-delta, and existing EA sync. |
| 3 | BI-759537CA | Managed Data Model viewpoint/view and visible snapshot timeline in existing EA UI. |
| 4 | BI-6E5BF91F | Data Architect steward pass for domains, annotations, drift findings, and governed material-change review. |
| 5 | BI-A16FDB65 | Data Architect role expansion: skill, prompt scope, grants, on-demand + scheduled invocation. |
| 6 | BI-8E274CD3 | Four self-maintenance triggers wired through existing Build Studio, self-upgrade/migration, scheduled task, and on-demand surfaces. |

## 9. Verification

- **Unit:** parser adapter fixture tests; relation/cardinality/index derivation; mirror idempotency; duplicate-source-key stop rule; snapshot delta classification; steward drift rule fixtures.
- **Typecheck:** `pnpm --filter web typecheck` and affected package checks in the worktree.
- **Build:** `pnpm --filter web build` in canonical local install or shared local-CI convergence sandbox.
- **Migration:** any new seed/constraint migration applies cleanly with inline backfill/dedupe SQL.
- **Functional:** after live-install preflight or shared lease, introduce or replay a schema fixture and verify the Data Model view updates, an `EaSnapshot` is written, and AGT-BUILD-DA files the expected `EaConformanceIssue`.
- **UX:** browser exercise of the architecture view at desktop and mobile widths; no hardcoded colors, no overlapping labels, honest empty/error states.

## 10. Risks

- **Parser instability:** `@prisma/internals` may change because it is not documented as a public API. Mitigation: isolate it behind `prisma-schema-adapter.ts`, pin it, test it against fixtures, and document a fallback.
- **Duplicate mirror rows:** current EA tables do not enforce source-key uniqueness. Mitigation: stable keys, preflight duplicate scan, optional narrow unique-index migration after backfill.
- **Relationship-type overreach:** Prisma relations are not all ArchiMate relationships. Mitigation: use existing relationship types plus properties first; add a new type only after evidence.
- **Coworker overwrite:** deterministic mirror owns factual structure; coworker writes proposed annotations/issues only.
- **Cost and context:** steward pass may be large. Mitigation: chunk by domain/model family, summarize from mirror facts, and skip no-op runs.
- **Runtime-bound verification:** worktree-local checks are source-local only. Build, migration, and UI evidence must come from the canonical local install or shared local-CI convergence sandbox.

## 11. Advisory Review Result

Architecture review: aligned with important guardrails.

- `[important]` Parser dependency was overstated as an official public contract. The spec now requires a pinned adapter and fallback.
- `[important]` Idempotent mirror needs stable source identity. The spec now requires source keys, duplicate guards, and a migration path if uniqueness must be enforced in DB.
- `[important]` The role expansion must extend AGT-BUILD-DA and existing scheduled/coworker substrate instead of creating a new agent or cron lane.
- `[minor]` The UX now stays inside the existing EA tool and report-kit conventions, avoiding another dashboard.
