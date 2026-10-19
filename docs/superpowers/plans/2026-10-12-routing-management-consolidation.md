---
status: active
---

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
4. Add one shared context navigation inside AI layout. URL-backed routing view/provider/task/data/window persists across provider detail round trips, reload and Back; validate enum/time input, encode identities, retain unrelated query parameters. Operations-map server page and live shell use the same window context, without a new polling mechanism. Keep existing provider forms unchanged. Put all new copy in packages/i18n/src/messages/en-US/routingManagement.json, register it in the existing catalog and provide it from the AI layout. Use logical layout classes and the existing currency formatter. This is a refinement of the same atomic UI delivery, not a separate feature.
5. Update the existing docs/user-guide/platform/ai-operations.md operator guide, generated docs index and exact-file UX-fit manifest. Execute affected routing/lib and component tests, web typecheck, prose-lint tests and guard, style-drift guard, doc/route-derived checks and pregate:preflight. Run governed pregate against the exact committed tree, verify served-route outcomes and navigation, keyboard modal focus/return/Escape, 390px viewport and both themes. Submit a ready DCO PR, attach it, inspect review findings, queue merge and verify pr:health. Do not call a source-only render runtime proof.

## Four-way traceability

Requirement refs: AC-NAV, AC-GRAPH, AC-OVERLAY, AC-OUTCOMES, AC-HOLDS, AC-PRESERVE, AC-VERIFY.

Contract refs: SAFE-ROUTING-DTO (allowlisted receipts with exact correlation), EXISTING-PROVIDER-AUTHORITY (unchanged provider write ownership), URL-SCOPE (validated context shared across existing routes).

Flow refs: TRAFFIC-INSPECT-PROVIDER-RETURN, TASK-COHORT-EVALUATE, TECHNICAL-REPLAY-DISCLOSURE.

Verification refs: ROUTING-BEHAVIOR-TESTS, WEB-TYPECHECK, GOVERNED-MERGED-GATE, SERVED-UX-FIT.

## Impact contract

The final edit scope also covers localized catalog registration, load-map-data tests, routing-management component/behavior tests and the prose baseline. Preserve unrelated baseline rows; retighten only touched files. Include catalog/pseudo-locale tests and component navigation/empty/evidence checks in ROUTING-BEHAVIOR-TESTS. Earlier immutable coverage cmv6604ae1azh01mr24zzisla binds the original scope; refresh it for this final scope before delivery.

claim_workroom_scope returned resolved gate-context advice. Resolve all testImpact entries (AI layout, operations-map page, AiOperationsMap, OperationsMapLiveShell and load-map-data) before implementation. Guards: pnpm run check:prose-lint:test; pnpm run check:prose-lint; node scripts/check-style-drift.mjs. Derived checks: docs index, route manifest, route audience, route shells, page purpose. Frozen prose text mass: AiOperationsMap 88 and OperationsMapLiveShell 4; every axis may shrink, never grow. UX-fit uses propose-n-pick DI-8B2807DF98EC with two options plus served measurements. PR must contain Design grounding and docs impact. No migrations.

## Risks and rollback

The safe projection must not leak raw evidence or conflate an estimated adapter cost with billed usage. Missing exact correlation stays unknown; never use a fuzzy time match to claim per-request quality. Dense provider catalogs and assignment lists need search plus bounded previews, with all records reachable. Existing technical consumers may rely on legacy focus/mode URLs and replay. Preserve those paths. Provider account work is concurrent: do not edit its forms. Rollback is the PR revert; no schema or stored policy mutation is introduced.

## Backlog coverage

Atomic: one web-package routing workspace refactor, mapped to BI-2BBD9D34. These phases are internal sequencing, not separate releases: a new default without safe receipts or contextual navigation is an incomplete operator workflow; navigation without the new operational view is likewise incomplete. No independent backend service or provider write feature is included. Live immutable plan-coverage receipt will be recorded against this blob before source implementation and referenced by a later evidence note.
**Navigation refinement from served review.**

The served Providers review rejected stacking a custom routing row below the existing AI navigation. Compose Traffic, Evaluation, Providers and All AI workspaces into the canonical PlatformTabNav/SectionNav instead. The mobile selector exposes the same scoped destinations; wider AI workspaces retain their normal navigation. Workspace sibling views are explicitly primary in that local composition, so Simple mode does not hide them in the diagnostic disclosure. Global route audience classifications and route permissions stay authoritative.

Show retained scope once on provider pages and in the existing filters on the routing workspace. Preserve provider detail, reload, Back and the scoped exit through the wider AI workspace. Source and screenshot review are separate from the still-owed native UX coworker/WSID acceptance. Only a reviewed measurement of the final structure may update the Providers accessibility snapshot; keep every numeric limit and all other route entries intact.

## Deployed acceptance correction — October 16

PR #6435 merged as 01ac9bae903275c91300dd8b882d437e7cbb8d3c and is served in DEV release 102 (a914e8314d52449979af7b84599b3908b2a61036). Actual 390px browser measurements found a 474px document: the recent-decisions table extends from x16 to x474. The eight-context observation also retained one provider-catalog navigation timeout; that finding belongs to the existing provider owner and is not a passing result. Original UX-specialist engagements remain pending; neither invitation nor source review substitutes for their critique.

This is bounded acceptance rework of BI-2BBD9D34 in WC-9C02621A, admitted through the normal defect-evidence, backlog status and implementation-claim actions. Preserve the first PR's delivery history and the independent acceptance requirement.

