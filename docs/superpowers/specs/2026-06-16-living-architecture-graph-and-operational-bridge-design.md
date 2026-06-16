# Living Architecture Graph & Operational Bridge — Design

| Field | Value |
| ----- | ----- |
| Status | Proposed — current-state coverage verified; catch-up + operational-bridge plan defined |
| Date | 2026-06-16 |
| Owner | Enterprise Architect, Data Architect, Build Studio platform team |
| Builds on | [SysML Architecture Substrate](2026-06-14-sysml-architecture-substrate-design.md) (notation), [Design–Implementation Parity Engine](2026-06-14-design-implementation-parity-engine-design.md) (auto-extraction backbone), [Self-Maintaining Data Architecture](2026-06-06-data-architecture-self-maintenance-design.md) (the mirror pattern) |
| Backlog | Live MCP available. Extends `EP-PARITY-ENGINE` (portal-completion domains) and anchors a new epic for the operational/network/integration frontier. Runtime/browser validation deferred to the canonical-runtime / shared-lease path per §13. |
| WWMD anchor | `single-source-of-truth`, `verify-substrate-before-proposing-new`, `remove-avoidable-failure-opportunities` (proposed), `structural-verification-is-not-functional` |
| References | OMG SysML 2.0; `docs/Reference/sysml-v2.md`; the seven catch-up views in the substrate spec §8 |

## 1. Problem — the model is most of the portal, but stops at the portal's edge

The operator's instruction: *we introduced SysML as our modeling language to describe this
project's architecture, but we have not re-created what is now missing given the late
introduction of the feature. Catch up to the current state of the portal so the model is
usable for impact analysis, planning, and implementation. Eventually extend to all
discovered elements — other devices on the network, applications connected through
integrations — and make SysML the bridge where enterprise architecture, systems
architecture, and operational reality meet, alongside the code graph, the operational
graph, and the network-topology layer.*

The premise "the SysML model is missing" needs qualification, because the Parity Engine has
already done most of the catch-up by construction. **The portal's static construction is
already a live, drift-proof SysML/BPMN projection**, re-derived nightly from its source
registries (§3). What is genuinely missing splits into two tiers:

1. **Portal-completion gap (small, bounded).** A few domains of the portal's own
   construction are not yet extracted: the skill & agent-toolchain model, the
   deployment/runtime contracts, and the Build-Studio/value-stream process behaviour
   (BPMN). These finish the *inside-the-portal* picture.
2. **Operational-reality gap (the strategic frontier).** Three layers the operator named —
   the **operational graph** (live runtime), the **network topology** (discovered devices),
   and **integrations** (connected applications) — each have rich, machine-readable
   substrate already, but **none of it is bridged into the EA graph.** Today they are
   isolated data islands. The architecture model therefore describes how the portal is
   *built* but not how it is *running*, *deployed across hosts*, or *wired to the outside
   world*. That is exactly the seam where enterprise architecture, systems architecture, and
   operational reality are supposed to meet — and it is open.

Closing both tiers turns the model from a description of source code into a **living
architecture graph**: one queryable substrate spanning enterprise → systems → code →
operational → network/integration, where a single impact-analysis traversal answers "if this
changes, what else is affected" *across* layers — the payoff the operator is after.

## 2. Verified current-state coverage (what already exists — do not rebuild)

Per `verify-substrate-before-proposing-new`, the coverage below was confirmed against code,
not assumed from the specs. Each row is a live projection: a pure `build*Model(facts) →
SysmlDesiredModel` extractor plus a `reconcile*` shell that re-derives from source and
applies idempotently via `applySysmlModel` (`apps/web/lib/ea/sysml-model-seed.ts` →
`@dpf/db/sysml-model-seed`), soft-removing stale elements and filing `EaConformanceIssue`s
on conflict. All six are orchestrated by `reconcileSysmlProjections`
(`apps/web/lib/ea/reconcile-sysml-projections.ts`) under `runArchitectureParitySteward`
(`apps/web/lib/ea/architecture-parity-steward.ts`), run on the periodic
`agent-task-scheduler` pass (`apps/web/lib/actions/agent-task-scheduler.ts:239`).

