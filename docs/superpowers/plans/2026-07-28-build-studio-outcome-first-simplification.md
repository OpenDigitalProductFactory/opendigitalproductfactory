# Build Studio outcome-first simplification

**Backlog:** BI-IMP-78D1A439

**Epic:** EP-BUILD-STUDIO-UX

**Work Capsule:** WC-BF66038E

**Branch:** `feat/build-studio-simplify`

**Decision evidence:** DI-88CBB559FE19

**Atomic coverage receipt:** cms4s3q220t6l01ruw42p5co6

## Outcome

Make `/build` understandable without delivery-process knowledge. The default experience must answer, in this order:

1. What outcome did I ask for?
2. What is happening now?
3. Does Build Studio need a decision from me?
4. What has happened so far?

FeatureBuild, Work Capsule, review, verification, PR, merge, and release controls remain authoritative. The change is a presentation and information-architecture refactor, not a second workflow or a relaxation of governance.

## Grounding

- The live route currently presents intake, Work Control, fleet counts, epic rollups, raw identifiers, context, work warrant, workflow action, solution summary, phase rail, engineer controls, process graph, evidence drawer, sandbox controls, and a coworker panel in one workspace.
- `BuildCustomerStatusBand` and `BuildStudioWorkflowActionCard` already project the canonical status and next governed action. Reuse these rather than inventing parallel state.
- `DetailsDrawer` already owns canonical documents, progress, review evidence, queue diagnostics, and sandbox details. It is the correct progressive-disclosure destination for technical and governance evidence.
- `/build` remains the canonical Build Studio route under Delivery. `/build/work` remains a technical secondary surface and must not compete with the plain-language intake door.
- The 2026-07-25 governed-playbook experimentation spec and DI-88CBB559FE19 support evidence-gated phase compression: stages may remain in the audit story without becoming operator-driven ceremony.

## UX-fit review

**Decision:** Fits with guardrails.

- **Owning area:** Platform / Delivery.
- **Primary persona:** founder/operator or product owner who can describe an outcome but should not need to understand DPF internals.
- **Secondary persona:** technical delivery owner who needs complete evidence and recovery controls.
- **Navigation layer:** local page hierarchy only; add no global navigation.
- **Source of truth:** FeatureBuild + Work Capsule + customer-status projection + derived workflow action.
- **AI boundary:** describing an outcome does not silently execute production changes. The explicit start/promote action remains visible, and consequence-bearing actions retain their governed confirmation.
- **Empty state:** one primary invitation to describe an outcome, with a compact explanation of what Build Studio will do.
- **Blocked state:** one plain-language blocker and one next action; diagnostics move to technical details.
- **Responsive/theming:** use DPF theme variables; verify desktop and narrow viewports in light and dark themes.

## Atomic scope and 20% refactor allocation

This is one atomic UI change because the new hierarchy, extracted presentation model, component wiring, tests, and user guidance must ship together; partial delivery would leave duplicate or contradictory Build Studio surfaces.

Coverage dependency order: `presentation-contract` → `operator-workspace` → `technical-disclosure` → `guidance-verification`. None is independently shippable; receipt `cms4s3q220t6l01ruw42p5co6` records the atomic decision against BI-IMP-78D1A439.

Approximately 20% of implementation effort is reserved for refactoring:

- extract operator-facing build selection and activity/status derivation from the 85 KB `BuildStudio.tsx`;
- centralize outcome-first labels and view-model rules so tests do not depend on DOM accidents;
- converge duplicated details/engineer disclosures into one technical-details entry point;
- remove obsolete layout helpers only when no caller remains.

The remaining effort implements and verifies the new operator surface.

## Deliverables

### 1. Test-first presentation contract

- Add unit tests for the operator view model: attention-first ordering, status copy, current/complete activity steps, and technical-detail visibility.
- Add component tests proving the default view contains one outcome, one status, one next-action region, one compact activity story, and one technical-details control.
- Preserve tests for workflow actions, destructive confirmations, accessibility names, and evidence drawers.

### 2. Outcome-first workspace

- Make plain-language outcome intake the only primary start door.
- Replace the always-open fleet rail with a compact build switcher grouped by `Needs you`, `In progress`, and `Recent`; keep the selected build visible.
- Make the active build header outcome-led and hide raw IDs, branch, taxonomy, warrants, and graph by default.
- Present canonical customer status first, the governed next action second, and a compact evidence-backed activity story third.
- Keep release decisions and blocked recovery actions prominent when applicable.

### 3. Progressive technical disclosure

- Provide one `Technical details` control.
- Place process graph, work warrant, canonical documents, branch/IDs, queue diagnostics, code intelligence, assurance, review evidence, and sandbox diagnostics behind that disclosure.
- Keep all existing controls reachable; do not fork or duplicate mutation logic.

### 4. Guidance and documentation

- Update the operator guide for the new `/build` mental model.
- Record that Build Studio stages are an audit/evidence story for routine work, while human attention is reserved for consequence, uncertainty, or risk boundaries.
- Record no migration impact: no schema or persisted-data change.

## Verification

1. Run affected Vitest suites for Build Studio presentation, workflow actions, details drawer, and layout.
2. Run the web production build.
3. Lease `local-integration-ci`, run sandbox freshness convergence, deploy the branch through the governed local-integration path, and exercise:
   - active build with no attention needed;
   - build needing a decision;
   - blocked/failed build;
   - empty state;
   - technical-details disclosure;
   - desktop and narrow viewport;
   - light and dark themes.
4. Capture screenshots and accessibility/console evidence.
5. Run `pnpm pr:health` after the ready PR exists.

## Documentation impact

Update `docs/user-guide/` because the operator workflow and terminology change. The architecture substrate and database do not change; this plan is the durable contributor record, so no separate architecture document or migration is required.
