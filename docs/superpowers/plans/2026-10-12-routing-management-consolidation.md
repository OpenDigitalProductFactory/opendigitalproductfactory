# Consolidate routing management — BI-2BBD9D34

For agentic workers: execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use the governed local merged-code build and exact-tree completion gate before a success claim, and DCO sign-off for handoff.

## Objective and boundaries

Implement the operator-reviewed routing explorer as a refactor of the existing Operations Map. Workroom WC-9C02621A; branch clean/routing-management-consolidation; base 4f5def81786cd51816eb880740049a8a629b1faa. Founder-funded 80% refactoring, 20% necessary additions. Research and decision: ../specs/2026-10-12-routing-management-research.md, DI-8B2807DF98EC.

### Acceptance (verbatim from the live item)

- AC-NAV: shared provider/task/time scope is URL-backed, survives reload/browser Back and passes between operational routing and provider configuration without a parallel override editor.
- AC-GRAPH: the default view groups assignments and provider/model identities, highlights selected routing context and discloses broad topology/A2A/technical controls progressively; empty/missing evidence is explicit.
- AC-OVERLAY: decision, exclusion, ordered attempts, sensitivity/account/channel, costs/tokens and source evidence use a keyboard-accessible context-preserving overlay.
- AC-OUTCOMES: task/model outcomes show execution versus evaluated quality separately with denominators and cost/evidence coverage; unavailable evaluation/feedback remains honest and existing tuning proposal authority is preserved.
- AC-HOLDS: policy/clearance, token/context limits, quota/cooldown, payment, disabled configuration, operator pause and missing capacity evidence are not collapsed into one failure status.
- AC-PRESERVE: existing provider/assignment action ownership, permission behavior, technical deep links/replay and canonical evidence remain available.
- AC-VERIFY: affected unit tests and typechecks, governed merged-code build, served-route UX-budget/accessibility/theme/narrow/keyboard checks and updated user documentation pass before PR delivery.

## Internal sequencing (one atomic deliverable)

1. Preserve the prototype and research. Record immutable plan coverage before source edits. Resolve related-test advice for every claimed source file. Existing advice for AiOperationsMap and AI layout has no linked tests, so include colocated tests plus new behavioral checks and served verification.
2. Extend the existing request-time loader with safe routing-management receipts and ModelProfile catalog. Compose existing activity outcomes; retain separate evaluator and operator feedback coverage. Exact-trace attempt correlation, sorted attempt sequence, explicit unknown costs and account/channel evidence, no raw trace exposure. Files: load-map-data.ts and lib/ai-operations-map/routing-management*. Verify privacy allowlist, trace collisions/missing trace, cost coverage, group cohort denominators and distinct holds.
3. Refactor default map into grouped assignment → routing → provider/model display with filtered recent decisions, bounded summaries, searchable drilldown and a modal inspector. Use report-kit and themed accessible overlay patterns. Put the existing architecture/topology/A2A/workbench behind disclosure, opening it for legacy mode/focus deep links. Files: AiOperationsMap.tsx and RoutingManagement*. Preserve governed tuning actions.
4. Add one shared context navigation inside AI layout. URL-backed routing view/provider/task/data/window persists across provider detail round trips, reload and Back; validate enum/time input, encode identities, retain unrelated query parameters. Operations-map server page and live shell use the same window context, without a new polling mechanism. Keep existing provider forms unchanged.
5. Update operator guide, generated docs index and exact-file UX-fit manifest. Execute affected routing/lib and component tests, web typecheck, prose-lint tests and guard, style-drift guard, doc/route-derived checks and pregate:preflight. Run governed pregate against the exact committed tree, verify served-route outcomes and navigation, keyboard modal focus/return/Escape, 390px viewport and both themes. Submit a ready DCO PR, attach it, inspect review findings, queue merge and verify pr:health. Do not call a source-only render runtime proof.

## Four-way traceability

Requirement refs: AC-NAV, AC-GRAPH, AC-OVERLAY, AC-OUTCOMES, AC-HOLDS, AC-PRESERVE, AC-VERIFY.

Contract refs: SAFE-ROUTING-DTO (allowlisted receipts with exact correlation), EXISTING-PROVIDER-AUTHORITY (unchanged provider write ownership), URL-SCOPE (validated context shared across existing routes).

Flow refs: TRAFFIC-INSPECT-PROVIDER-RETURN, TASK-COHORT-EVALUATE, TECHNICAL-REPLAY-DISCLOSURE.

Verification refs: ROUTING-BEHAVIOR-TESTS, WEB-TYPECHECK, GOVERNED-MERGED-GATE, SERVED-UX-FIT.

## Impact contract

claim_workroom_scope returned resolved gate-context advice. Resolve all testImpact entries (AI layout, operations-map page, AiOperationsMap, OperationsMapLiveShell and load-map-data) before implementation. Guards: pnpm run check:prose-lint:test; pnpm run check:prose-lint; node scripts/check-style-drift.mjs. Derived checks: docs index, route manifest, route audience, route shells, page purpose. Frozen prose text mass: AiOperationsMap 88 and OperationsMapLiveShell 4; every axis may shrink, never grow. UX-fit uses propose-n-pick DI-8B2807DF98EC with two options plus served measurements. PR must contain Design grounding and docs impact. No migrations.

## Risks and rollback

The safe projection must not leak raw evidence or conflate an estimated adapter cost with billed usage. Missing exact correlation stays unknown; never use a fuzzy time match to claim per-request quality. Dense provider catalogs and assignment lists need search plus bounded previews, with all records reachable. Existing technical consumers may rely on legacy focus/mode URLs and replay. Preserve those paths. Provider account work is concurrent: do not edit its forms. Rollback is the PR revert; no schema or stored policy mutation is introduced.

## Backlog coverage

Atomic: one web-package routing workspace refactor, mapped to BI-2BBD9D34. These phases are internal sequencing, not separate releases: a new default without safe receipts or contextual navigation is an incomplete operator workflow; navigation without the new operational view is likewise incomplete. No independent backend service or provider write feature is included. Live immutable plan-coverage receipt will be recorded against this blob before source implementation and referenced by a later evidence note.
