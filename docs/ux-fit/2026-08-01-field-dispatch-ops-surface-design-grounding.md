# Field Dispatch Operational Surface Design Grounding

## Design grounding

- Existing specs/plans reviewed:
  - docs/superpowers/specs/2026-06-13-field-dispatch-capability-design.md
  - docs/superpowers/plans/2026-06-13-value-stream-p1-measure-implementation-plan.md
  - docs/superpowers/specs/2026-06-13-multi-archetype-composition-design.md
- Current code substrate reviewed:
  - apps/web/lib/storefront/dispatch-board-data.ts
  - apps/web/lib/queue/bridges/booking-bridge.ts
  - apps/web/app/(shell)/storefront/dispatch/page.tsx
  - packages/validators/src/field-dispatch.ts
- Source of truth:
  - Field-service WorkItem evidence and the canonical field-dispatch validators own lifecycle, assignment, route, parts, and invoice signals.
- Decision:
  - Use a scan-first operations board with KPI counts, schedule, schematic route, work lanes, support checks, lucide icons, and report-kit status badges. Keep copy compact so non-technical operators can read the state through position, iconography, and canonical color intent.
