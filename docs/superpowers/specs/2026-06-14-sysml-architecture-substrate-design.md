# SysML Architecture Substrate - Design

| Field | Value |
| ----- | ----- |
| Status | Phase 1 implemented (PR #1864); Phase 2 in progress — see §15 Implementation Log |
| Date | 2026-06-14 |
| Owner | Enterprise Architect, Data Architect, Build Studio platform team |
| Route family | Existing EA surface (`/ea`) |
| Backlog state | Live MCP returned 401 and DB fallback refused connection during this thread. Backlog anchoring and runtime validation are deferred to a follow-up thread by operator instruction. |
| References | `docs/Reference/sysml-v2.md`; OMG SysML 2.0, KerML 1.0, Systems Modeling API 1.0 |

## 1. Problem

DPF already has a serious architecture substrate: EA notation seeds, ArchiMate 4,
BPMN 2.0, cross-notation relationships, `EaView`, `ViewpointDefinition`,
Neo4j projection, data-model mirror, Build Studio architecture review, and the
DPF platform skill pack. The missing piece is a formal internal systems
architecture language that can represent the obligations agents must preserve:
requirements, constraints, interfaces, allocations, behaviors, verification
cases, and traceability across platform changes.

Human-readable diagrams alone do not solve this. C4 is useful for explaining
software shape, and ArchiMate is useful for enterprise architecture, but agents
need a more constraint-bearing model when they plan changes to data authority,
MCP tools, Build Studio delivery, deployment contracts, AI coworker boundaries,
and value-stream implementation. SysML v2 is now formal and has a companion API
standard, so DPF should adopt it deliberately as an internal architecture
substrate.

## 2. Goals

1. Add SysML v2 to DPF reference documentation as the current systems modeling
   standard.
2. Establish SysML v2 as an internal EA viewpoint/notation for architects and
   advanced reseller/operator review, not as a normal-user feature.
3. Use SysML v2 to catch up DPF's current state in structured EA views.
4. Make SysML-aware planning available to Build Studio and external Codex,
   Claude, and Grok agents through the DPF skill pack.
5. Keep the DPF EA graph and existing source-of-truth models canonical.
6. Plan the refactoring needed so SysML seed work extends the existing notation
   framework instead of copying ArchiMate/BPMN seed code.

## 3. Non-Goals

- Do not adopt SysON, the Eclipse pilot, CATIA Magic, Sparx, Visual Paradigm, or
  any other SysML tool in this slice.
- Do not make `.sysml` files the platform source of truth.
- Do not expose SysML detail to ordinary business users by default.
- Do not add new EA tables until the existing `EaNotation`/`EaElementType`/
  `EaRelationshipType`/`EaView`/`ViewpointDefinition` substrate is proven
  insufficient.
- Do not treat runtime/build validation as complete in this thread; operator
  explicitly deferred validation to a separate thread.

## 4. Current-State Substrate

| Area | Existing substrate | Design implication |
| --- | --- | --- |
| EA notation | `EaNotation`, `EaElementType`, `EaRelationshipType`, `EaRelationshipRule`, `EaDqRule`, `EaTraversalPattern`, `EaFrameworkMapping`. | Add `sysml2` as seed data first; avoid new tables. |
| Views | `EaView`, `EaViewElement`, `ViewpointDefinition`, `/ea/views`, `/ea/data-model`, `/ea/value-streams`. | SysML appears under the existing EA route and Views & Viewpoints. |
| ArchiMate | `seed-ea-archimate4.ts` seeds enterprise, application, technology, data, governance, AI coworker, and traversal patterns. | Map SysML concepts to existing ontology where semantics overlap. |
| BPMN | `seed-ea-bpmn20.ts` seeds process behavior and process traversal patterns. | Use BPMN for executable workflow; use SysML for system behavior/verification semantics. |
| Cross-notation | `seed-ea-cross-notation.ts` links BPMN behavior to ArchiMate structure. | Add SysML cross-notation mappings instead of isolated SysML islands. |
| Data architecture | EP-DATA-ARCH mirrors Prisma into EA and uses conformance issues for drift. | SysML data architecture must enrich/mirror authority and constraints, not replace Prisma/ERD. |
| Skill pack | `packages/dpf-skill-pack` seeds the same skills to Build Studio coworkers and external agent surfaces. | Put SysML guidance in the DPF platform skill pack, not only in legacy `skills/ea`. |
| EA docs | User guide still frames ArchiMate as the notation for all models. | Update docs to say ArchiMate is default, while BPMN and SysML are specialized viewpoints. |

## 5. Standards And Benchmarking

### Official standard

- [OMG SysML 2.0](https://www.omg.org/spec/SysML/2.0/About-SysML) is formal
  with September 2025 publication. It covers requirements, structure, behavior,
  analysis cases, verification cases, and multiple systems engineering methods.
- [OMG KerML 1.0](https://www.omg.org/spec/KerML/1.0/About-KerML) is formal
  with September 2025 publication and supplies the semantic foundation for
  SysML v2.
- [OMG Systems Modeling API and Services 1.0](https://www.omg.org/spec/SystemsModelingAPI/1.0/About-SystemsModelingAPI)
  is formal with September 2025 publication and supplies the future
  interoperability boundary.

### Open-source benchmarks

- [Eclipse SysON](https://github.com/eclipse-syson/syson) shows the right
  direction for web-based graphical/textual/form editing over a model
  repository. Adopt the model/view separation idea. Reject tool adoption until
  DPF tool evaluation completes.
- [SysML v2 Pilot Implementation](https://github.com/Systems-Modeling/SysML-v2-Pilot-Implementation)
  is the reference/pilot ecosystem for textual notation, visualization, and
  interchange. Adopt the idea of textual syntax as automation-friendly. Reject
  direct coupling to pilot internals.
- [Syside/sysml-2ls](https://github.com/sensmetry/sysml-2ls) demonstrates the
  developer-workflow appeal of language-server style textual modeling. Adopt
  the idea that external coding agents can consume/write structured architecture
  notes. Reject editor-specific dependencies in the DPF substrate.

### Commercial benchmarks

- [CATIA Magic](https://www.3ds.com/products/catia/catia-magic) emphasizes
  synchronized textual and graphical SysML v2 modeling. Adopt the expectation
  that diagrams and text must stay consistent. Reject vendor source-of-truth
  lock-in.
- [Sparx Systems Trechoro](https://sparxsystems.com/mbse/sysml2/) emphasizes
  native SysML v2/KerML modeling inside a broader modeling environment. Adopt
  standards-native semantics. Reject a separate modeling home outside EA.
- [Visual Paradigm SysML v2 Studio](https://www.visual-paradigm.com/features/sysml-v2-studio/)
  emphasizes browser-based code-to-diagram sync and AI assistance. Adopt the
  AI-assisted modeling pattern. Reject hosted-tool dependency for DPF's
  canonical model.

## 6. Decision

Adopt SysML v2 as a DPF-internal systems architecture viewpoint over the
existing EA substrate.

The canonical model remains DPF's graph and source-of-truth systems. SysML v2
adds stronger semantics for requirements, constraints, interfaces, allocations,
verification, and system behavior. It is not a replacement for ArchiMate, BPMN,
C4, Prisma, code graph, or evidence records.

## 7. Concept Mapping

| SysML v2 concept | DPF use | Existing/future substrate |
| --- | --- | --- |
| Package | Architecture boundary or model namespace. | `EaView.scopeType/scopeRef`, `EaElement.properties.sysmlPackage`. |
| Part definition / part usage | System, subsystem, component, deployed part. | Existing `digital_product`, `application_component`, `technology_node`; future `sysml_part_definition` if needed. |
| Interface definition / port | Explicit contract or access point. | Existing `application_interface`; future SysML interface/port element types. |
| Requirement | Required behavior or quality. | Existing `requirement`; future SysML requirement type for richer metadata. |
| Constraint | Design restriction, invariant, policy. | Existing `constraint`/`ea_control`; SysML constraint viewpoint for analysis. |
| Action / behavior | System behavior. | BPMN for executable processes; SysML behavior for system-level semantics. |
| State | System lifecycle or operating mode. | Existing lifecycle fields plus future SysML state elements. |
| Allocation | "This logical obligation is realized here." | Relationship type mapped to `realizes`/future `allocates`. |
| Satisfy / verify / trace | Requirement traceability and proof. | Relationship types plus `EaConformanceIssue` and evidence links. |
| Verification case | Check that proves a requirement/constraint. | Future SysML verification element linked to tests/build evidence. |

## 8. Current-State Catch-Up Views

The first model-catch-up wave should produce architect-owned EA views for DPF
itself:

1. **DPF Platform System Decomposition** - system, major subsystems, services,
   data stores, local AI runtime, MCP plane, Build Studio, portal, and workers.
2. **Data Authority and Projection Model** - Postgres authority, Neo4j
   projection, Qdrant embeddings, Prisma mirror, source keys, conformance
   findings, and ownership rules.
3. **AI Agent Authority Model** - agents, principals, tool grants, MCP token
   scope, authority bindings, HITL boundaries, and evidence requirements.
4. **Build Studio Delivery Lifecycle** - ideate/plan/build/review/ship,
   WorkCapsule, FeatureBuild, nonprod lease, verification evidence, and release
   governance.
5. **Deployment and Runtime Contracts** - installer/self-upgrade, image identity,
   canonical local install, shared local-CI convergence sandbox, platform support
   watchlist, and substrate-specific deltas.
6. **Value Stream to System Allocation** - value streams, capabilities,
   Build Studio work, data model, and platform runtime components.
7. **Skill and Agent Toolchain Model** - DPF skill pack, external surfaces
   (Codex, Claude, Grok), Build Studio coworker skill seeding, and MCP config.

Each view should identify its source facts, expected refresh path, owner, and
which facts are deterministic versus architect-authored judgment.

## 9. Build Studio And External Agent Integration

SysML becomes useful only if it enters the work lifecycle:

- **Ideate:** medium/large platform work asks whether system boundaries,
  interfaces, requirements, constraints, data authority, or verification cases
  are affected.
- **Plan:** plans include a SysML architecture note for affected areas:
  changed requirements, changed interfaces, allocations, verification cases,
  and EA/current-state catch-up tasks.
- **Build:** agents update source-controlled substrate or record the EA update
  as explicit follow-up work. No hidden hand-edited diagrams.
- **Review:** architecture review checks the SysML note against the canonical
  EA graph and DPF rulebook.
- **Ship:** release evidence names whether SysML/EA catch-up was completed,
  deferred, or not applicable.

External Codex, Claude, and Grok sessions consume the same DPF platform skill.
They should produce the same SysML architecture note format as Build Studio.

## 10. Phased Delivery Plan

### Phase 0 - Reference, skill, and planning substrate

Deliverables:

- `docs/Reference/sysml-v2.md`
- this design spec
- `dpf-sysml-architecture-substrate` skill
- profession registry and EA docs updates

Verification:

- Markdown/source sanity checks only in this thread.
- Runtime/build validation deferred by operator instruction.

### Phase 1 - SysML notation seed and viewpoint refactor

Deliverables:

- Add `packages/db/src/seed-ea-sysml2.ts`.
- Refactor `seedEaViewpoints` into a reusable notation-aware helper before
  adding SysML viewpoints.
- Seed a minimal `sysml2` subset: package, part definition, part usage,
  requirement, constraint, interface definition, port, action, state,
  verification case, analysis case.
- Seed relationships: contains, specializes, connects, allocates, satisfies,
  verifies, refines, traces.
- Add cross-notation relationships to ArchiMate/BPMN where needed.

Verification:

- Unit tests for idempotent seed behavior and viewpoint resolution.
- Migration-free if possible; if a migration is required, it must be narrow and
  verified in the future validation thread.

### Phase 2 - DPF current-state catch-up

Deliverables:

- Create the seven DPF platform current-state views from section 8.
- For each view, record source facts, owner, refresh path, and known gaps.
- Store deterministic facts in EA properties/source keys where practical.
- Store architect judgment in proposed/annotation fields and conformance issues.

Verification:

- Source-local checks for view seed idempotency.
- Future EA/browser verification against the rebuilt portal.

### Phase 3 - Build Studio planning hooks

Deliverables:

- Update design/plan review prompts so architecture-impacting work produces a
  SysML architecture note.
- Update architecture advisory output to flag missing requirement/interface/
  allocation/verification updates.
- Teach Build Studio decomposition to create explicit catch-up work when a
  planned change changes the system model.

Verification:

- Prompt snapshot/unit tests.
- Build Studio flow verification in a separate thread.

### Phase 4 - External agent convergence

Deliverables:

- Ensure Codex, Claude, and Grok bootstrap/update paths carry the new skill.
- Add examples to the skill for platform software architecture, data
  architecture, and agent authority.
- Add an external evidence handoff field/section for SysML architecture impact
  when a coding agent contributes platform work.

Verification:

- Skill seed tests.
- Agent-toolchain update tests where available.

### Phase 5 - Tool evaluation and import/export

Deliverables:

- Evaluate candidate SysML tools through the Tool Evaluation Pipeline.
- If approved, choose an adapter boundary: Systems Modeling API first, direct
  file import/export second, vendor-specific API last.
- Add import/export only after DPF-native substrate is stable.

Verification:

- Tool-evaluation records and approved-tools registry entry before dependency
  adoption.

## 11. Refactoring Budget

Reserve roughly 20 percent of implementation effort for refactoring:

- Generalize notation/viewpoint seed helpers before adding SysML.
- Centralize cross-notation mapping definitions so ArchiMate/BPMN/SysML do not
  drift independently.
- Keep SysML concept mapping in one registry rather than scattering local maps.
- Improve docs/prompts that still say ArchiMate is the only notation.
- Use existing conformance issue and traversal pattern substrate instead of
  adding duplicate finding tables.

## 12. UX Fit

Decision: fits-with-guardrails.

- Owning area: Architecture/EA.
- Route family: existing `/ea`.
- Primary personas: platform architect, data architect, Build Studio reviewer,
  advanced reseller/partner technical reviewer.
- Normal users: no direct SysML exposure by default.
- Navigation layer: existing EA tab and Views & Viewpoints; optional notation
  filters later.
- Component reuse: existing EA canvas/list components and report-kit for any
  tables/badges/status displays.
- Empty state: say no SysML views exist yet and offer architect-only creation or
  catch-up action when the substrate lands.

## 13. Risks

- **Over-modeling:** SysML can become ceremony. Mitigation: model only what
  affects planning, verification, authority, interfaces, or current-state
  catch-up.
- **Parallel source of truth:** Hand-maintained `.sysml` files can drift.
  Mitigation: DPF EA graph stays canonical; text export is derived until a
  governed adapter says otherwise.
- **Tool lock-in:** Commercial tools are strong but can capture the model.
  Mitigation: DPF-native substrate first; Systems Modeling API adapter boundary.
- **Notation confusion:** Architects may need ArchiMate, BPMN, C4, and SysML.
  Mitigation: document each notation's role and choose the smallest adequate
  viewpoint for each task.
- **Validation gap:** This thread intentionally defers runtime validation.
  Mitigation: future validation thread must run source, build, seed, and browser
  checks before implementation claims are considered complete.

## 14. Open Questions

1. Should the canonical public URL remain `/ea` or move to `/architecture` after
   the architecture IA work stabilizes?
2. Which current-state catch-up view should be first: data authority, Build
   Studio lifecycle, or AI agent authority?
3. Should SysML textual export be generated in Phase 2, or wait until Phase 5
   tool evaluation?
4. Should resellers receive read-only SysML views by role, by capability, or
   through exported review packets?
5. Which Build Studio gate owns mandatory SysML note enforcement for large
   platform changes: Ideate, Plan, or both?

## 15. Implementation Log (appended)

Status of the phased plan against shipped work (source-local verified; runtime EA
validation deferred per §10/§13):

- **Phase 0 — Reference, skill, planning substrate:** done (this spec,
  `docs/Reference/sysml-v2.md`, `dpf-sysml-architecture-substrate` skill). EA-docs
  conformance (§4 EA-docs row / §11) now landed: `docs/user-guide/architecture/index.md`
  + `prompts/route-persona/ea-architect.prompt.md` +
  `prompts/specialist/architecture-definition-agent.prompt.md` updated to frame
  ArchiMate as default with BPMN and SysML v2 as specialized viewpoints.
- **Phase 1 — SysML notation seed + viewpoint refactor:** implemented (PR #1864).
  `packages/db/src/seed-ea-sysml2.ts` seeds the `sysml2` notation (package,
  part-definition/usage, requirement, constraint, interface-definition, port,
  action, state, verification/analysis case; relationships contains/specializes/
  connects/allocates/satisfies/verifies/refines/traces + rules + DQ rules + a
  requirement-satisfaction traversal). `seedEaViewpoints` refactored into the
  reusable notation-aware helper `seed-ea-viewpoints.ts` (§11). Cross-notation
  SysML→ArchiMate bridges (`sysml_allocates`/`sysml_traces`/`sysml_verifies`) added
  to `seed-ea-cross-notation.ts`. Unit-tested (idempotent seed + viewpoint resolution).
- **Phase 2 — DPF current-state catch-up views:** in progress. Two SysML models
  seeded as EA graph content: **AI Cockpit & Model Routing**
  (`seed-ea-sysml-ai-cockpit.ts`, target/design model) and **AI Agent Authority —
  Current State** (`seed-ea-sysml-agent-authority.ts`, catch-up view #3 from §8) —
  the latter grounded in the real authority substrate (default-deny grants, dual
  capability+grant gate, HITL envelopes, dual-principal audit), marking deterministic
  vs architect-authored facts with source keys and filing a conformance issue for the
  one verification gap found (AuthorizationDecisionLog write-site unconfirmed).
  Remaining §8 views (System Decomposition, Data Authority, Build Studio Lifecycle,
  Deployment/Runtime Contracts, Value-Stream→System, Skill/Toolchain) are next.
- **Phases 3–5** (Build Studio planning hooks, external-agent convergence, tool
  evaluation / import-export): not started.

Decisions on §14 open questions (defaults, revisable): **Q2** first catch-up view =
**AI Agent Authority** (governance moat; extends the AI-cockpit model). Q1, Q3, Q4,
Q5 remain open.
