# Pipedrive-Inspired CRM and Marketing Operations Design

| Field | Value |
| --- | --- |
| Date | 2026-05-26 |
| Status | Draft for operator review |
| Owners | Mark Bodman, Codex |
| Scope | Customer CRM, pipeline, marketing workspace, acquisition integrations, AI coworker use cases |
| Related specs | `2026-03-20-crm-research-synthesis.md`, `2026-03-20-crm-sales-pipeline-design.md`, `2026-04-24-customer-marketing-workspace-design.md`, `2026-04-11-marketing-specialist-skills-design.md` |

## 1. Purpose

This spec translates current Pipedrive research into DPF product changes for marketing and sales functionality. The goal is not to clone Pipedrive. The goal is to adopt what users repeatedly value most: a low-friction visual pipeline, visible next actions, useful automation, connected activity context, and an AI assistant that helps the operator decide what to do next.

The DPF advantage is that sales, marketing, storefront, integrations, and AI coworkers already share a platform. We should use that advantage by making customer acquisition feel like one operating loop:

1. detect a market or buyer signal
2. qualify the signal into an engagement
3. advance the engagement into an opportunity when it becomes buyer intent
4. guide the user through the next best activity
5. create quotes, orders, campaigns, proof assets, or automation candidates without losing context

## 2. Current Runtime Grounding

The current repo already has the substrate needed for a first implementation slice. We should extend it rather than create a parallel CRM.

- CRM models already exist in Prisma: `CustomerAccount`, `CustomerContact`, `Engagement`, `Opportunity`, `Quote`, `SalesOrder`, and `Activity` in `packages/db/prisma/schema.prisma`.
- Pipeline data already includes `Opportunity.stage`, `probability`, `expectedValue`, and `stageChangedAt`.
- `Engagement` already has `source` and `sourceRefId`, which are suitable for first-slice lead and market signal routing.
- Marketing work products already exist: `MarketingStrategy`, `MarketingReview`, `MarketingCampaignBrief`, `MarketingAssetTask`, `MarketingKpiCheckpoint`, and `MarketingAutomationCandidate`.
- `/customer/marketing` now exists as the internal marketing workspace and resolves to `marketing-specialist`.
- The marketing agent already persists durable work via MCP tools such as `save_marketing_review`, `create_marketing_campaign_brief`, `create_marketing_asset_task`, `record_marketing_kpi_checkpoint`, and `create_marketing_automation_candidate`.
- The `MarketingTabNav` still exposes disabled Campaigns, Funnel, and Automation tabs with "Phase 2" / "Phase 3" labels. This creates visible product debt on a customer-facing operations surface.
- The CRM pages under `/customer` still use hardcoded status and stage colors plus inline style objects. This violates the DPF theme-aware UI standard and should be cleaned up as part of the first product slice.
- The native integration catalogue already includes HubSpot CRM and Marketing, Google Marketing Intelligence, Facebook Lead Ads, Google Business Profile, and Mailchimp Marketing.
- The integration coverage matrix already says Facebook Lead Ads should land in CRM and sales workflow, and Mailchimp writeback requires consent and customer-record boundaries.

## 3. Backlog Grounding

MCP was attempted first for planning and spec search. Semantic spec search did not return the CRM and marketing docs even though they exist in the repo. Later MCP backlog calls failed against `http://127.0.0.1:3000/api/mcp/v1`, so live PostgreSQL DB fallback was used explicitly.

Live DB fallback found an existing in-progress epic:

- `EP-MARKETING`: Marketing coworker + native readiness (WhatsApp / Instagram / GMB)
- 9 backlog items are linked.
- Statuses include `done`, `in-progress`, and two existing `triaging` rows.

This design should extend the existing marketing epic or spawn a tightly scoped CRM/marketing operations epic after operator approval. It should not mutate backlog statuses in this thread, especially because `triaging` exists in live data while AGENTS.md lists canonical backlog statuses as `open`, `in-progress`, `done`, and `deferred`.

## 4. Research and Benchmarking

### 4.1 Pipedrive Product Patterns

Sources reviewed:

