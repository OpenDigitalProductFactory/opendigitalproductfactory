# Build Studio owner-state reconciliation

| Field | Value |
| --- | --- |
| Date | 2026-08-12 |
| Umbrella | `BI-A40C8A70` |
| Deliverables | `BI-78499309`, `BI-62075FF9` |
| Branch | `fix/build-studio-owner-state` |
| Work Capsule | `WC-67DC0E31` |
| Decision | `DI-A170A7EBA1D7` — converge on one canonical owner-state projection |

## Outcome

Build Studio's first viewport will answer one question: **what is happening with my change now?** It will distinguish active work, provider capacity, an owner decision, a product block, inconclusive verification, failure, and completion without exposing engine, sandbox, task-count, model, or code-intelligence detail by default.

This is one concern-focused change because both defects are produced by the same split ownership: runtime signals are interpreted independently by the progress read model, owner copy, workflow actions, and page chrome. Shipping only the long-running signal or only the chrome cleanup would leave the other projections free to contradict it.

## Live backlog coverage

The plan keeps the two independently testable outcomes mapped to their existing live backlog items:

| Deliverable | Backlog item | Depends on |
| --- | --- | --- |
| Durable long-running and return-to-page state | `BI-78499309` | — |
| Owner-safe status strip and progressive disclosure | `BI-62075FF9` | `BI-78499309` |

Governed coverage receipt: `cmsq3c8qo02aw01t6y2lj28v4` (`decomposed`), recorded against `BI-A40C8A70` before implementation.

## Design grounding

Reviewed specifications and standards:

- `docs/superpowers/specs/2026-06-12-build-studio-owner-improvement-experience-design.md`
- `docs/superpowers/plans/2026-07-31-build-studio-owner-change-convergence.md`
- `docs/platform-usability-standards.md`
- `docs/superpowers/plans/2026-05-26-portal-ux-simplification-spine.md`
- `apps/web/components/ui/report-kit/README.md`

Reviewed code substrate:

- `apps/web/lib/build/progress-visibility.ts` owns persisted build-signal reconciliation.
- `apps/web/lib/build/customer-status-projection.ts` owns business-facing now/next copy.
- `apps/web/components/build/BuildOperatorOverview.tsx` renders the owner summary.
- `apps/web/components/build/BuildStudio.tsx` owns refresh behavior and disclosure boundaries.
- `apps/web/components/build/build-studio-workflow-actions.ts` derives the owner's next action.

Source of truth: persisted task results, verification runs, dispatch history, phase state, inference failure, and owner-decision records. Generic activity is supporting liveness evidence; it must not erase a persisted provider failure or fabricate progress.

Decision: refactor the existing customer-status projection into the single owner-state seam and make every owner-facing consumer use it. Do not add a second status machine, table, route, or provider-specific UI.

## UX feature-fit gate

| Gate | Answer |
| --- | --- |
| Owning area | Platform |
| Route family | Canonical `/build`; no new route or tab |
| Primary persona | Business owner/contributor checking whether a change is moving or needs them |
| Navigation layer | Local page state only; global and section navigation do not change |
| Component convergence | Reuse `BuildOperatorOverview`, `BuildStudioWorkflowActionCard`, `StatusBadge`, `Notice`, and existing disclosure; retire duplicated status interpretations |
| Source truth | Existing build progress read model plus owner status projection |
| Empty/failure state | Honest not-started, waiting-capacity, owner-decision, blocked, inconclusive, failed, and complete states |
| AI action boundary | No new automatic AI action from a click; existing confirmed workflow actions remain unchanged |
| Verification evidence | Focused projection/component tests, production build, owner-mode `/build` journey, capacity failure, leave/return reconciliation, light/dark and narrow/desktop screenshots |

## Implementation sequence

1. **Red — signal truth.** Add regression tests proving generic activity cannot clear a newer provider failure and that meaningful persisted progress can supersede it.
2. **Green — canonical owner state.** Extend the existing projection with a closed owner-state union, plain stage/summary/expectation copy, persisted timing anchors, and an explicit owner-action flag.
3. **Red/green — consumer convergence.** Make the overview, selected queue row, and workflow action tests prove that owner copy and actions derive from the same state, including capacity and long-running work.
4. **Refactor budget.** Remove duplicated transient-failure classification, refresh the capsule-backed owner projection with the durable poll, and move unconditional progress reconciliation into one hook path. Remove technical footer copy from the default owner viewport; keep diagnostics under the existing engineer disclosure.
5. **Verify.** Run all graph-linked or colocated tests, prose/style guards, the production build, governed merged-code CI, and the live owner journey. Record the UX-fit measurement without co-claiming another active capsule's broad `docs/ux-fit` scope.

## Documentation and migration impact

- Documentation: this execution plan and the required UX-fit record are the affected contributor surfaces. No user guide changes are required because the route and workflow remain the same; the UI becomes the implementation of the already-approved owner-change design.
- Database migration: none. This is a projection and presentation repair over existing persisted records.
- Deployment contracts: unchanged.

## Verification outcome

- Nine focused Build Studio test files pass: 157 tests covering the canonical owner projection, durable progress reads, queue/overview/workflow convergence, and disclosure boundaries.
- The production web build passes. Existing Edge-runtime compatibility diagnostics remain warnings and do not block the build.
- The style-drift and prose-lint guards pass with no new hardcoded colors, off-scale values, or owner-copy issues.
- The governed shared preview confirms one stable owner state for stopped and completed work, persistence after leaving and returning, collapsed technical detail by default, no internal build/capsule identifiers in owner chrome, and no horizontal overflow at a 390 px viewport.
