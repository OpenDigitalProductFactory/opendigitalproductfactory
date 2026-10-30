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

Tablet placement study: the explicit DOM prototype on served116 compressed the installation badge to49px and made the header94px high at1024px with the full launcher label. Deferring that label to1280px restored a132px badge and77px header with no measured overlap at all six study widths. These are prototype observations, not delivered-source verification. Keep the existing accessible name and44px icon target on narrower screens, then repeat the measurements on the containing release.

The phone wordmark footprint study found another composition risk: at320px, the permitted120px logo left an18px badge and225px header. Cap all existing light/dark/single logo variants at80px below the small-tablet breakpoint, preserving object-contain and the220px wider-screen cap. The80px footprint study restored a58px badge and73px header. This is a bounded part of the same header placement correction, with no branding configuration write. Verify the actual containing release and retain the fixture's provenance separately from real configured-logo coverage.

### Reviewed accessibility-tree refresh

PR6490 run39193708080 measured215 routes and blocked196 solely for the deliberate shared-header accessibility-tree change. Numeric regressions and absolute budget failures were both zero. Follow the sweep's documented artifact recovery on the unchanged published source: generate a fresh measured baseline, review the196 affected snapshots against the expected header action, and splice only those measured ariaSnapshot values. Preserve every numeric ceiling, all other route values, all unaffected routes and existing coverage. Do not freeze the11 unrelated net-new routes or treat generation as acceptance. Independent source review and the protected enforcing sweep remain required. Use the existing published-correction procedure for this metadata-only follow-up; its full integration status stays explicitly delegated, with the original exact source pass retained historically.

## Bounded routing usability corrections — October 25

This is presentation rework of the same BI-2BBD9D34, not another routing feature or backlog item. Workroom WC-966F4217 uses branch `fix/routing-management-polish`, worktree `D:/DPF-worktrees/routing-management-polish`, and base `966b7164fa25544c91980424fb461735b44a23f9`. Preserve WC-9C02621A and its original review head `d2364c71410d071bbe63ef48eedeebdc6570f8f6` unchanged. The existing research, operator-reviewed prototype and DI-8B2807DF98EC remain the grounding for progressive disclosure and explicit missing evidence.

Author choice `DI-BE302413E8F2` records `reuse-existing-disclosure-and-empty-state` through the supported `record_decision_outcome` action with `resolvedBy=agent`, under the explicit user direction for this bounded work. Its original automatic comparison was low confidence and opposed all options: five cost-only features omitted the positive features needed to compare the alternatives. Retain that input limitation. This author choice is neither a gate PASS nor human design ratification or native UX approval.

Observed source defects remain present at the base: the decision inspector puts an opaque endpoint identifier in the default Why this path paragraph, despite an existing source-evidence disclosure; the operational provider catalog maps its filtered array directly to an empty list when search has no matches. These are author engineering findings. The separate provider-account catalog and shared Header role-label work stay outside this correction.

### Ordered implementation and verification

