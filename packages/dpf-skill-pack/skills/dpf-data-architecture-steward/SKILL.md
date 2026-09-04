---
name: dpf-data-architecture-steward
description: "Use when asked about the DPF data model, ERD, table relationships, foreign keys, indexes, schema structure, or schema drift."
disable-model-invocation: false
user-invocable: true
allowed-tools: mcp__dpf__describe_model mcp__dpf__query_ontology_graph mcp__dpf__explain_blast_radius mcp__dpf__search_code_graph mcp__dpf__wiki_query

category: data-stewardship
assignTo: ["data-architect"]
capability: null
taskType: review
triggerPattern: "data model|data architecture|ERD|entity relationship|schema (structure|drift|map)|foreign key|table relationships|mirror the (prisma|data) model"
userInvocable: true
agentInvocable: true
allowedTools: ["mcp__dpf__describe_model", "mcp__dpf__query_ontology_graph", "mcp__dpf__explain_blast_radius", "mcp__dpf__search_code_graph", "mcp__dpf__wiki_query"]
composesFrom: ["dpf-verify-substrate-first", "dpf-architecture-review"]
contextRequirements: ["EA data-model view present (or generatable via the data-model mirror)"]
riskBand: low
enforces:
  - kernel/principles/single-source-of-truth
  - kernel/principles/research-and-use-standards
  - kernel/principles/structural-verification-is-not-functional
---

# Data Architecture Steward

The Data Architect (AGT-BUILD-DA) owns the **self-maintaining data architecture** (EP-DATA-ARCH): the Prisma data model is mirrored into the EA tool as a live ERD that stays current as the schema evolves, and drift is surfaced as governed conformance findings.

Use this skill when someone — in Build Studio **or on-demand in chat** — asks to see, explain, or refresh the data architecture.

## The loop you steward

1. **Extract** — `parsePrismaSchema` reads `schema.prisma` into models, fields, relations, cardinality, and FK-index facts (`apps/web/lib/build/code-graph/extractors/prisma-schema-adapter.ts`).
2. **Mirror** — `reconcileDataModelMirror` projects those facts into the EA substrate as `data_object` elements + `associated_with` relationships, idempotently, under the system-owned **Data Model** view; it writes an `EaSnapshot` on material change and **stops** (with a conformance issue) on duplicate identity (`apps/web/lib/ea/data-model-mirror-apply.ts`).
3. **View** — the ERD renders at `/ea/data-model` (and the generic `/ea/views/[id]` renderer) with an evolution timeline.
4. **Steward** — `runDataArchitectureSteward` runs deterministic drift detectors (FK-without-index, missing-inverse-relation, orphan-model, ignored-model) and reconciles them into self-healing `EaConformanceIssue` rows (`apps/web/lib/ea/data-architecture-steward-apply.ts`).

`runDataModelMirror` composes all of this; it runs nightly (scheduled task `data-model-mirror-nightly`) and on demand (the "Generate data model now" action / this skill).

## How to answer

- **"Show / refresh the data architecture"** → ensure the mirror is current (it may need a run if the ERD is empty), then summarize the Data Model view: model count, domain groupings, and open drift findings.
- **"What does model X relate to / what depends on it?"** → use `describe_model` for fields, `query_ontology_graph` / `explain_blast_radius` for relationships and impact.
- **Drift questions** ("which FKs lack indexes?") → read the open `EaConformanceIssue` rows of the relevant `issueType`; cite the specific models.

## Boundaries

- **Never mutate mirror-owned facts.** The deterministic mirror owns structure (elements/relationships/`properties.sourceKey`). Your enrichment — domain grouping, relationship naming — goes in coworker-owned annotation fields (`EaViewElement.proposedProperties`), never by editing mirror rows.
- **Material structural changes** (a model removed, a cardinality flipped) route through the decision kernel (`principle_decide`) and are recorded — they are not silently applied.
- **Structural ≠ functional**: confirm a finding against the live mirror/snapshot before reporting it as real.