| Domain | Source of truth | Extractor | Status |
| --- | --- | --- | --- |
| MCP tool authority | `TOOL_TO_GRANTS` + `mcp-tools` AST | `mcp-authority-extract.ts` / `reconcile-mcp-authority.ts` | live (PR #1880) |
| Coworkers / personas / delegation | `agent_registry.json` | `coworker-authority-extract.ts` / `reconcile-coworker-authority.ts` | live (PR #1881) |
| IT4IT value streams | `EaReferenceModelElement` | `value-stream-extract.ts` / `reconcile-value-streams.ts` | live (PR #1890) |
| Route families | Next route manifest | `route-extract.ts` / `reconcile-routes.ts` | live (PR #1900) |
| Code structure (subsystem deps) | Neo4j code graph (`CodeFile`+`IMPORTS`) | `code-structure-extract.ts` / `reconcile-code-structure.ts` | live (PR #1911) |
| Platform process models (state machines) | `ENVELOPE_STATUSES`, `BACKLOG_STATUSES` transition tables | `process-extract.ts` / `reconcile-process.ts` | live (PR #1940) |
| Logical data model (ERD) | Prisma schema | `data-model-mirror*.ts` (EP-DATA-ARCH) | live, separate scheduler branch |
| Drift gate | deterministic `sourceKey`s in hand-seed views | `architecture-parity.ts` + CI workflow | live (Slice 0) |
| Generalized steward | skipped-domain → conformance issue | `architecture-parity-steward.ts` | live (BI-PARITY-STEWARD, done) |

**Implication: the catch-up is an extension exercise, not a green-field one.** Every new
domain below reuses the exact same contract; nothing here introduces a parallel modeling
system, a new source of truth, or hand-maintained `.sysml` files.

## 3. The gap, precisely

### Tier 1 — portal-completion domains (finish the inside-the-portal model)

| Gap | Machine-readable source (exists) | Why it matters | Tracking |
| --- | --- | --- | --- |
| **Skill & agent-toolchain model** | `packages/dpf-skill-pack/skills/*/SKILL.md`, `SkillDefinition`/`SkillAssignment` seed, agent `tool_grants` | Completes substrate-spec §8 view #7; ties skills→coworkers→tools→enforced kernel principles into the authority graph | new item (EP-PARITY-ENGINE) |
| **Deployment & runtime contracts** | `docs/superpowers/specs/2026-05-09-deployment-contracts.md` (10 contracts), self-upgrade runner, `platform-support-watchlist.md` | Models how the portal deploys/upgrades; prerequisite for the operational bridge (a runtime instance realizes a deployment contract) | new item (EP-PARITY-ENGINE) |
| **Build-Studio + value-stream BPMN** | Build Studio phase gates, IT4IT value-stream activities (xlsx) | Process behaviour of the delivery lifecycle and the value streams; the open half of Slice 5 | `BI-PARITY-BPMN` (open) |

### Tier 2 — operational-reality frontier (bridge the three runtime layers into EA)

Each layer has comprehensive substrate and **zero `eaElementId`/EA relationship today** —
the bridge *is* the gap.

| Layer | Substrate (exists, isolated) | Bridge today |
| --- | --- | --- |
| **Operational graph** | `RuntimeTarget`, `RuntimeVerification` (`schema.prisma`), AI Operations Map (`/platform/ai/operations-map`), runtime-health, LGTM observability (`EP-FULL-OBS`), proactive-ops live status (`EP-PROACTIVE-OPS`) | **none** — no projection into `EaElement` |
| **Network topology** | `EdgeNode`, `DiscoveryRun`, `DiscoveredItem`/`DiscoveredRelationship`, `InventoryEntity`, `InventoryRelationship`, `DiscoveryConnection` (unifi/meraki/fortigate collectors), `DiscoveryFingerprintObservation` (`EP-EDGE-NODE`, `EP-AI-OPSMAP`) | **none** — scoped to `customerAccount`/`site`, no EA link |
| **Integrations / connected apps** | `McpIntegration` (tools bridged via PR #1880), `IntegrationCredential`, `IntegrationToolCallLog`, `IntegrationImportBatch`, `IntegrationCoverageProvider` (HRIS/ADP/ERP/banking) | **partial** — only MCP *tools*; external *applications* are not nodes in the graph |

The EA schema is already provisioned for these: `EaElement` carries `infraCiKey` (stable
source key for auto-extracted models), `refinementLevel` (`conceptual`/`logical`/`actual`),
and `ontologyRole`. No migration is required to *hold* operational elements — only new
element-type seed data and new reconcilers.

## 4. Decision

Extend the Parity Engine to close both tiers by the same auto-extraction contract, producing
**one living architecture graph** with explicit abstraction layers:

```
enterprise architecture   (ArchiMate: value streams, capabilities, business)   refinementLevel=conceptual
        │ realized-by
systems architecture       (SysML: requirements, parts, interfaces, allocation) refinementLevel=logical
        │ allocated-to
code graph                 (SysML part_definition ← Neo4j source-code subsystems) logical→actual
        │ deployed-as
operational graph          (SysML part_usage ← RuntimeTarget, runtime-health)     refinementLevel=actual
        │ hosted-on / connected-to
network topology + integrations (SysML part_usage/port ← EdgeNode, InventoryEntity, connectors) refinementLevel=actual
```

The canonical model stays the platform substrate (Postgres, EA graph, code graph, evidence).
SysML is the viewpoint that ties the layers together; the source registries remain the
authority. The bridge between a *logical* part (e.g. the `portal` system) and its *actual*
operational occurrence (a running `RuntimeTarget`) is an `allocates`/`traces` relationship at
`refinementLevel=actual` — exactly the code-structure extractor's pattern, generalized one
layer further down.

### 4.1 Element-type strategy (reuse first)

Per the substrate spec's boundary ("do not add element types until the existing set is proven
insufficient"), prefer reuse:

- **Operational instance** → `part_usage` (an occurrence of a logical `part_definition`),
  `refinementLevel=actual`, `properties.layer="operational"`, `properties.sourceKey` = the
  `RuntimeTarget` stable key. `allocates`/`traces` back to the logical part it realizes.
- **Network host / device** → `part_usage` with `properties.layer="network"`; a discovered
  service endpoint exposed via a `port`; device-to-device dependency via `connects`. (A new
  `network_node` element type is introduced **only if** ArchiMate's technology `node`/`device`
  semantics prove a better fit during implementation — captured as an open decision, not
  pre-committed.)
- **Connected external application** → `part_usage` with `properties.layer="integration"`,
  exposing an `interface_definition`/`port` for the integration contract; `connects` to the
  portal part that consumes it.

New element types, if any, are seeded in a `seed-ea-sysml2-operational.ts` sibling following
the exact upsert shape of `seed-ea-sysml2.ts` — additive, idempotent, no migration.

## 5. The reusable bridge contract (one shape, every layer)

Every new domain is the same five-step contract already proven six times over:

```
source of truth (Prisma table / discovery inventory / skill pack / connector registry)
  → pure extractor   build<Domain>Model(facts): SysmlDesiredModel   (stable sysmlKey, deterministic, unit-tested)
  → reconcile shell  reconcile<Domain>({ db, <sourceDeps> })        (reads source; CLEAN-SKIP if unavailable)
  → applySysmlModel  (create/update/revive/soft-remove + view + snapshot)
  → steward          skipped domain → EaConformanceIssue (never silent); auto-resolve when healthy
  → enforcement      reconcileSysmlProjections ∥ nightly steward ∥ CI parity gate
```

Worked target-state fragment (operational bridge, illustrative SysML v2 textual form — the
*derived* output, not a hand-maintained source):

```sysml
package 'Operational Graph' {
    // logical part from the systems model (already extracted)
    part def Portal;

    // actual runtime occurrence, derived from RuntimeTarget (refinementLevel=actual)
    part portalInstance : Portal {
        attribute sourceKey = "runtime:target:portal:dpf";   // stable infraCiKey
        attribute layer = "operational";
        attribute status = "healthy";                         // mirrored from lastHeartbeatAt
    }

    // the bridge: the running instance realizes/traces the logical system
    allocate portalInstance to Portal;

    // verification: a RuntimeVerification record proves the instance meets its contract
    verification def RuntimeHealthCheck verifies Portal;
}
```

To add a domain: write `build<Domain>Model`, write `reconcile<Domain>`, register it in
`reconcileSysmlProjections`' result type + body, add a `DOMAIN_LABELS` entry in the steward
(it then auto-handles skip→conformance), and add pure unit tests (idempotency, soft-remove,
clean-skip). That is the entire surface area per domain.

## 6. Impact analysis — the payoff (cross-layer blast radius)

The EA graph already ships bounded traversal patterns (`run_traversal_pattern`:
`blast_radius`, `architecture_traceability`, `service_customer_impact`, …) and the
`requirement_satisfaction` SysML pattern. Today a `blast_radius` from a code subsystem stops
at the code layer. Once the operational/network/integration parts are *in the same graph*
with `allocates`/`connects`/`hosted-on` edges, the **same** traversal answers a cross-layer
question with no new query engine:

> change `apps/web/lib/ea` → (code structure) which subsystems import it → (routes) which
> route families render it → (operational) which `RuntimeTarget`s serve those routes →
> (network) which `EdgeNode`/hosts run those targets → (integration) which connected
> applications depend on those endpoints.

That single chain is enterprise-architecture realization meeting operational reality. It is
unlocked purely by putting every layer's actual elements into the one graph the traversal
patterns already walk — which is the whole point of the catch-up.

## 7. Toward the real-time graph

Current cadence is the nightly steward reconcile plus the operator's on-demand
`refreshSysmlProjections()`. "Real-time" is an evolution, not a rebuild: keep the full
scheduled reconcile as the drift backstop, and add **event-triggered incremental projection**
at the three points where actual-layer reality changes:

- **deploy / self-upgrade complete** → refresh the operational projection for the swapped
  service (image identity = bytes, so the instance's `sourceKey`/version updates).
- **discovery-run complete** (`DiscoveryRun` finishes) → refresh the network projection for
  that scope.
- **runtime heartbeat / health transition** → update the instance's `status` attribute
  (debounced; status is an attribute mutation, not a structural change, so it does not churn
  snapshots).

This is deferred to a later phase (§8) so the structural bridge lands first; real-time is a
freshness optimization over a correct graph, not a prerequisite for it.

## 8. Phased plan (mapped to backlog)

| Phase | Outcome | Tier | Backlog |
| --- | --- | --- | --- |
| **A** | Skill & agent-toolchain extractor → live projection | 1 | new item, `EP-PARITY-ENGINE` |
| **B** | Deployment/runtime-contracts extractor; finish Build-Studio + value-stream BPMN | 1 | new item + `BI-PARITY-BPMN` |
| **C** | Operational-graph bridge (`RuntimeTarget`/runtime-health → EA, actual) | 2 | new item, new epic |
| **D** | Network-topology bridge (`EdgeNode`/`InventoryEntity`/`DiscoveryConnection` → EA) | 2 | new item, new epic |
| **E** | Integration bridge (connected external applications → EA part/interface) | 2 | new item, new epic |
| **F** | Cross-layer impact-analysis views + traversal coverage (blast_radius across layers) | 2 | new item, new epic |
| **G** | Event-driven incremental projection (real-time freshness) | 2 | new item, new epic |

Phases A–B complete the portal's own current-state model (the operator's "first step").
Phases C–G build the living-graph frontier. Each phase is independently shippable, drift-proof
on landing, and adds exactly one extractor + its tests.

## 9. SysML Architecture Note

- **Scope:** EA/architecture substrate (`/ea`). Adds new auto-extraction domains to the
  Parity Engine and three actual-refinement bridge layers; no change to the portal's
  user-facing routes.
- **Changed requirements/constraints:** *new* — every portal architecture domain and every
  actual runtime/network/integration element must be a derived projection with a stable
  `sourceKey` (constraint: no hand-maintained architecture data; default-deny drift). *new* —
  operational/network/integration elements are `refinementLevel=actual` and MUST `allocate`/
  `trace` to the logical part they realize (constraint: no orphan actual elements).
- **Changed interfaces/ports:** new domain reconcilers registered in
  `reconcileSysmlProjections`; new read-side dependencies (`RuntimeTarget`, discovery
  inventory, skill pack) injected per-reconcile for testability. No new MCP tool surface in
  Phases A–B; Phase C+ may expose a read-only `query_operational_graph` traversal later.
- **Allocations:** extractors in `apps/web/lib/ea/*`; element-type seed in
  `packages/db/src/seed-ea-sysml2*.ts`; orchestration in `reconcile-sysml-projections.ts` +
  `architecture-parity-steward.ts`; schedule via `agent-task-scheduler`.
- **Verification cases:** pure-module unit tests per extractor (idempotency, soft-remove,
  clean-skip); CI architecture-parity gate stays green; runtime EA validation against the
  canonical install / shared lease (deferred from the worktree per §13).
- **Data authority impact:** none reassigned — the registries/tables remain authoritative;
  SysML is the derived viewpoint. New projections add read-only mirrors only.
- **EA/current-state catch-up:** completes substrate-spec §8 view #7 (skill/toolchain) and
  adds three new actual-layer views (operational, network, integration) plus a cross-layer
  impact view.
- **Parity/extractor impact:** `reconcileSysmlProjections` gains one entry per domain; the
  steward's `DOMAIN_LABELS` gains one label per domain (auto-extends skip→conformance
  coverage). The CI parity baseline grandfathers existing gaps.
- **Open architecture risks:** see §11.

## 10. Verification

- **Source-local (worktree):** per-extractor pure unit tests; `pnpm --filter web typecheck`
  on touched files; targeted `vitest`.
- **Runtime (canonical install / shared lease):** the nightly steward reconcile produces the
  live projections; EA-surface validation that the new views render and the cross-layer
  `blast_radius` traverses end-to-end. Deferred from the worktree per the substrate spec's
  stance; named explicitly as the canonical-runtime gate.
- **Drift:** the existing CI parity gate plus the steward's conformance issues prove each new
  projection is self-policing on landing.

## 11. Risks

- **Actual-layer churn.** Runtime status flaps; a naive projection would thrash snapshots.
  Mitigation: status is an *attribute*, not structure; only structural deltas snapshot;
  heartbeat updates are debounced (§7).
- **Scope/PII in discovery data.** Network inventory is customer/site-scoped and may carry
  sensitive host data. Mitigation: the bridge projects only platform-estate elements by
  default; customer-scoped discovery stays behind the existing scope keys and is not globally
  graphed without explicit authority.
- **Element-type sprawl.** Over-typing operational/network kinds re-creates ceremony.
  Mitigation: reuse `part_usage`+`layer` property first; introduce a new type only on proven
  semantic need (§4.1).
- **Over-modeling.** Model only what enables impact analysis, authority, verification, or
  drift control — not exhaustive runtime telemetry (that stays in LGTM/observability).
- **Real-time complexity.** Event-driven projection adds moving parts. Mitigation: it is
  Phase G, layered over a correct scheduled graph; the scheduled reconcile remains the
  backstop.

## 12. Open questions

1. Network elements: reuse SysML `part_usage`+`layer` or introduce ArchiMate technology
   `node`/`device` types for true network topology? (Decide in Phase D against real
   `InventoryEntity` shapes.)
2. Should the operational/network bridge expose a dedicated read-only MCP traversal
   (`query_operational_graph`) or extend the existing `run_traversal_pattern` patterns?
3. Customer-scoped discovery: in-scope for the platform's own EA graph, or a per-tenant
   sub-graph with an explicit authority boundary?
4. Does the cross-layer impact view live under `/ea` or a new `/ea/impact` surface? (UX-fit
   review at Phase F.)

## 13. Boundaries (inherited)

- No new Prisma models until the existing EA substrate is proven insufficient (it is not).
- No hand-maintained `.sysml` as canonical; text/diagrams are derived.
- No silent overwrite of drift; use the parity gate + steward + `EaConformanceIssue` path.
- No runtime-validation claims from the worktree; route runtime gates through the canonical
  install or shared local-CI lease.
- No SysML where a smaller ArchiMate/BPMN/C4 view is the adequate answer.