- Pipedrive CRM features: https://www.pipedrive.com/en/crm/features
- Pipedrive products: https://www.pipedrive.com/products/
- Pipedrive Marketplace: https://www.pipedrive.com/en/features/marketplace
- Pipedrive AI Sales Assistant: https://www.pipedrive.com/en/features/ai-sales-assistant
- Pipedrive AI email writer: https://www.pipedrive.com/en/products/ai-crm/ai-email-writer
- Pipedrive lead generation software: https://www.pipedrive.com/en/features/lead-generation-software
- Pipedrive 2025 product roadmap PDF: https://www-cms.pipedriveassets.com/documents/Pipedrive-product-roadmap_2025.pdf

Observed product themes:

- The sales pipeline is the primary working object, not a secondary report.
- Deal movement is visual and stage-based.
- Activity management is central: follow-ups, calls, emails, meetings, and reminders keep deals from going stale.
- AI is positioned as a sales assistant or sales mentor, not just a chat box.
- LeadBooster, web visitors, forms, chat, and integrations feed the CRM rather than living as disconnected marketing objects.
- Marketplace integrations are a major value prop because users want CRM to be the center of daily selling.
- The 2025 roadmap direction emphasizes connected touchpoints, workflow automation, and AI agents that reduce noise.

### 4.2 External Sentiment

Sources reviewed:

- G2 Pipedrive reviews: https://www.g2.com/products/pipedrive/reviews
- Capterra Pipedrive reviews: https://www.capterra.com/p/132666/Pipedrive/reviews/
- TrustRadius Pipedrive reviews: https://www.trustradius.com/products/pipedrive/reviews/all
- TechRadar Pipedrive CRM review: https://www.techradar.com/reviews/pipedrive-crm-review

What people like most:

- Ease of use and fast onboarding.
- Visual pipeline clarity.
- Drag-and-drop deal progression.
- Simple activity and task visibility.
- Email and calendar context near the deal.
- Automation that reduces repetitive admin.
- A marketplace that connects the rest of the sales stack.
- AI assistance that prioritizes work and drafts communication.

Common cautions:

- Add-ons can create cost and capability sprawl.
- Advanced marketing and reporting can be weaker than larger CRM suites.
- A CRM still fails when activity capture and reminder trust are weak.
- Too many disconnected integrations can make the pipeline harder to trust.

### 4.3 Prior DPF Benchmarking

The existing CRM research already benchmarked Twenty, Frappe, SuiteCRM, Monica, ERPNext, Odoo, HubSpot patterns, Attio patterns, and public CRM adoption complaints. The strongest existing decisions still hold:

- no separate Salesforce-style lead table
- preserve original `Engagement` records instead of destructive conversion
- use buyer-centric opportunity stages
- auto-log system activity where possible
- use `Activity` as the shared timeline
- store revenue as Decimal plus currency
- keep UI simple enough that an operator can find the next action in seconds

This Pipedrive addendum sharpens the product shape around daily-use UX and AI-assisted operations.

## 5. Adopt, Adapt, Reject

### Adopt

- Make the pipeline and next action feed the center of the working experience.
- Prefer visual stage movement, stage health, and stage aging over form-heavy CRM administration.
- Keep activity capture close to the record being worked.
- Let AI summarize, prioritize, draft, and recommend, but persist concrete output as work product.
- Treat integrations as signal sources that feed CRM and marketing operations.

### Adapt

- Pipedrive optimizes for sales teams. DPF should optimize for operators who may not have separate sales and marketing staff.
- Pipedrive add-ons such as LeadBooster and Campaigns are product modules. DPF should expose comparable capabilities as governed workspaces backed by the existing coworker and integration system.
- Pipedrive email writing is useful, but DPF must bind drafts to approval boundaries, customer context, consent, and proof assets.

### Reject

- Do not add a separate `Lead` table for this slice.
- Do not build a standalone marketing automation island disconnected from CRM stages.
- Do not show phase-locked placeholder tabs on an operational page.
- Do not rely on hardcoded stage colors or inline visual semantics.
- Do not let AI publish, send, schedule, or mutate external channels without explicit human approval.

## 6. Target Experience

### 6.1 Revenue Cockpit

Create a scan-first working surface that answers:

