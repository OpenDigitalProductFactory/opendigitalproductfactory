---
status: active
---

# Workroom shape rebind — implementation plan

- **Spec:** [2026-10-01-workroom-shape-rebind-design.md](../specs/2026-10-01-workroom-shape-rebind-design.md)
- **Backlog:** BI-CB5C0DCE (phases 1–4) · BI-EBF0F6EE (phase 5) · Epic EP-B932453F

Each phase is one PR scoped to one clean revert. Phases 1–4 land in order;
phase 5 is the held `feat/standing-room-read-tools` branch, rebased onto them.

## Phase 1 — Prior versions stay resolvable (OBJ-PIN)

| Deliverable | Files | Covers | Backlog |
|---|---|---|---|
| `WORK_SHAPE_PRIOR_VERSIONS` and `getWorkShapeVersion(key, version)` | `apps/web/lib/work-management/work-shapes.ts`, new `work-shape-prior-versions.ts` | AC-PIN-1 | BI-CB5C0DCE |
| `resolveWorkShapeClaim` resolves current or prior; `normalizePersistedScope` keeps refusing prior | `workroom-shape-claim.ts`, `apps/web/lib/work-capsules/scope-input.ts` | AC-PIN-1, AC-PIN-2 | BI-CB5C0DCE |
| Prior-version parity test (same key as a current shape, lower semver, `validateWorkShape` clean) | `work-shape-prior-versions.test.ts` | AC-PIN-1 | BI-CB5C0DCE |
| Cycle behaviour pinned: unchanged stages do not re-run after a version change | `room-cycle-store.test.ts` or a new focused test | AC-GATE-3 | BI-CB5C0DCE |

Gate: unit tests for the touched files, both typecheck programs.

## Phase 2 — Binding diff (OBJ-DIFF)

| Deliverable | Files | Covers | Backlog |
|---|---|---|---|
| `diffWorkShapeBinding(from, to)`, a pure function | new `apps/web/lib/work-management/work-shape-binding-diff.ts` | AC-DIFF-1 | BI-CB5C0DCE |
| Table test over every row of spec §4.2 | `work-shape-binding-diff.test.ts` | AC-DIFF-1 | BI-CB5C0DCE |

## Phase 3 — Governed action and MCP tool (OBJ-GATE)

| Deliverable | Files | Covers | Backlog |
|---|---|---|---|
| `rebindWorkroomShape` server function: authority, target, in-flight guard, diff, decision evidence, compare-and-set write, activity | new `apps/web/lib/work-management/workroom-shape-rebind.server.ts` | AC-GATE-1, AC-GATE-2 | BI-CB5C0DCE |
| Refusal-code tests, plus a conflict test | `workroom-shape-rebind.server.test.ts` | AC-GATE-1, AC-GATE-2 | BI-CB5C0DCE |
| `rebind_workroom_shape` MCP tool (write scope, `dryRun`, hidden in advise mode), grant and scope-map entries, tool-surface baseline reason | MCP workroom pack, `agent_registry.json` grant, `oauth-scope-map.ts` | AC-OWNER-3 | BI-CB5C0DCE |

## Phase 4 — Owner notice and control (OBJ-OWNER)

| Deliverable | Files | Covers | Backlog |
|---|---|---|---|
| Drive plans one `awaiting_rebind` attention per cycle for a room on a prior or unknown version | `apps/web/lib/work-management/drive-resolution.ts`, `workroom-drive.ts` | AC-OWNER-1 | BI-CB5C0DCE |
| Room-page notice, diff disclosure and Rebind control; copy in the workrooms i18n namespace; UX-fit manifest | `apps/web/components/workspace/workroom/WorkroomShapeRebind.tsx`, a server action, `packages/i18n` | AC-OWNER-2 | BI-CB5C0DCE |
| UX verification on the running app via the canonical runtime | — | AC-OWNER-2 | BI-CB5C0DCE |

## Phase 5 — First widening (live)

| Deliverable | Files | Covers | Backlog |
|---|---|---|---|
| Bump pull-request-flow, contributor-intake, vendor-renewal and payables shapes to 1.1.0; move each 1.0.0 into prior versions | `feat/standing-room-read-tools` | AC-LIVE-1 | BI-EBF0F6EE |
| Deploy via `/ops/self-upgrade`; the owner rebinds the four rooms from the portal; confirm the next cycle pins the new tools | live install | AC-LIVE-1 | BI-EBF0F6EE |

## Docs impact

- `docs/architecture/work-shapes-and-the-decision-gate.md`: add the versioning and rebind rule (phase 3).
- GPP Annex A: cite the rebind as the §2.1.1 reference implementation. This goes to the GPP thread (BI-2C3B3AC9) once phase 4 merges.
