# Marketing Coworker — Parity Completion Plan

**Status:** in progress · **Epic:** EP-MARKETING-EXEC · **Owner:** Marketing Strategist coworker

## Why

The Marketing Strategist is a critical coworker. After the fabrication-guard fix
(#2430) unblocked it and the campaign-aggregate keystone (#2460, #2468) gave it a
real establish→execute→measure spine, a gap audit against market marketing skills
(Claude/Codex marketing skills, HubSpot/Jasper-class tools) found the core loop is
in place but three enhancement capabilities are missing. This plan closes them.

## Substrate already in place (verified on `main`, do NOT rebuild)

- **Campaign aggregate** — `MarketingCampaign` model + create/update/attach/get_campaign_plan.
- **Cross-channel performance rollup** — `campaign-performance.ts` (`getCampaignPerformance`,
  per-channel + total impressions/clicks/spend/conversions, CTR/CPC/CPA, spend-vs-budget,
  KPI attainment) + `get_campaign_performance` tool.
- **Channel breadth** — `MARKETING_CHANNELS` already spans 18 channels (email, linkedin,
  facebook, instagram, x, youtube, tiktok, outbound-mail, event-attend/sponsor, referral,
  partner, content-seo, paid-search, paid-social, podcast, webinar, phone) with a per-channel
  adapter registry (`channels/registry.ts`).
- **Scheduler + autopilot**, **publish adapters** (stubbed external calls), **KPI pullback**,
  **spend gate**, **UTM tracked links**.

## True remaining gaps → slices

### Slice A — Content calendar (THIS PR)
Read-only editorial calendar: project `MarketingAssetTask` rows onto Mon–Sun week
buckets by their due window, with per-channel/per-status counts and an explicit
`unscheduled` list so nothing is silently dropped. Reuses the scheduler's
`parseDueWindowToDate` (exported) so the calendar and auto-scheduler agree on dates.
No new schema.

- `lib/marketing/content-calendar.ts` — pure `buildContentCalendar()` + `weekStartUtc()`
  + async `getContentCalendar({campaignId?})`.
- `get_content_calendar` tool (view_marketing, read-only) in `marketing-pack.ts`.
- Grants added to `TOOL_TO_GRANTS` (also backfills the missing `get_campaign_performance`
  entry — a latent gap that left that shipped tool coworker-uncallable).
- Persona roster + PRODUCE step reference the tool.
- Tests: `content-calendar.test.ts` (bucketing, week boundaries, unscheduled routing,
  relative "week N" windows, count reconciliation).

### Slice B — A/B copy variants (next)
`MarketingAssetVariant` model (variantId, taskId, label, copy, status, per-variant
KPI linkage) + create/record/pick-winner tools. Lets the coworker produce and
compare multiple copy treatments per asset — the market-standard content-production
differentiator.

### Slice C — Competitive battlecard (next)
`MarketingBattlecard` durable artifact (competitor, positioning, strengths,
weaknesses, differentiators, objection handling) + create/get tools, upgrading the
existing conversational `competitive-analysis` skill from chat-only to a saved,
reusable asset.

## Verification

Each slice: vitest for the pure logic; CI Typecheck (vitest's esbuild path skips
types — always confirm `tsc` on touched files, INCLUDING test files); Production
Build; tool-registry no-drift. Merge queue lands each on `main`.

## Out of scope

Live external endpoint calls remain stubbed by design (per the operator directive).
The value is the internal establish→execute→measure workflow reaching market parity.