- What changed since I last checked?
- Which opportunities need attention today?
- Which marketing or lead signals are worth acting on?
- Which customer or buyer has no next activity?
- Which AI coworker can help with the next action?

Recommended first placement: enhance `/customer` with a "Today in revenue" band above the existing account list, then embed marketing-specific signal summaries inside `/customer/marketing`.

The cockpit should include:

- open pipeline value
- stale opportunities
- new engagements by source
- recent marketing recommendations
- campaign briefs or asset tasks waiting for approval
- integration readiness gaps
- one-click AI coworker prompts such as "Summarize this deal", "Draft follow-up", "Find stale opportunities", and "Turn this signal into an engagement"

### 6.2 Pipeline Working Canvas

The opportunity list should become a working canvas rather than a grouped report.

Expected behavior:

- columns map to buyer-centric stages: qualification, discovery, proposal, negotiation, closed won, closed lost
- each card shows account, expected value, next activity, age in stage, probability, and source engagement if present
- selecting a deal opens an inspector with recent activity, stage exit criteria, suggested next action, linked quote, and AI helper topics
- moving a deal between stages records an `Activity` entry and updates `stageChangedAt`
- stale deals are flagged based on per-stage thresholds before they rot silently

This can start without drag-and-drop if needed. The first implementation can provide stage filters and a stage inspector, then add drag-and-drop once activity logging and conflict handling are stable.

### 6.3 Signal-to-Engagement Routing

Pipedrive users like lead capture because it keeps the pipeline fed. DPF already has enough primitives to create a governed first version.

Initial signal sources:

- storefront inquiry
- Facebook Lead Ads preview or imported lead
- Google Business Profile review, media, local post, or profile readiness signal
- Mailchimp campaign or audience signal, read-only until consent boundaries are settled
- HubSpot CRM or Marketing read-only context where the external CRM remains provider-led

First slice implementation should use a service/read model that normalizes source evidence into an internal acquisition signal shape, then creates or links an `Engagement` only after a clear operator or agent action. Do not create an `AcquisitionSignal` table in the first slice unless repeated implementation pressure proves the read model is insufficient.

Conceptual flow:

```text
Storefront / Google / Facebook / Mailchimp / HubSpot
  -> acquisition signal read model
  -> Engagement.source + Engagement.sourceRefId
  -> Opportunity when buyer intent is qualified
  -> Quote / SalesOrder / MarketingReview / KPI checkpoint
```

### 6.4 AI Agent Use Cases

The AI coworkers should behave less like generic chat and more like role-specific operators.

Customer Advisor / Sales use cases:

- summarize a deal from account, engagement, opportunity, quote, order, and activity context
- explain why a stage is stale
- suggest the next buyer action and the next internal action
- draft follow-up email copy from the latest activity and current stage
- create a follow-up task
- identify missing qualification evidence
- propose quote readiness checklist

Marketing Strategist use cases:

- turn new market signals into campaign ideas
- create campaign briefs tied to a target segment, channel, proof asset, and expected CRM stage movement
- create proof asset tasks before promotion
- record KPI checkpoints after campaign execution
- propose automation candidates when repeated work appears
- recommend which integrations matter for the current route to market

Governance:

- internal drafts and work products may be created by AI when tools permit
- external publish, send, schedule, ad creation, public profile changes, and customer-facing automation require explicit approval
- AI must not claim persistence unless the tool result confirms it

### 6.5 Marketing Subroutes

The existing marketing spec named Campaigns, Funnel, and Automation subroutes. The current UI exposes those as disabled tabs. That should be replaced with one of two acceptable patterns:

- hide not-yet-implemented tabs until the route exists and has meaningful read-only content
- or implement the tabs as read-only operational surfaces backed by existing work-product records

Recommended first implementation:

- `/customer/marketing/campaigns`: list `MarketingCampaignBrief` and `MarketingAssetTask` records with approval posture and next work
- `/customer/marketing/funnel`: read-only acquisition funnel by engagement source, opportunity stage, and campaign influence where evidence exists
- `/customer/marketing/automation`: list `MarketingAutomationCandidate` records with approval status, trigger, effort, risk, and expected benefit

## 7. Information Architecture

Navigation should stay quiet and operational:

