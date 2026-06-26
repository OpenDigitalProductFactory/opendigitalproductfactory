# Marketing Coworker — Campaign Parity (establish → execute)

Status: in progress — Slice 1 shipped in this PR; structural slices filed as BIs under EP-MARKETING-EXEC.
Owner: Marketing Strategist coworker (`/customer/marketing`).
Related: BI-3E92B28B (fabrication-guard fix, merged PR #2430), EP-MARKETING-EXEC.

## Why

A user testing the Marketing Strategist found it unhelpful: it kept promising work and
failing ("the underlying work wasn't recorded"). The root cause — a build-oriented
fabrication guard firing on a conversational route — is fixed and merged (BI-3E92B28B).

The follow-on objective: the coworker should be **truly helpful at establishing AND
executing a marketing campaign**, at parity with or beyond the marketing skills shipped
by GitHub / Claude / Codex. This doc records a grounded capability audit and the path to
that parity.

## Capability audit (grounded, 2026-06-26)

The marketing surface is broader than the market skills in one respect: it is a real,
DB-backed execution loop (review → brief → asset task → LLM-drafted copy → approval queue
→ gated publish → KPI pullback → scheduler/autopilot), not a stateless prompt. External
channel calls already have a clean env-gated mock seam (`*_MOCK_MODE`, injectable
`fetchImpl`), so stubbing real endpoints is supported.

The real gaps vs a best-in-class campaign assistant:

1. **No first-class Campaign aggregate (keystone).** Briefs, asset tasks, and drafts are
   loose siblings off `MarketingStrategy`; the campaigns page reconstructs the
   brief→task association by *fuzzy string matching* (`taskMatchesBrief`). There is no
   campaign object tying objective + audience + channels + budget + timeline + KPI targets
   + child assets + status together, and asset tasks carry no `briefId`/`campaignId`.
2. **No budget / spend planning.** The only money concept is a defensive weekly spend
   ceiling. No campaign budget, per-channel allocation, or pacing.
3. **No timeline / content calendar.** Briefs have no dates; tasks have a free-text
   `dueWindow`; `ScheduledOutboundAction` is a job queue, not an editorial calendar.
4. **ICP / audience is thin and auto-derived.** Segments/ICPs are JSON on the strategy,
   mechanically seeded from business context; no persona model, sizing, or targeting.
5. **No A/B / multi-variant content.** `draft_marketing_asset` produces exactly one draft
   and its system prompt forbids variants.
6. **No UTM / link tracking / attribution.** No tracked-link builder; the funnel view
   admits "source evidence, not full attribution."
7. **No competitor / battlecard intelligence** wired into the marketing surface.
8. **Performance reporting is single-channel** (only linkedin-ads implements engagement
   pull); no cross-channel rollup or campaign-level report.

## Slice 1 — shipped in this PR (no schema, fully unit-tested)

Chosen for highest value-per-risk and to honor the project lesson "the gap is missing
inputs, not structure." Both items improve the *outputs* and add a standard execution
capability without a schema migration (which carries self-upgrade blast radius and is
deferred for explicit operator go-ahead).

- **Persona uplift (inputs).** The Marketing Strategist prompt now carries an explicit
  **Campaign Operating Procedure** (establish → plan → produce → launch → measure) with a
  stated stage at each turn, **output contracts** (ICP, campaign brief, channel copy), and
  proven structure (position-before-tactics, PAS/AIDA, funnel math). This is the single
  biggest lever for parity with market skills and is pure prompt = zero schema risk.
- **Tracked-link builder (execution).** New pure helper `lib/marketing/utm.ts` and
  read-only tool `build_tracked_links` (advise-mode-safe) mint normalized UTM-tagged URLs
  (one `utm_content` per asset/variant) so a campaign's clicks are measurable. Addresses
  gap #6 (the input half of attribution).

## Slice 2 — shipped in this PR (the Campaign aggregate keystone)

Closes the structural gap #1 (and the establish-side of #2/#3). Additive schema only —
migration `20260626120000_add_marketing_campaign` generated offline via
`prisma migrate diff` (no DB touched), non-destructive (new table + nullable FK columns).

- **`MarketingCampaign` model** — the executable plan aggregate: objective, audience,
  channels, `budgetTotalCents` + `budgetByChannel`, `startDate`/`endDate`, `kpiTargets`,
  status (draft/active/paused/complete), owning its briefs and asset tasks via a nullable
  `campaignId` FK (onDelete: SetNull, indexed).
- **Real relation replaces fuzzy matching** — `taskMatchesBrief` now matches on
  `campaignId` when both rows have one (definitive match/non-match), falling back to the
  legacy channel/title heuristic only for pre-campaign (null) rows. Backward compatible.
- **Tools (in the marketing pack):** `create_marketing_campaign`, `update_marketing_campaign`,
  `attach_to_campaign`, `get_campaign_plan` (the last returns a live execution rollup with
  the single most useful next step). Grants mirror `agent-grants` TOOL_TO_GRANTS.
- **Persona** now drives campaign-first: stage 1 ESTABLISH creates the campaign; briefs and
  tasks attach to it; `get_campaign_plan` reports status.
- **Pure rollup core** (`summarizeCampaignExecution`) is unit-tested without a DB.

## Deferred roadmap (filed as BIs under EP-MARKETING-EXEC)

These require further LLM-path work or new entities best validated on a live install:

- **A/B / multi-variant drafting** — opt-in `variantCount` on `draft_marketing_asset`,
  default 1 (no regression), labeled variants in the approval queue.
- **Content calendar** — editorial calendar entity + view over scheduled drafts/tasks.
- **Competitor battlecard** — wire competitive intelligence into the marketing surface.
- **Cross-channel performance report** — engagement pull for all channels + campaign rollup.
- **Channel breadth** — company-page LinkedIn, X, Meta, Google Ads, web/landing publishing.

## Verification

- `lib/marketing/utm.test.ts` — 18 cases (normalization, query/hash preservation,
  idempotent re-tag, multi-link, validation, invalid-URL handling).
- `lib/marketing/campaigns.test.ts` — pure execution-rollup math (empty → brief → tasks →
  draft → review → publish next-step transitions; approved not double-counted) and the
  `taskMatchesBrief` relation-over-fuzzy logic (same/different campaignId definitive;
  fuzzy fallback when null).
- `lib/marketing/`, `tool-description-hygiene`, `tool-registry` (grant-drift), and
  `agent-routing` suites green. Tool descriptions provenance-free per the hygiene guard.
- Module-size + MCP tool-pack ratchets pass on tracked files (campaign tools live in the
  pack, not inline; baseline bumps limited to the intentionally-grown files).
- Migration is additive and was generated by `prisma migrate diff` so it is consistent
  with the schema; CI runs the real migrate + Production Build as the gate.
