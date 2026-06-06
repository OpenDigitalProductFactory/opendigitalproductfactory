# Customer CRM Marketing UX Reconciliation

| Field | Value |
| ----- | ----- |
| Date | 2026-06-06 |
| Status | Current-state reconciliation and UX fit review |
| Branch | `feat/customer-crm-ux-reconcile` |
| Follow-up branch | `fix/auth-login-crawl` |
| Related plan | `docs/superpowers/plans/2026-05-26-pipedrive-crm-marketing-slice-1.md` |
| Related spec | `docs/superpowers/specs/2026-05-26-pipedrive-inspired-crm-marketing-operations-design.md` |
| Live backlog | `BI-D8E00326` - CRM marketing Slice 5: agentic sales and marketing operations |

## 1. Verdict

The Customer CRM and Marketing route family now fits the portal simplification direction as a Business > Customer surface. The older Slice 1 plan should not be executed task-by-task anymore: its core work has landed on `origin/main`.

The remaining product gap is Slice 5, not Slice 1:

- sales advisor and marketing strategist actions that create durable internal artifacts
- approval-gated external send, publish, schedule, or spend actions
- saved artifact visibility outside chat
- UX verification after the canonical auth path is healthy

## 2. Current-State Map

| Surface | Current home | Evidence | UX assessment |
| ------- | ------------ | -------- | ------------- |
| `/customer` | Business > Customer section home | `RevenueCockpit`, `CustomerMetricTile`, `CustomerStatusBadge`, `buildRevenueCockpitSummary` | Fits as a scan-first local decision surface. It should remain a Customer section home, not a global dashboard. |
| `/customer/opportunities` | Customer pipeline working surface | `PipelineStageInspector`, `AgentWorkLauncher`, shared CRM status metadata | Fits as the working view for stale deals and next actions. Coworker work remains preview + confirmation. |
| `/customer/engagements` | Customer acquisition workflow | `AcquisitionSignalRouter`, `Engagement.source`, `sourceRefId` | Fits as signal-to-engagement routing without introducing a separate Lead table. |
| `/customer/marketing` | Customer Marketing overview | `AgentWorkLauncher`, saved marketing strategy and work-product panels | Fits as strategy-first marketing context. Avoid turning it into another global campaign dashboard. |
| `/customer/marketing/campaigns` | Customer Marketing subroute | real route and `MarketingRoutePrimitives` | Fits because the route is now backed by read-only campaign brief/task data. |
| `/customer/marketing/funnel` | Customer Marketing subroute | real route and `MarketingRoutePrimitives` | Fits because the route reads source/channel/stage evidence instead of showing a phase placeholder. |
| `/customer/marketing/automation` | Customer Marketing subroute | real route and `MarketingRoutePrimitives` | Fits because the route reads automation candidates and approval posture. |

## 3. Findings

### Fixed In This Reconciliation

- The Slice 1 implementation plan was stale and still looked executable even though the work is already on `origin/main`.
- `CustomerMetricTile` and `CustomerStatusBadge` still owned their own visual shell. They now compose `report-kit` `StatCard` and `StatusBadge` through a small CRM-tone adapter, preserving Customer CRM vocabulary while converging reporting UI.
- The target Customer CRM route family has no `STATUS_COLOURS`, `STAGE_COLOURS`, raw hex, or raw Tailwind color classes in the audited paths.

### Remaining Guardrails

- Keep Slice 5 inside Business > Customer. Do not promote sales/marketing AI work to global AppRail, Workspace cards, Platform nav, `/portal`, or `/storefront`.
- Metric tiles, tabs, and topic choices navigate or select only. They must not send coworker prompts.
- Coworker-starting actions stay inside `AgentWorkLauncher` with prompt preview, context summary, expected next step, and explicit confirmation.
- External send, publish, schedule, or ad-spend actions remain approval-gated and must preserve consent and provenance.
- Future generic reporting surfaces should use `report-kit` directly; Customer wrappers are acceptable only as thin vocabulary adapters.

### Runtime Evidence Follow-Up

The canonical portal responded at `http://127.0.0.1:3000/welcome` and `/login`, and the Docker `dpf-portal-1` container was healthy. The first authenticated route crawl was blocked because submitting the admin login form produced the app fallback text "This page couldn't load". No useful matching portal log appeared in the recent tail.

Follow-up on 2026-06-06 from `D:\DPF-worktrees\auth-login-crawl` did not reproduce the login fallback. The canonical login reached `/workspace`, established an `authjs.session-token`, and the authenticated crawl loaded:

- `/customer`
- `/customer/opportunities`
- `/customer/engagements`
- `/customer/marketing`
- `/customer/marketing/strategy`
- `/customer/marketing/campaigns`
- `/customer/marketing/funnel`
- `/customer/marketing/automation`

No route showed the app fallback text. Browser events included expected aborted navigation and `/api/agent/system-stream` requests while moving route-to-route, but no page-level runtime error surfaced during the crawl.

The visual finding from the authenticated crawl was that the global collapsed AI Coworker FAB defaulted to the vertical midpoint and could occlude primary page actions, most visibly the `/customer/marketing` "Start marketing review" action. The follow-up fix moves the collapsed FAB to a lower safe dock band (`72%`-`92%`, default `82%`) and migrates old midpoint preferences out of the action lane.

## 4. UX Fit Review - Customer CRM Marketing Reconciliation

- Decision: fits-with-guardrails
- Owning area: Business > Customer
- Route family: `/customer`, `/customer/opportunities`, `/customer/engagements`, `/customer/funnel`, `/customer/marketing`, `/customer/marketing/campaigns`, `/customer/marketing/funnel`, `/customer/marketing/automation`
- Primary persona: founder/operator managing customer acquisition, revenue attention, and marketing work without remembering scattered route names
- Navigation layer touched: section navigation plus local page links only
- Reuse/convergence: Customer CRM vocabulary wrappers now compose `report-kit` `StatCard` and `StatusBadge`; marketing subroutes use `MarketingRoutePrimitives` and report-kit primitives
- Source truth: existing CRM models, marketing work-product models, `apps/web/lib/crm/presentation.ts`, `apps/web/lib/crm/revenue-cockpit.ts`, and marketing route read models
- Empty/failure behavior: current route code contains calm empty states; Slice 5 should keep empty states outcome-oriented and avoid tutorial-heavy walls of copy
- AI boundary: no prompt send from metric/tab clicks; coworker work requires `AgentWorkLauncher` preview and explicit confirmation
- Required plan/spec edits:
  - Mark the old Slice 1 implementation plan as historical/current-main reconciled
  - Point remaining product work at `BI-D8E00326`
  - Record the canonical auth-crawl follow-up so route screenshots are not overclaimed
- Evidence before merge:
  - source-local focused component tests for Customer wrappers and `RevenueCockpit`
  - hardcoded-color scan over Customer CRM/Marketing route family
  - typecheck and production build
  - authenticated browser crawl once login/runtime is healthy
- Captured in: this audit, the Slice 1 plan status block, and the Pipedrive CRM/Marketing spec runtime grounding

## 5. Next Slice

Proceed with `BI-D8E00326` as Slice 5 only after this reconciliation lands. The implementation should focus on agentic sales and marketing operations:

1. keep all entry points inside Business > Customer
2. use `AgentWorkLauncher` or a successor with the same preview/confirmation boundary
3. save internal artifacts through governed tools
4. show saved artifacts on the relevant Customer/Marketing route, not only in chat
5. gate external side effects behind explicit approval
6. re-run authenticated desktop and mobile browser crawls after the FAB safe-dock fix reaches the canonical runtime through the governed promotion path
