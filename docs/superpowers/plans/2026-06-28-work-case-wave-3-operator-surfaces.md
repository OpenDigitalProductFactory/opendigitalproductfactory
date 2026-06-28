# Work Case Wave 3: Operator Surfaces

Status: in progress
Backlog: BI-WC-WAVE3
Epic: EP-2984B02B
Work Capsule: WC-04030CA0

## Objective

Implement the first operator-facing Work Case surfaces now that the projection, governed write path, receipts, accountability, staged transitions, and stop-condition foundations are in place.

## Scope

- Refactor `/workspace/my-queue` from a raw WorkItem queue into a Workspace Work Case attention lens.
- Add a server-side Workspace Work Case loader that projects existing `WorkItem` records through the Work Case read model without adding a parallel table.
- Add `/workspace/cases/[caseKey]` as an evidence-first Work Case detail drill-down.
- Register the Work Case lens and detail route in the canonical navigation model as Workspace section/detail destinations.
- Use `report-kit`, `lucide-react`, and `--dpf-*` theme tokens; no hardcoded status color classes.
- Keep the global AI Coworker launcher from overlapping dense mobile Work Case surfaces during verification.
- Update EA/SysML grounding and the Work Case architecture spec.

## Out Of Scope

- New persisted Work Case table.
- External/federated AgentCard interface.
- Autonomy graduation and trust-dial wiring.
- Domain-specific workflow adoption and customer portal case views.
- Mutating source records from the UI; this slice is read-model and operator navigation only.

## Implementation Tasks

1. Add failing tests for the Workspace case loader, attention lens, case detail view, and navigation registration.
2. Implement `workspace-case-loader.ts` to derive list/detail view models from `WorkItem`, `WorkItemMessage`, and existing evidence JSON.
3. Implement `WorkCaseAttentionLens` with attention-first ordering, stable detail links, summary stats, and theme-token styling.
4. Implement `WorkCaseDetailView` with evidence before source references and Workspace-local navigation.
5. Wire `/workspace/my-queue` and `/workspace/cases/[caseKey]`.
6. Suppress the floating AI Coworker launcher below the `sm` breakpoint after mobile UX verification showed it covering Work Case cards.
7. Update `architecture-grounding.ts`, tests, and this spec.

## UX Fit Review

Decision: fits-with-guardrails.
UX-Fit-Decision: progressive-disclosure (principle_decide, margin 4.204)

- Owning area: Workspace.
- Route family: `/workspace/my-queue` as the attention lens and `/workspace/cases/[caseKey]` as the detail drill-down.
- Primary persona: founder/operator deciding what work needs attention next without learning WorkItem internals.
- Navigation layer touched: Workspace section/detail navigation only; no new global nav area.
- Reuse/convergence: `report-kit` `StatCard` and `StatusBadge`, lucide icons, existing Workspace shell patterns, and DPF theme tokens.
- Source truth: existing `WorkItem`, `WorkItemMessage`, Work Case read-model projection, and evidence JSON; no parallel Work Case table.
- Empty/failure behavior: queue empty state points back to normal Workspace work; missing cases render a Workspace-local not-found state.
- AI boundary: the queue and detail clicks navigate only; they do not send prompts or start coworker work. The global AI Coworker FAB is hidden below `sm` after mobile verification showed overlap with dense cards.
- Evidence before merge: route/component tests, route-manifest freshness, theme-token review, production build, and desktop/mobile browser verification for `/workspace/my-queue` plus `/workspace/cases/[caseKey]`.
- Captured in: this plan and PR #2491 body.

## Verification Plan

- `pnpm --filter web exec vitest run lib/work-management/workspace-case-loader.test.ts components/workspace/WorkCaseAttentionLens.test.tsx components/workspace/WorkCaseDetailView.test.tsx lib/navigation/portal-navigation-model.test.ts lib/work-management/architecture-grounding.test.ts`
- Existing focused Work Case suite for source registry, status projection, read model, policy, receipts, accountability, staged transitions, stop conditions, and governed execution.
- `pnpm --filter web typecheck`
- `pnpm --filter web build`
- UX verification for `/workspace/my-queue` and `/workspace/cases/<caseKey>` at desktop and mobile widths against a running contributor preview or canonical runtime, including a theme scan for hardcoded status colors and a visual check that the global coworker launcher does not overlap mobile case content.

## Rollback

This slice is additive except for replacing the old My Queue rendering. Rollback restores the prior `/workspace/my-queue/page.tsx`, removes the new loader/components/detail route/navigation records, and reverts Wave 3 spec/EA grounding updates.
