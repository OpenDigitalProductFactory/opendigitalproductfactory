# Pipedrive CRM Marketing Slice 5 Implementation Plan

> **For agentic workers:** Execute incrementally with TDD. Keep all entry points inside Business > Customer. Use governed marketing tools for internal work product, and keep external publish, send, schedule, ad spend, and autopilot policy changes behind explicit approval.

**Backlog item:** `BI-D8E00326` - CRM marketing Slice 5: agentic sales and marketing operations.

**Goal:** Turn `/customer` and `/customer/marketing` from read-only orientation plus ad hoc coworker prompts into a maintainable guided-work surface where sales and marketing coworkers create durable internal artifacts instead of chat-only advice.

**Architecture:** Keep the route family under `/customer`. Use `AgentWorkLauncher` for explicit preview and confirmation. Put reusable guided-work topic construction in source-local helpers instead of page-local prompt arrays. Use the existing marketing work-product tools and visible routes (`/customer/marketing/campaigns`, `/customer/marketing/funnel`, `/customer/marketing/automation`) before adding any new schema.

## Scope

Deliver in small PRs:

- Sales advisor deal summary and follow-up drafting prompts stay on opportunity routes.
- Marketing strategist guided starts cover signal review, campaign brief creation, automation candidates, and integration recommendations.
- Internal artifacts are saved through governed marketing tools.
- Saved artifacts remain visible outside chat on the existing Customer Marketing routes.
- External side effects stay approval-gated.

Out of scope for the first increment:

- New CRM write tools.
- New database tables.
- External publish/send/schedule/ad-spend execution.
- Moving Customer Marketing into global navigation, `/portal`, or `/storefront`.

## Task 1: Guided Marketing Topic Source of Truth

- [x] Add a pure `buildMarketingAgenticOperationTopics()` helper.
- [x] Replace page-local `/customer/marketing` prompt arrays with the helper.
- [x] Pass explicit `/customer/marketing` route context into `AgentWorkLauncher`.
- [x] Test that launcher topics cover Slice 5 and exclude external side-effect tool names.

## Task 2: Sales Advisor Boundary Review

- [ ] Keep existing opportunity deal summary, stage health, and follow-up draft topics.
- [ ] Verify no sales launcher claims persistence through tools that do not exist.
- [ ] Add tests if future CRM governed-write tools are introduced.

## Task 3: Marketing Artifact Creation Flow

- [ ] Confirm `marketing-specialist` prompts and grants can use `save_marketing_review`, `create_marketing_campaign_brief`, `create_marketing_asset_task`, `record_marketing_kpi_checkpoint`, `create_marketing_automation_candidate`, and `draft_marketing_asset`.
- [ ] Exercise a guided prompt that saves a recommendation or campaign artifact.
- [ ] Verify the saved artifact appears on the relevant Customer Marketing route outside chat.

## Task 4: Approval Boundary Evidence

- [ ] Verify pending drafts appear in the approval queue before any external action.
- [ ] Verify approved drafts require a visible publish/send button and connected integration.
- [ ] Verify automation candidates remain proposals until a governed workflow adds enablement controls.

## Task 5: UX Verification

- [ ] Re-run authenticated desktop crawl for `/customer`, `/customer/opportunities`, and all `/customer/marketing/*` routes after promotion to a canonical runtime or shared local-CI lease.
- [ ] Re-run mobile viewport inspection for clipped text and launcher overlap.
- [ ] Record evidence on `BI-D8E00326` once write-scoped MCP evidence is available.

## Verification for This Increment

- `pnpm --filter web exec vitest run lib/marketing/agentic-operations.test.ts 'app/(shell)/customer/marketing/page.test.tsx' lib/marketing/subroutes.test.ts components/agent/AgentWorkLauncher.test.tsx components/customer-marketing/MarketingTabNav.test.tsx`
- `pnpm --filter web typecheck`
- `pnpm --filter web build`