1. Record fresh immutable plan coverage for the seven declared paths before implementation. This is one atomic correction to the existing inspect-and-return flow: defer technical evidence without losing access, and make its scoped provider search explain zero results. Keep the original seven acceptance criteria above verbatim. Requirement refs remain AC-NAV, AC-GRAPH, AC-OVERLAY, AC-OUTCOMES, AC-HOLDS, AC-PRESERVE and AC-VERIFY; contract refs remain URL-SCOPE, SAFE-ROUTING-DTO and EXISTING-PROVIDER-AUTHORITY; flow ref TRAFFIC-INSPECT-PROVIDER-RETURN and verification refs ROUTING-BEHAVIOR-TESTS, WEB-TYPECHECK, GOVERNED-MERGED-GATE and SERVED-UX-FIT apply. The two source corrections and their verification are internal sequencing under BI-2BBD9D34, not independently released features. Refresh the coverage receipt after the final plan/scope binding; do not reuse a historical receipt as current coverage.
2. In `apps/web/components/platform/RoutingManagementInspector.tsx`, move the existing localized Selected endpoint label and exact identifier into the existing Source evidence identifiers disclosure. Retain the provider/model header, canonical source identifiers, and the exact, missing and ambiguous correlation messages. Do not invent a routing reason from a technical identifier or hide an evidence limitation. No receipt shape or evidence join changes.
3. In `apps/web/components/platform/RoutingManagementWorkspace.tsx`, derive the provider array once from the existing global provider scope and search predicate. Reuse that array for cards, the existing FilterBar result count and an existing report-kit EmptyState when no provider matches. Put concise no-match copy in `packages/i18n/src/messages/en-US/routingManagement.json`; use the existing search/clear behavior. Clearing search restores only providers allowed by the global provider filter. Do not reset that filter, widen task/data/time context or introduce a provider editor.
4. Add behavioral regressions to `RoutingManagementWorkspace.test.tsx` before implementation. For inspection, assert the opaque endpoint is absent from the default Why section but retained under the initially closed source disclosure, then reachable on disclosure; preserve provider/model identification and all three correlation messages. For the catalog, assert the filtered result count, explicit zero-match feedback, removal of that feedback and restoration of cards on clearing search, and continued restriction to a selected provider after clear. Preserve scoped settings links, modal Close/Escape/focus return and unrelated URL parameters. Obtain a failing result for the new behavior, then make it pass; do not claim that source assertions prove the served flow.
5. Related-test advice for both Inspector and Workspace returned no graph-linked tests. Expand verification rather than treating this as an exemption: run the colocated workspace/navigation tests; `apps/web/lib/ai-operations-map/routing-management.test.ts` for projection, view-model and scope contracts; report-kit FilterBar, EmptyState and DataTable tests; and `packages/i18n/src/catalog.test.ts`, including its pseudo-locale cases. Run web package typechecking, `pnpm run check:prose-lint:test`, `pnpm run check:prose-lint`, `node scripts/check-style-drift.mjs`, whitespace checks and the claimed scope's doc-index/doc-impact/doc-diagram checks. Preserve the Workspace prose ratchet and all existing route-budget ceilings. Update `docs/user-guide/platform/ai-operations.md` and `docs/ux-fit/2026-10-25-routing-polish.ux-fit.json` with the actual delivered behavior and evidence. Complete preflight and the governed exact-tree merged-code gate; later source changes invalidate affected evidence.
6. After normal protected PR/merge and canonical deployment, verify the containing served release at 320px, 390px and 1280px in both themes. Inspect the default decision explanation and source disclosure, no-match/result-count/search-clear states under all-provider and selected-provider scope, retained task/data/time/provider context, provider-settings roundtrip, keyboard Escape and focus return. Record actual source identity, screenshots and measured outcomes; retain failures and unrun checks explicitly. No local worktree runtime or prototype stands in for this acceptance.

### Critique provenance and limits

Native evidence `cmvoj2jhf020p01o00ty1sxwc` records the original CE-724328D6 attempt as unavailable: its task lifecycle completed with a generic fallback, zero executed tools and no verifiable source-read evidence or critique result. Task completion is not critique completion. Preserve that actual attempt and CE-1FE20783 reconciliation separately; do not rebind either original request to this new head or describe these corrections as a native Critic verdict. The latest calibrated-only corpus search returned zero entries, so compositional judgment remains explicitly UNGROUNDED relative to the product's design authority. Engineering measurements and the delivery owner's disposition do not manufacture a human calibration verdict or promote the critic's authority.

### Boundaries and rollback

No API, schema, routing policy, provider write, grant, assignment ownership, inference dispatch or stored evidence contract changes. Existing outcomes, holds, costs and quality denominators remain intact. Revert the correction PR if needed; no data migration or stored-configuration rollback is required. Plan/document work alone does not complete implementation, deployment, current UI acceptance or the outstanding attributable specialist contribution.


