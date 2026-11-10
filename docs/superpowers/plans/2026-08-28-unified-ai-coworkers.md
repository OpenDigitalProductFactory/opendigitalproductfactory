# Unified AI Coworkers implementation plan

**Backlog item:** `BI-4BF1FF9C`
**Decision:** `DI-C775CA53632E` — one canonical coworker home, high confidence
**Scope decision:** `DI-01D9535C3E84` — operator-journey core, high confidence
**Workroom:** `WC-A0588D8C` (historical carrier; superseded lease is reconciled through the current branch claim)
**Branch:** `fix/unified-ai-coworkers`

## Outcome

Deliver one revertible PR that makes `/workforce` the canonical AI Coworkers experience. The page keeps the coworker directory as its default view and adds a stable Activity view for current and recent governed work. Activity distinguishes roster coworkers from Workroom-backed external or platform execution, so an operator can answer “who is working, what ran recently, and where is the governing context?” without choosing between **AI Coworkers** and **AI Workforce**.

The old `/platform/ai/right-now` URL becomes a compatibility entry into `/workforce?view=activity`. Advanced provider, routing, skill, governance, scheduling, and build-runtime controls remain available as contextual links rather than a competing roster home.

The self-upgrade skip defect from the original report is no longer part of this change. The deployed runtime at `cc34280b` already drains and waits for in-flight work instead of taking the former early `activity-in-flight` skip path. Reintroducing blocker-persistence work here would duplicate the completed recovery.

## Backlog and dependency disposition

- This PR delivers `BI-4BF1FF9C`: one canonical identity-and-activity journey.
- This PR delivers the operator-visible portion of `BI-3EC91596`: today&rsquo;s usage is split into coworker-roster, Workroom-attributed, and genuinely unattributed buckets. Workroom rows show their own recorded token and dollar use.
- `BI-496CD36E` was independently delivered on `main`: emitted Workroom links use the canonical work-case key and the detail loader resolves raw `WC-*` identities. This PR reuses and verifies that route instead of duplicating it.
- This PR delivers `BI-75D5ABCD`: named Operations Map windows plus previous/next traversal over the existing bounded evidence API.
- `BI-7BEDF08A` is superseded by the deployed upgrade drain/wait behavior and is not implemented here.

The delivery stays in one PR because the operator journey depends on all three visible layers: one home, retained governing context, and traversable historical evidence.

## Existing substrate

- Navigation: `apps/web/lib/navigation/portal-navigation-model.ts` remains the single route and rail registry.
- Coworker identity: `loadRoster`, `RosterView`, and `/workforce/[agentId]` remain canonical.
- Activity: `loadWorkforceActivity`, `WorkforceNowShell`, TaskRun, ToolExecution, and TokenUsage remain the existing read model and ledgers.
- External execution: Workroom and WorkroomActivity remain the governing context for Codex, Claude, Grok, Build Studio, and native execution.
- Compatibility: `/platform/ai/right-now` redirects; it does not retain a second page implementation.

## Delivery shape

### 1. Prove the unified route contract with failing tests

- Extend the `/workforce` page test to prove `view=activity` loads and renders the existing live activity shell while the default view still renders the directory.
- Add a route test proving `/platform/ai/right-now` redirects to `/workforce?view=activity` and preserves supported focus query parameters.
- Extend navigation tests to prove the shell exposes one canonical AI-coworker destination and does not present **AI Workforce** as a competing primary destination.

### 2. Compose identity and activity at `/workforce`

- Add a compact, accessible **Coworkers / Activity** page-local switch backed by the `view` query parameter.
- Load roster data only for the directory view and activity data only for the activity view.
- Reuse `WorkforceNowShell`; do not fork its refresh loop, status vocabulary, sensitive-data aggregation, or usage calculations.
- Explain on the Activity view that coworker rows are governed identities while external and platform execution is governed through Workrooms. Link to the canonical Workroom inventory and Operations Map for deeper context.
- Add a secondary **Advanced AI operations** disclosure linking to the existing provider/routing, skills, governance, scheduling, and build-runtime controls.

### 3. Retain Workroom context and attribute usage

- Add current and recently completed Workrooms to the activity read model without creating a second execution ledger.
- Resolve room ownership from the existing TokenUsage `contextKey` conventions and keep non-room, non-roster use explicitly unattributed.
- Show Workroom objective, executor, status, freshness, tokens, cost, and a canonical detail link.
- Keep live TaskRuns with neither coworker nor Workroom context in a separate **Unattached platform runs** lane.

### 4. Remove the competing entry and preserve compatibility

- Remove the `ai_workforce` primary/navigation destination while retaining its operational subroutes and capability checks.
- Redirect `/platform/ai/right-now` to the canonical Activity view.
- Preserve supported query parameters so links can focus the same activity after the redirect.
- Update affected navigation extraction, permission, workspace-home, and route-purpose expectations rather than adding exceptions.

### 5. Make historical activity traversable

- Add 1-hour, 6-hour, 24-hour, and 7-day evidence presets to the Operations Map.
- Add previous/next-window movement and a return-to-live-edge action while preserving the selected window during refresh.
- Reuse the existing `start` / `end` evidence API and replay surface; do not add another history store.

### 6. Verify the operator journey

- Run the focused page, navigation, activity-shell, permission, and extraction tests after the red-to-green cycle.
- Run affected lint and type checks plus the repository gate selected by `pnpm gate:context`.
- Obtain the governed nonproduction target and verify light/dark themes at desktop and narrow width: **AI Coworkers → Activity → Workrooms / Operations Map → Advanced AI operations**.
- Record the UX-fit evidence and documentation-impact decision before PR handoff.

## Acceptance

- The primary navigation has one AI-coworker destination: `/workforce`.
- `/workforce` defaults to the roster and exposes Activity without sending the operator to a different main-menu domain.
- Activity uses the existing current/recent read model and explicitly distinguishes coworker identity from external/platform Workroom execution.
- Token totals reconcile across roster, Workroom, and unattributed buckets, and every displayed Workroom links to its retained detail.
- The Operations Map can move through named and adjacent historical windows without relying on an imprecise scrub gesture.
- `/platform/ai/right-now` is a compatibility redirect into `/workforce?view=activity`, with supported focus query state preserved.
- Advanced fleet controls remain reachable contextually and are not presented as a competing roster.
- No schema, identity registry, TaskRun ledger, Workroom ledger, or refresh implementation is duplicated.

## Documentation impact

Update this plan and the amended portfolio-shaped IA design in the same PR. Update the user guide only where the final route labels or compatibility behavior change. No migration or install procedure is expected.