- `/customer`: customer operations cockpit, accounts, pipeline summary, revenue attention feed
- `/customer/engagements`: unqualified and active buying signals
- `/customer/opportunities`: stage-based working pipeline
- `/customer/funnel`: general CRM funnel metrics
- `/customer/marketing`: strategy-first acquisition cockpit
- `/customer/marketing/strategy`: canonical marketing strategy and review surface
- `/customer/marketing/campaigns`: campaign briefs and asset tasks
- `/customer/marketing/funnel`: marketing-specific funnel and channel view
- `/customer/marketing/automation`: automation candidates and approval posture

Do not move `/portal`; AGENTS.md reserves it for external customer experience. Do not make `/storefront` the canonical marketing workspace again; it should remain public storefront operations and presentation.

## 8. UI Design Rules for This Work

This is an operational SaaS surface. It should feel calm, dense, and scan-first.

Rules:

- no marketing landing page composition
- no decorative hero blocks
- no nested cards
- no hardcoded colors
- no inline status hex values
- no disabled phase labels as product navigation
- stable widths and heights for stage columns, metric tiles, and card badges
- icons for compact commands where lucide icons exist
- tab navigation only for real routes or meaningful read-only views
- short labels and clear values, not explanatory paragraphs inside every card
- visual priority through layout, spacing, typography, and theme tokens

Use DPF theme variables:

- text: `text-[var(--dpf-text)]`
- muted text: `text-[var(--dpf-muted)]`
- surfaces: `bg-[var(--dpf-surface-1)]`, `bg-[var(--dpf-surface-2)]`
- borders: `border-[var(--dpf-border)]`
- accent: `text-[var(--dpf-accent)]`, `bg-[var(--dpf-accent)]`

## 9. Refactor Budget

Reserve roughly 20 percent of the implementation budget for refactoring. This is required to keep the UX and architecture from getting worse while adding the Pipedrive-inspired functionality.

Refactor targets:

1. Centralize CRM visual semantics.
   - Replace duplicated `STATUS_COLOURS` and `STAGE_COLOURS` maps.
   - Use semantic token names and CSS variables instead of hex values.
   - Keep status labels, stage labels, aging thresholds, and badge tone metadata in one module.

2. Extract shared CRM summary components.
   - Reuse metric tiles across `/customer`, `/customer/funnel`, `/customer/opportunities`, and marketing funnel views.
   - Keep components theme-aware and stable in size.

3. Extract pipeline query helpers.
   - Avoid repeating open stage, pipeline value, grouped count, and conversion logic in page files.
   - Put stage math in a small library with unit tests.

4. Clean marketing tab state.
   - Remove visible Phase 2 / Phase 3 disabled tabs.
   - Replace with real read-only routes or hide routes until implementation.

5. Create an integration signal presenter.
   - Map provider-specific readiness and lead-preview data into a common UI shape.
   - Keep provider-specific auth and consent concerns in integration modules.

## 10. Implementation Slices

### Slice 1: Spec, Refactor, and Cockpit Shell

Deliver:

- this spec
- centralized CRM stage/status presentation metadata
- replacement of hardcoded CRM colors in the existing customer pages touched by the cockpit
- a read-only "Today in revenue" band on `/customer`
- no new database tables

Acceptance:

- no hardcoded hex colors remain in the touched CRM page files
- summary metrics use shared helpers
- the cockpit shows real data from existing models
- empty states are useful but not tutorial-heavy

### Slice 2: Pipeline Stage Inspector

Deliver:

- stage-based opportunity working view
- selected opportunity inspector
- next activity, stage age, expected value, source engagement, linked quote status
- AI launcher topics for deal summary, stale deal diagnosis, and follow-up draft

Acceptance:

- stage movement or stage update records an `Activity`
- stale opportunities are visible without running a report
- no external action is taken by AI without approval

### Slice 3: Signal-to-Engagement Routing

Deliver:

- acquisition signal read model over storefront and one native integration source
- create/link engagement action
- source evidence displayed on the engagement
- duplicate guard using account/contact/source evidence

Recommended first provider: Facebook Lead Ads if OAuth/readiness is available; otherwise storefront inquiry plus Google Business Profile readiness signal.

