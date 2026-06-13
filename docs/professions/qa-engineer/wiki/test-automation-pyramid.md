---
title: The test automation pyramid
pageKind: heuristic
status: published
abstract: Write lots of fast unit tests, fewer coarse-grained service/integration tests, and very few slow end-to-end tests. The shape optimizes for fast feedback because higher-level tests are slower and more fragile.
professionCompetencyLevel: practitioner
sources:
  - fowler/test-pyramid
---

## Heuristic

Shape the automated suite like a pyramid: **write lots of small and fast unit tests, write some more coarse-grained tests, and write very few high-level (end-to-end) tests.**

- **Base — unit tests:** many, fast, isolated.
- **Middle — integration/service tests:** fewer; slowed by external dependencies.
- **Top — UI / end-to-end tests:** very few; slowest and most fragile.

## Why This Shape

Higher-level tests are slower and more fragile — integration tests are slowed by external dependencies and end-to-end tests are the slowest of all. Concentrating coverage in fast unit tests gives **fast feedback**: run the fast tests first so breakage surfaces immediately, and reserve the slow, brittle end-to-end tests for the few flows that truly need full-stack validation.

The layer names come from Mike Cohn's *Succeeding with Agile*; treat them as a heuristic, not a rigid taxonomy — the load-bearing rule is the proportion (many fast, few slow).

## How DPF Coworkers Use It

- When adding tests, default to the lowest [[professions/qa-engineer/test-levels]] that catches the fault.
- Order the pipeline so fast tests gate early; this is the mechanism behind [[professions/qa-engineer/risk-based-testing-shift-left]].

## See Also

- [[professions/qa-engineer/test-levels]]
- [[professions/qa-engineer/risk-based-testing-shift-left]]
