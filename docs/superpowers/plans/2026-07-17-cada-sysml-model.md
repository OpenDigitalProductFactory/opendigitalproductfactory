# CADA SysML Model Seed

## Backlog Item

BI-AA3A4144 — Materialize the PKG-CADA SysML model into the EA graph.

## Scope

Seed the CADA requirements, sovereignty constraint, substrate allocations, and verification cases from `docs/architecture/2026-06-19-cada-cloud-sovereignty-architecture-note.md` into the existing EA graph substrate. This uses the existing `applySysmlModel` seed path and adds no EA tables.

## Plan

1. Add a CADA SysML seed test that mirrors the existing mocked-client seed tests.
2. Add `seed-ea-sysml-cada.ts` with stable `sysml:cada:*` keys for requirements, parts, constraint, and verification cases.
3. Wire the seed into `packages/db/src/seed.ts` after SysML notation/viewpoint/view seeding.
4. Verify the CADA seed and neighboring SysML seed tests plus `@dpf/db` typecheck.
