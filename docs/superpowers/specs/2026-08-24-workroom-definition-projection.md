---
status: active
---

# Workroom definition projection

**Backlog item:** `BI-80BECE1E`

## Purpose

Realize the [canonical definition/instance boundary](../../architecture/workroom-vocabulary-boundary.md)
through the existing Work Case projection and Workspace route.

## Research & Benchmarking

[FPAW section 20](../../architecture/four-portfolio-archetype-ai-workforce-operating-standard.md#20-research-and-source-register)
compares OMG CMMN and W3C PROV-O. This slice adopts their definition/occurrence
and trace boundaries; it rejects a parallel agent task bus.

## Objective

1. **OBJ-WR-001:** Distinguish a reusable Workroom definition from its occurrence without requiring development evidence or a parallel surface.

## Acceptance

| Acceptance | Objectives | Requirement | Evidence |
|---|---|---|---|
| AC-WR-001 | OBJ-WR-001 | The registry owns a stable definition key and positive version. | test |
| AC-WR-002 | OBJ-WR-001 | `WorkroomView` has definition plus occurrence source, cycle, and carriers. | test |
| AC-WR-003 | OBJ-WR-001 | Unknown definitions stay null; development evidence is optional. | test |
| AC-WR-004 | OBJ-WR-001 | Overview is default; Details reveals work, evidence, and raw refs. | test |
| AC-WR-005 | OBJ-WR-001 | No schema, route, API, queue, or parallel registry is added. | gate |