Acceptance:

- a signal can become an `Engagement` without a separate Lead table
- `Engagement.source` and `sourceRefId` preserve provenance
- the UI distinguishes "signal observed" from "engagement created"

### Slice 4: Marketing Subroute Unlock

Deliver:

- `/customer/marketing/campaigns`
- `/customer/marketing/funnel`
- `/customer/marketing/automation`
- no visible disabled phase navigation

Acceptance:

- Campaigns reads campaign briefs and asset tasks
- Funnel shows channel/source/stage evidence where available
- Automation reads automation candidates and approval posture

### Slice 5: Agentic Sales and Marketing Operations

Deliver:

- sales advisor deal summary and follow-up drafting prompts
- marketing strategist signal review and campaign-brief prompts
- automation candidate suggestions from repeated actions
- integration recommendation prompt based on current strategy and route to market

Acceptance:

- AI creates internal artifacts only through governed tools
- external publish/send/schedule remains approval-gated
- saved artifacts are visible outside chat

## 11. Data and Architecture Decisions

Decision 1: Do not add a `Lead` table.

Reason: Existing DPF CRM research rejects destructive lead conversion. `Engagement` already preserves signal provenance and can link to contact, account, and opportunity.

Decision 2: Do not add `AcquisitionSignal` in the first slice.

Reason: A read model/service is enough to normalize storefront and integration previews. Add a table only when repeated routing, dedup, audit, or lifecycle pressure proves the need.

Decision 3: Do not make marketing automation a separate system.

Reason: Marketing automation candidates already exist and can point to strategy, campaign, and KPI work. External channel execution must remain governed by integration capabilities and consent boundaries.

Decision 4: Keep AI role-specific.

Reason: The customer advisor and marketing strategist see different parts of the work. Cross-domain handoff is useful, but each agent should remain grounded in its route, capability, and tool grants.

Decision 5: Treat UI refactoring as product work.

Reason: Pipedrive's strongest product lesson is adoption through low-friction UX. A visually inconsistent or hardcoded CRM surface would undermine the feature even if the backend works.

## 12. Verification

For doc-only work:

- `git diff --check`
- search for unresolved markers and accidental phase labels in new docs

For implementation slices:

- unit tests for shared helper modules and changed components
- `pnpm --filter web typecheck`
- production build through the project-standard build gate
- UX verification against the Docker-served app at the configured `AUTH_URL` / `APP_URL`, not only `next dev`
- migration verification only if a migration is added

For UI changes:

- verify light mode, dark mode, and branding variables
- confirm no hardcoded color regressions in touched files
- inspect desktop and mobile layouts for clipped text, overlapping cards, and unstable stage columns

For agent changes:

- route contracts confirm `/customer/marketing` resolves to `marketing-specialist`
- tool grants allow internal work-product persistence
- tests assert external publish/send/schedule remains approval-gated

## 13. Open Questions

1. Should the sales-facing AI remain the `customer-advisor`, or should DPF introduce a dedicated sales strategist persona later?
   - Recommendation: keep `customer-advisor` for the first slice, then split only if the route context becomes overloaded.

2. Should the first cockpit appear on `/customer` or only on `/customer/marketing`?
   - Recommendation: start on `/customer`, because the Pipedrive-like value is sales and marketing together. Embed marketing-specific details on `/customer/marketing`.

3. Which integration should prove the signal-to-engagement path first?
   - Recommendation: use storefront inquiry plus one native integration that is already closest to readiness. Prefer Facebook Lead Ads if its preview data is available; otherwise use Google Business Profile readiness signals.

4. When should an `AcquisitionSignal` table be introduced?
   - Recommendation: after the read model needs durable dedup lifecycle, review queues, or cross-provider audit evidence.

## 14. Definition of Done for the First Implementation Plan

The first implementation plan is ready when it:

- names the target branch and worktree
- links this spec and the existing CRM/marketing specs
- uses existing CRM and marketing models first
- reserves explicit refactor tasks
- removes or resolves the disabled marketing phase tabs in the first UI slice
- includes theme-aware UI checks
- includes a UX verification path
- avoids new tables unless a specific slice proves the need
- states the agent approval boundary for all external actions
