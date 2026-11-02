# Demo booking capacity repair

**Status:** design for BI-0F5FCA55; source implementation and served acceptance pending.

Extends the pure planner in the [Demo Factory design](2026-07-15-archetype-demo-factory-design.md), not its runtime, authorization or teardown architecture. DOC-82684072 Results acceptance encountered a real PostgreSQL exclusion violation. At source 36b46866870694dab1763e691862da38dc577e76 the shared planner retains the same scheduling algorithm; offline inspection found overlaps in 44 of 107 current archetypes, including six pairs in software-platform. These are source diagnostics, not successful database or portal tests.

**OBJ-1:** Produce deterministic demo booking intervals that satisfy existing assigned-provider capacity while retaining demand, status, identity and queue age.

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-1 | OBJ-1 | Assigned positive-duration bookings never overlap for one provider; adjacent half-open intervals are allowed. |
| AC-2 | OBJ-1 | Keep existing refs, assignment, duration, status, customer, item and queue age; preserve each nonconflicting preferred start. Completed bookings remain wholly in the past and pending/confirmed bookings stay upcoming. |
| AC-3 | OBJ-1 | Protect software-platform and all current archetypes with deterministic capacity regressions, including multiple durations and same-provider boundary cases. |
| AC-4 | OBJ-1 | Prove native writes, repeat loading and atomic rejection under the unchanged PostgreSQL exclusion constraint in an admitted nonproduction target, then resume the existing guarded Results acceptance protocol. |

Use a small planner-local interval allocator. Group assigned positive-duration bookings by provider and process preferred starts chronologically with stable input-order ties. For upcoming work, move only a conflict forward to the preceding reserved end. For completed work, process latest starts first and move conflicts backward so their ends do not pass zero. This preserves nonconflicting starts and distinct past/future lanes. Unassigned bookings retain their original offsets. No provider removal, canceled status, quarantine, constraint change, migration or production data manipulation.

The PostgreSQL guard remains authoritative. This planner fixes an empty native demo load; reconciling arbitrarily edited existing demo calendars is outside this repair and must fail safely. A repeat load with a fixed clock must retain identities and counts. Use existing native fixture guards and real writer; no new scenario runner or alternate ledger producer. BI-D53D4CB5 retains broader scenario-adapter convergence.

Rollback is a normal source revert; no schema reversal or financial mutation is needed. Shared planner changes affect all archetypes, so validate the complete current catalog rather than freezing an obsolete count. The Finance reliability repair remains owned by BI-D0D2FF0D.
