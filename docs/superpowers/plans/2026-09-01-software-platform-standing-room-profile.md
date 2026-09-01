---
status: active
---

# Software-platform standing-room profile implementation plan

**Backlog item:** `BI-7E7B93DF`

**Design:** [Software-platform standing-room profile](../specs/2026-09-01-software-platform-standing-room-profile.md)

## Delivery decision

This backlog item is atomic. The derived catalogue and its thirteen executable shape declarations
are one contract: the catalogue cannot safely be activated while any referenced shape is absent,
and a shape without its archetype-derived room is inert. Layer 3 customer-0 bindings are separately
shippable and remain covered by `BI-A967717A`.

## Phase 1 — red demarcation and profile tests

- Add tests that scan storefront-template sources for forge URLs, foreign org slugs, and
  credential-shaped values.
- Add tests asserting every software-platform leaf derives the exact five/13 hierarchy from its
  OVSM, with valid source-stage references and no instance input.
- Add an import-boundary test for `apps/web/lib/work-management`.
- Add failing work-shape tests for the thirteen missing versioned definitions and their human-owned
  boundaries.

Verification: run the targeted storefront-template and web work-shape tests and retain the expected
RED output before implementation.

## Phase 2 — derived Layer 2 catalogue

- Add `packages/storefront-templates/src/standing-rooms.ts` with stable typed profile contracts.
- Derive only from `OperationalValueStream`; validate every referenced OVSM stage and fail closed.
- Export the new projection from the package root.

Verification: targeted storefront-template tests green; full package Vitest.

## Phase 3 — executable shapes

- Add the thirteen versioned definitions to the existing work-shape registry.
- Preserve human-owned governed decisions for consequential advances.
- Give every definition explicit failure and budget stops, numeric budgets, measures, and review
  points; run `validateWorkShape` across the entire registry.

Verification: targeted work-shape and drive-conformance tests green.

## Phase 4 — catalogue documentation and gates

- Document the five/13 catalogue and Layer 2/Layer 3 demarcation.
- Run the storefront-template suite, affected web tests, TypeScript checks, and the web production
  build.
- Run exact-tree pregate and any server-required semantic review before opening a DCO-signed PR.

## Traceability

| Deliverable | Requirement | Contract | Flow | Verification |
| --- | --- | --- | --- | --- |
| Derived hierarchy | Design objective, required profile | `StandingRoomProfile` projection | OVSM → catalogue | exact count and every-leaf tests |
| Demarcation | Design boundary, conformance gates 1–3 | source/import invariant | source scan | demarcation tests |
| Executable shapes | Work-shape safety | existing `WorkShapeDefinition` registry | profile key → shape | registry and human-boundary tests |
| Catalogue docs | Documentation impact | archetype profile catalogue | operator reads reusable scope | docs review |

No phase above is independently shippable within this BI; all rows map to `BI-7E7B93DF`.
