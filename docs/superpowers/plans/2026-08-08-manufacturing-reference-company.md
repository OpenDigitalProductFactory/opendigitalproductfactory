# Manufacturing reference company implementation plan

- **Date:** 2026-08-08
- **Status:** In progress
- **Epic:** `EP-VERTICAL-MANUFACTURING`
- **Umbrella:** `BI-9B4CE669`
- **Spec:** `docs/superpowers/specs/2026-08-08-manufacturing-reference-company-design.md`
- **Capsule:** `WC-03A45111`

## Grounding

This plan extends the deterministic archetype demo-factory pattern and the existing spatial, edge, inventory, product, work, and governed-action substrates. It does not add a second equipment identity model, reuse the software `BomDocument` as a manufacturing BOM, or enable equipment control.

## Deliverables

### R1 — typed fictional reference and validator (`BI-9B4CE669`)

- Add `manufacturing-reference.ts` with company/site/product/process/topology/equipment/signal/metric/scenario contracts.
- Add the deterministic FluxForge fixture and safety/freshness validator.
- Export it from the package.
- Test internal references, full topology, read-only control boundary, metric provenance, and disruption coverage.

### R2 — industrial-OEM archetype consumes the reference (`BI-7697CAD3`)

- Add the manufacturing category and `industrial-oem` leaf through all four provisioning dimensions.
- Derive its product flavor, occupations, coworkers, tools, and readiness evidence from the reference rather than duplicating facts.
- Keep this as a separate PR because it changes taxonomy, registries, seeds, and completeness gates.

### R3 — reference drives factory Operations (`BI-E118D536`)

- Add `FACTORY`/`LINE` visual grammar and a mapper from reference/live read models.
- Prove the single-bottleneck, stale/offline, list-alternative, and latency contracts against the golden scenarios.

### R4 — reference drives industrial edge simulation (`BI-B9BC5B0B`)

- Use the declared signals as simulator fixtures for OPC UA/Sparkplug normalization.
- Prove identity, timestamps, quality/freshness, trust/site scope, birth/death handling, and read-only rejection.

### R5 — reference drives Performance (`BI-BD94A40B`)

- Calculate each measure only from declared inputs and carry formula/grain/timezone/freshness/provenance.
- Exercise normal, constrained, quality-loss, maintenance, and stale-edge periods.

### R6 — manufacturing domain records (`BI-D5AEBEE8`, `BI-17FC03D1`, `BI-9CE1B61A`, `BI-64B4581A`)

- Implement product definition, execution/genealogy, quality, and equipment-maintenance bounded contexts in that dependency order.
- Map reference IDs to persisted records without changing the fixture into production seed data.

### R7 — future control safety case (`BI-049F2113`)

- Design and verify the authorization/reconciliation boundary separately.
- No control feature flag, write adapter, or command route lands with R1–R6.

## Verification for this PR

1. `manufacturing-reference.test.ts` passes.
2. `@dpf/storefront-templates` typecheck passes.
3. Package test suite passes with no demo-factory regression.
4. Documentation checks and plan/backlog coverage pass.
5. Independent architecture review confirms identity, observation, execution, and control boundaries.

## Refactoring allocation

At least 20% of this slice is reserved for reusable structure rather than fixture bulk: shared typed contracts, one validator, stable IDs, package export, and tests that downstream work can reuse. Application-specific rendering and transport dependencies are kept out of the package.

