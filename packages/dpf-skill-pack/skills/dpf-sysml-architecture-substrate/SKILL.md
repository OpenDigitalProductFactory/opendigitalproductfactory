---
name: dpf-sysml-architecture-substrate
description: "Use when DPF platform work needs SysML v2 systems-architecture reasoning — EA substrate, requirements, interfaces, allocations, verification cases, or architect-facing planning handoff."

# Agent Skills standard fields (Surface A - Claude Code / Codex / Grok)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob mcp__dpf__search_specs_and_plans mcp__dpf__search_code_graph mcp__dpf__query_ontology_graph mcp__dpf__wiki_query

# DPF coworker fields (Surface B - in-portal seed loader)
category: architecture
assignTo: ["ea-architect", "data-architect", "build-specialist", "platform-engineer"]
capability: null
taskType: review
triggerPattern: "SysML|systems model|systems architecture|model-based|MBSE|interface allocation|verification case|requirements traceability|architecture substrate|current-state architecture catch-up"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob", "mcp__dpf__search_specs_and_plans", "mcp__dpf__search_code_graph", "mcp__dpf__query_ontology_graph", "mcp__dpf__wiki_query"]
composesFrom: ["dpf-architecture-review", "dpf-data-architecture-steward", "dpf-verify-substrate-first"]
contextRequirements: ["docs/Reference/sysml-v2.md readable", "EA substrate readable", "SysML design spec readable when available"]
riskBand: low

# Kernel principle enforcement
enforces:
  - kernel/principles/architecture-over-shortcuts
  - kernel/principles/single-source-of-truth
  - kernel/principles/research-and-use-standards
  - kernel/principles/schema-audit-before-features
---

# DPF SysML Architecture Substrate

Use SysML v2 as an internal architecture reasoning layer over DPF's existing EA
substrate. Do not treat SysML as a separate documentation island or as a
normal-user feature.

## Read First

1. `docs/Reference/sysml-v2.md`
2. `docs/superpowers/specs/2026-06-14-sysml-architecture-substrate-design.md`
3. `docs/superpowers/specs/2026-06-14-design-implementation-parity-engine-design.md`
4. `docs/superpowers/specs/2026-06-06-data-architecture-self-maintenance-design.md`
5. `packages/db/prisma/schema/ea-architecture.prisma` (the schema is split across `packages/db/prisma/schema/*.prisma`; there is no monolithic `schema.prisma`)
6. Relevant Build Studio/design spec or implementation plan under review

## Modeling Stance

- DPF's canonical model is the platform substrate: Postgres, EA graph, code
  graph, governed evidence, and mirrored runtime facts.
- SysML v2 is a notation/viewpoint over that substrate for requirements,
  constraints, interfaces, allocations, behavior, verification, and traceability.
- ArchiMate remains the default EA notation. BPMN remains the workflow/process
  behavior notation. C4 remains the lightweight human-readable software view.
- SysML is for architects, data architects, Build Studio planning/review, and
  external coding agents. Do not surface SysML complexity to ordinary users.
- Current-state SysML/BPMN should come from the Parity Engine's live projections
  whenever a source registry/manifest/graph/state machine exists. Hand-authored
  SysML is for bounded architect judgment, target-state notes, or explicitly tracked
  catch-up gaps.

## Concept Map

| SysML concept | DPF interpretation |
| --- | --- |
| Package | Architecture namespace or view boundary. |
| Part definition / part usage | System, subsystem, component, runtime part, or platform capability. |
| Interface / port | Explicit contract, API, MCP tool boundary, data access boundary, or event boundary. |
| Requirement | Required system behavior, quality, policy, or capability. |
| Constraint | Rule that limits implementation choices. |
| Action / behavior | System-level behavior; use BPMN for executable process detail. |
| State | Lifecycle or operating mode. |
| Allocation | Logical obligation assigned to an implementation element. |
| Satisfy / verify / trace | Requirement and evidence traceability. |
| Verification case | Test, gate, or evidence record that proves a requirement or constraint. |

## When Planning A Change

Produce a short "SysML architecture note" whenever the work changes platform
architecture, data architecture, agent authority, runtime/deployment contracts,
or Build Studio behavior.

Include:

1. **System boundary:** what system, subsystem, package, or view changes.
2. **Requirements/constraints:** new or changed obligations.
3. **Interfaces/ports:** APIs, MCP tools, events, data access, permissions, or
   external contracts changed.
4. **Allocations:** which components, agents, routes, models, jobs, or runtime
   substrates realize the obligation.
5. **Verification cases:** tests, build gates, UX checks, migration checks, or
   evidence records that prove the change.
6. **Data authority:** source of truth, derived projection, mirror, or sync rule
   affected.
7. **EA catch-up:** views, viewpoint definitions, conformance issues, or
   reference docs that must be updated.
8. **Parity impact:** extractor, projection, parity gate, or conformance issue
   behavior that must change so the model remains derived from source.

## Current-State Catch-Up Workflow

1. Name the current-state slice: data authority, AI agent authority, Build
   Studio lifecycle, deployment contracts, platform decomposition, value-stream
   allocation, or skill/toolchain model.
2. Check whether the slice already has a Parity Engine extractor/projection.
   Prefer updating the source registry or extractor over editing SysML view data.
3. Gather source facts from existing code, schema, specs, EA views, and runtime
   evidence. Do not invent architecture.
4. Decide the viewpoint: ArchiMate for enterprise structure, BPMN for process,
   C4 for human software view, SysML for requirements/interfaces/allocation/
   verification semantics.
5. Write or update the EA view specification. If direct EA mutation is not
   available, capture a backlog item or implementation task explicitly.
6. Mark deterministic facts separately from architect-authored interpretation.
7. Record conformance issues for drift, missing source keys, orphaned elements,
   missing verification cases, or ambiguous authority.

## Boundaries

- Do not add new Prisma models for SysML until the existing EA substrate is
  proven insufficient.
- Do not adopt external SysML tools without the Tool Evaluation Pipeline.
- Do not hand-maintain `.sysml` files as the canonical architecture.
- Do not silently overwrite model drift. Use the parity gate, projection reconciler,
  and `EaConformanceIssue` steward path so gaps are reviewable.
- Do not claim runtime validation from a worktree or source-only review.
- Do not use SysML when a small C4, ArchiMate, or BPMN view is the simpler
  adequate answer.

## Output Template

```markdown
## SysML Architecture Note

- Scope:
- Changed requirements/constraints:
- Changed interfaces/ports:
- Allocations:
- Verification cases:
- Data authority impact:
- EA/current-state catch-up:
- Parity/extractor impact:
- Open architecture risks:
```

## Worked Example

For a Build Studio change that lets external Codex sessions update platform
work:

- Requirement: external sessions must be evidence-gated like Build Studio.
- Constraint: no surface may bypass MCP coordination or DCO/PR rules.
- Interface: MCP work-capsule and evidence tools.
- Allocation: Codex plugin skill pack, MCP server, FeatureBuild/Workroom
  substrate, nonprod lease.
- Verification case: source-local tests plus shared local-CI/canonical runtime
  build/UX evidence.
- EA catch-up: update the agent toolchain model and authority model views.