## Residual presentation correction - October 28

Continue BI-2BBD9D34 in successor WC-93E1F31C, branch `fix/routing-presentation-corrections`, based on `4c290ad54d46c650f1fc954d175cb478dbab761d`. Preserve the archived earlier rooms, their delivered PRs, immutable evidence and original UNKNOWN Critic engagements. This is bounded presentation rework under the unchanged seven acceptance criteria.

The current served/source audit confirms three remaining issues: FlowGroup's All buttons have height but no minimum width; the evidence footer joins its two sentences; evaluation says `0/N known` without stating that the numerator counts successful executions. Apply the existing 44px minimum width to both shared All buttons, add a sentence separator to the existing footer, and clarify the localized cohort wording as successes among known executions. Retain the selected-model execution denominator, separate unknown count, URL scope, existing controls and all routing/provider authority.

Reuse the existing research, reviewed prototype, Source evidence disclosure, report-kit and platform touch-target guidance. Run the existing workspace/navigation/projection and i18n catalog suites, package typechecks, gate-context obligations and the governed exact-tree merged-code gate. The graph is updating and has no linked tests for these files, so include colocated tests and shared report-kit consumers. These reversible presentation edits add no behavior that needs a new unit test; current served DOM and target geometry are required verification.

Land one DCO-signed protected PR after independent source assessment and the current publication policy. Verify the containing canonical release at 320px, 390px and 1280px in both themes: All controls at least44x44CSSpx, no horizontal overflow, readable footer, explicit success/known/unknown wording, unchanged source disclosure/search/clear, Escape and focus return, and retained provider/task/data/time scope. Do not relabel earlier screenshots as current verification. Record actual unrun checks and limits. No user-guide workflow changes are needed because labels, destinations, controls and investigation steps remain the same; this addendum documents the clarified metric meaning. Revert is the correction PR; no data/configuration rollback applies.

Native UX Critic contribution, source-coverage mapping, author disposition and independent whole-case acceptance remain owed separately. This correction neither dispatches nor recreates a Critic engagement and is not a professional UX verdict.


## Assignment search recovery correction - October 29

Served source `dc1e4b5f66fae06c5c1cfcb8f82ec79b971e5cc7` confirms an AC-GRAPH gap: an unmatched assignment-catalog search renders an empty list without a result count or recovery message. Clearing restores the six scoped assignments and Escape restores the initiating All control and original URL. Workroom assurance finding `routing-assignment-zero-results-observed-20261030` retains the screenshot, accessibility tree and observed recovery. The same branch is unchanged in the reviewed/published `478ccfaa` anchor and PR 6765. This is further correction of the existing search-and-inspect flow under the unchanged seven acceptance criteria.

1. Add a first-failing workspace regression for all-provider and selected-provider scopes: zero matches must show an explicit status and zero count; clearing must restore only assignments within provider/task/data/window scope, and preserve the URL. Retain existing assignment label/identifier search and settings links.
2. Derive the existing assignment predicate once and use the filtered array for both the list and shared FilterBar count. Reuse the already imported report-kit EmptyState for localized no-match and clear-search guidance, matching the existing provider catalog. No new primitive, route, control, store or authority is introduced.
3. Update the operator guide's existing search-recovery guidance. Run workspace/projection/report-kit and locale tests, both web TypeScript programs, applicable prose/style/derived guards, independent assessment and the applicable protected publication procedure for the amended source. Historical anchor checks remain attributed to 478ccfaa; any reused evidence must satisfy the actual adapter, never a fabricated passing identity.
4. On the containing release, add assignment no-match/clear/scoped-restore checks to the existing phone/desktop/theme matrix. Retain native Critic contribution, author disposition and independent acceptance as separate obligations. Revert the same correction PR; no data/configuration rollback is needed.