1. Reuse report-kit's existing `DataTable responsive` layout for recent traffic, evaluation and the decision catalog. Keep task/assignment or task/model/recipe as the full-width first identifying cell on narrow screens, followed by labeled evidence cells. Preserve table semantics, exact evidence and all desktop columns. Do not hide overflow or remove information to make the measurement pass.
2. Compose the four existing filters in two columns at 390px, retaining all labels, searchable task/provider controls, 44px inputs and URL behavior. This reduces the first-viewport filter height so actual outcome information becomes visible; no new setting or disclosure is introduced.
3. Verify affected workspace/report-kit consumers and package typechecks, named guards and protected CI. On the containing canonical release, measure traffic, evaluation and the open decision catalog at 390px in light/dark and Simple/Full modes; verify readable identities, labeled values, keyboard inspection and document containment. Keep the current 102 failures as failures until that release is actually served. Native UX review and independent acceptance remain separate.

These corrections implement AC-OVERLAY and AC-VERIFY within the existing URL-SCOPE and SAFE-ROUTING-DTO contracts. They change presentation only: no provider writes, policy authority, routing selection, schemas or evidence joins change. Revert is the correction PR; no stored-data rollback is needed.

## Shared chrome acceptance correction — October 17

Release 104 fixed the routing body's mobile overflow. Actual screenshots still show overlapping Home, installation identity and Help controls at 320px and 390px; stacked navigation and freshness chrome delay the routing task. BI-4F308244 item 18 retains the shared-shell finding; its unrelated demand overflow and other numbered items stay with their existing scope. The coordinator confirmed no competing header editor. This correction remains part of AC-NAV and AC-VERIFY, not a new routing surface.

Platform decision DI-7454E56AB6DC selects `compact-existing-controls` over `wrap-all-chrome`. Keep Home, the non-production installation identity and health visible. On phones, disclose the existing Help, Feedback and Sign out actions in one bounded account/help popover; preserve their original components, authorization and desktop presentation. Preserve long installation labels through wrapping rather than clipping. Put the existing platform/workspace selectors side by side only for the routing context, keeping both accessible labels and all destinations. Compact the existing freshness line while retaining refresh cadence accessibly and displaying refresh errors.

Affected source: Header.tsx and its existing badge/action tests; PlatformTabNav.tsx and its tests; OperationsMapLiveShell.tsx and its tests. No provider settings, grants, schemas or routing decisions change. First preserve a clickable correction in the existing prototype, then implement against these shared primitives. Record exact-file UX-fit evidence, run affected tests and web typechecks plus named guards, protected merged-code verification, and inspect the containing served release at 320px/390px and desktop in both themes. Verify menu keyboard/Escape/focus return, identity visibility, non-overlap, retained context and earlier primary metrics. Revert is the correction PR.

Native UX specialist review remains an explicit dependency. The external craft query DI-4E41A62F0C2F still resolved as software engineering and is not UX approval. The existing specialist engagements and pending file-read permission are preserved; neither this platform choice nor source-local tests fulfill their corpus-cited WSID assessment.

### Recovery 115 visual review follow-up

The independent review accepted the header correction on deployed source `233d556713d4961e7ff4d088d67a90245321493b` and verified all 42 screenshot hashes. It found existing Feedback Submit/Cancel controls only 30px high across twelve observations. Apply the existing platform touch-target class to the form's select and Submit/Cancel/Close controls, preserving submission, retry and cancellation behavior. WWMD decision `DI-5F2AF0D978A5` chooses this bounded correction over replacing the reporting workflow. Verify existing form behavior tests, the exact-tree build gate and actual containing-release target geometry/overlay containment before accepting this follow-up.

### Launcher acceptance correction — October 18

Release 116 still has a percentage-positioned shared launcher over routing metrics and provider content. Decision `DI-0001AFFADC74` selects `header-slot` over `reposition-float`: reserve the existing launcher in the shared header action row, using a React portal so AgentCoworkerShell retains its existing visibility rules, callback and panel lifecycle. Remove floating positioning, dragging and the unsupported availability dot. A missing header falls back to normal document flow. Opening the panel sends no prompt. No authority, provider, inference or storage contract changes.

1. Preserve a clickable header/panel correction with illustrative data in the existing prototype directory.
2. Add a reserved slot in Header and render AgentFAB's existing action there. Keep a 44px target and icon-only phone presentation, existing accessible name and themed focus indicator. Retire obsolete position preferences without rewriting storage. Test actual portal ownership, activation, unmount cleanup and missing-slot behavior; run existing Header and AgentCoworkerShell behavior tests.
3. Update the operator guide and exact-file UX-fit manifest. Run scoped tests/typecheck, required guards and governed exact-tree build before publication. Verify the containing release on Traffic/Evaluation/Providers at phone/tablet/desktop widths, light/dark, scroll positions, keyboard panel open/close/focus, retained context and distinct installation/health controls. A source prototype is not deployment proof.

This is bounded rework of AC-NAV/AC-VERIFY under BI-2BBD9D34 and reconciles only the launcher observation in BI-4F308244. The original native UX/WSID engagements remain an acceptance dependency. Their file-read grant is now authorized, executed and canonically verified; the served framework's original-engagement completion facility remains unresolved. Neither the platform choice nor peer/source checks substitute for native acceptance.

The separate floating global AI launcher can obscure metric text at 390px and provider content at 1280px. This has been recorded in the existing shared-shell item `BI-4F308244`, activity `cmvdjqxym0a2j01pdy4f2mxfh`; introduction is not attributed to the routing PR. Native UX coworker/WSID acceptance remains outstanding under the existing engagements and framework repair; external peer review does not substitute for that receipt.

The Feedback follow-up changes target size only; its controls, labels, destinations and submission behavior do not change. The launcher relocation above updates the operator guide separately.
