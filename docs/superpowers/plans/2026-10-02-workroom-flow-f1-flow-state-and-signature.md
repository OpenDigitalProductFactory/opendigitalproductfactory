---
status: active
---

# Workroom flow F1 — flow-state classification and shape signature

- **Backlog item:** BI-2A3C63FA
- **Epic:** EP-B70E718D
- **Design:** [Workroom flow map and measurement](../specs/2026-10-02-workroom-flow-map-and-measurement-design.md), §4.1, §4.2, §5.1 and §5.3
- **Depends on:** BI-3ACFD254, which types the drive's reason vocabulary from what it emits. That typing is what makes this classifier total.

## Design grounding

- **Source of truth for drive outcomes:** `DRIVE_REASONS_BY_ACTION` in `lib/work-management/drive-conclusion.ts`. Since BI-3ACFD254, `DrivePlan.reason` is typed from it. F1 adds no second vocabulary; its table is a typed function of that one.
- **Source of truth for shapes:** `WorkShapeDefinition` (`work-shapes.ts`) plus `WORK_SHAPE_PRIOR_VERSIONS`. The signature reads them and never declares lanes. Lanes come from `accountablePrincipalRef`.
- **Decision:** extend the existing modules. Nothing new is created beyond the two pure modules the spec names. There is no schema, route or UI change.

## Deliverable (atomic)

| File | What |
|---|---|
| `lib/work-management/workroom-flow-state.ts` | `WORKROOM_FLOW_STATES`; a table typed over every drive action and reason, so a new reason is a compile error until it is classified; `classifyDriveSegment` (null for an unknown pair, cause carried for `blocked`); `countsTowardFlowTime` |
| `lib/work-management/shape-signature.ts` | `shapeLane`, `touchesOutside`, `shapeSignature` |
| Tests | Parity over `everyDriveOutcome()`, every pair seen in the live 30-day drive log, the §5.3 standing-room rule, lane derivation, and a reviewed snapshot of all 51 definitions (47 current + 4 frozen) |

This is one PR. Two pure modules that have no consumer until F2 and F3 are not split further.

## Recorded limitations

- **Outside touchpoints are inferred from evidence kinds.** A stage is marked as an outside touchpoint when its evidence includes `conversation-turn` or `org-business-answer`. The stricter rule from spec §4.2, the GPP `outward` tool class, waits until stage tool classes resolve per stage. Consequently `inquiry-response-watch` stage `send` is not marked yet.
- **The gate shows who decides, not the authority.** No shape declares an authority (WWMD/WWWD/WSID), and `decisionScope` is a decision name, so the signature does not guess one.

## Verification

- `vitest run` on the two new test files, `drive-conclusion.test.ts` and `drive-resolution.test.ts`.
- `pnpm --filter web typecheck`.
- No UX gate applies, because no surface renders this yet. F3 is the first consumer.
