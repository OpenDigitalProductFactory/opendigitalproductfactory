# Marketing Execution Loop Design

| Field | Value |
| --- | --- |
| Date | 2026-05-26 |
| Status | Draft for operator review |
| Owners | Mark Bodman, Claude |
| Scope | Content drafter, human-approval queue, channel publishers, inbound responder, KPI pullback, scheduler/autopilot |
| Related specs | `2026-05-26-pipedrive-inspired-crm-marketing-operations-design.md`, `2026-04-24-customer-marketing-workspace-design.md`, `2026-04-11-marketing-specialist-skills-design.md` |
| Related epic | `EP-MARKETING` (in-progress) — extends with new sub-epic `EP-MARKETING-EXEC` |

## 1. Purpose

Driving `/customer/marketing` end-to-end as the CEO of Open Digital Product Factory surfaced a real product gap: the Marketing Strategist coworker captures a high-quality plan (4-week launch arc, weekly campaign briefs, content asset tasks, KPI stack) but **nothing in that plan actually executes**. No LinkedIn post is written. No marketing email is sent. No ad is placed. No inbound inquiry gets a reply. The strategist's own response to "save this to the dashboard" was, until 2026-05-26, "I can't save this" — and even after that fix shipped (PR #1208), the system still only persists planning intent. Execution is a separate substrate that does not yet exist.

This spec defines that execution substrate as one closed loop:

```
plan          ─► draft         ─► human approval   ─► channel publish
(today)          (missing)        (missing)           (missing)
                                                         │
KPI checkpoint ◄─ analytics ────  inbound responder ◄────┘
(today)           (missing)       (missing)
```

The loop is intentionally one architecture, not five disconnected features. Each channel (LinkedIn, email, ads) is a pluggable adapter over the same draft → approve → publish → measure backbone. The strategist already at the top of the loop, the CRM cockpit already at the bottom — what's missing is the middle.

Non-goals:

- Replacing existing strategy capture work (`save_marketing_review`, `create_marketing_campaign_brief`, `create_marketing_asset_task`, `record_marketing_kpi_checkpoint`, `create_marketing_automation_candidate`). They stay as-is; this spec adds the layer that consumes them.
- Replacing the existing Pipedrive-inspired CRM/marketing workspace spec. That spec defines WHAT the user sees and how the pipeline behaves; this spec defines HOW marketing artifacts get produced and reach external channels.
- Building a generic workflow engine. The loop is marketing-specific in vocabulary but the channel-adapter pattern is reusable for other coworker domains (customer-advisor outbound, build-specialist contributor recruitment, etc.) if and when those surface the same gap.
- Removing the human in the loop. Per the marketing-specialist system prompt: "Publishing, sending, scheduling, or changing externally visible marketing requires explicit human approval." Autopilot mode (Phase 5) bounds the human bypass, never eliminates it.

## 2. Current Runtime Grounding

Verified against the live install at `http://localhost:3000` on 2026-05-26 immediately after PR #1208 merged.

**What exists today:**

- `MarketingStrategy`, `MarketingReview`, `MarketingCampaignBrief`, `MarketingAssetTask`, `MarketingKpiCheckpoint`, `MarketingAutomationCandidate` Prisma models. All have `createdByAgentId` provenance and are read from `getMarketingWorkspaceSnapshot()` in [apps/web/lib/marketing.ts](../../../apps/web/lib/marketing.ts).
- `marketing-specialist` agent (`AGT-WS-MARKETING`) defined in [packages/db/data/agent_registry.json](../../../packages/db/data/agent_registry.json) with `marketing_write` grant.
- Strategist tools that capture intent: `save_marketing_review`, `create_marketing_campaign_brief`, `create_marketing_asset_task`, `record_marketing_kpi_checkpoint`, `create_marketing_automation_candidate`. All carry `coworkerArtifact: true` (PR #1208) so they're callable in advise mode.
- `MarketingStrategyOverview` component renders "Campaign briefs", "Proof and content tasks", "KPI checkpoints", "Automation candidates" panels on `/customer/marketing`.
- `revenue-cockpit.ts` already counts `campaignBriefsOpen` + `assetTasksOpen` into the CRM cockpit summary.
- Integration catalog (`apps/web/lib/tools/native-integration-catalog.ts`) already lists HubSpot, Google Marketing Intelligence, Facebook Lead Ads, Google Business Profile, Mailchimp — but none are wired beyond catalog metadata.
- No `MarketingAssetDraft`, `MarketingApproval`, `MarketingPublishedAsset`, `MarketingInboundReply`, `MarketingScheduledPublish` models exist.
- No LinkedIn / email / ads OAuth flows exist in `/admin/integrations`.
- No `draft_marketing_asset`, `publish_*`, `respond_to_inquiry`, `pull_channel_kpis` tools exist.
- The `MarketingAutomationCandidate.description` field explicitly states: *"This does not publish, send, or schedule anything; external actions still require approval."* — the candidate is intent capture, not an executor.

**What this means for design:** the strategy layer is already present and well-shaped. The loop's missing middle slots in on top of existing models — `MarketingAssetTask` becomes the upstream input to a new `MarketingAssetDraft`, and `MarketingKpiCheckpoint` becomes the downstream sink for channel analytics. No prior models need refactoring.

## 3. Research and Benchmarking

Per the DPF design-research kernel principle, this section reviews open-source and commercial precedent. References are to canonical project documentation, not abstract patterns.

### 3.1 Open-source precedent

- **Mautic** (`mautic/mautic`) — OSS marketing automation. Campaign builder modelled as DAG (`Campaign` → `Event` → `Decision/Action/Condition`). Channel actions include email, SMS, web push, focus item. Approval workflow exists as `published`/`unpublished` flag on the campaign, not a per-action gate. Adapter pattern: each channel is a plugin bundle with a `EventSubscriber` listening to campaign events. Patterns worth adopting: event-bus contract between campaign engine and channel plugins; explicit `Stat` table per channel (sent / bounced / opened / clicked). Anti-pattern to reject: weak per-action approval — the whole campaign goes live in one toggle, which is too coarse for DPF's principle.

- **listmonk** (`knadh/listmonk`) — OSS mailing list manager (newsletters + transactional). Narrow scope. Strengths: clean SMTP-queue abstraction with retry, bounce-back webhook handling, segment-based audience selection. The `Campaign` model has explicit `status` enum (`draft / scheduled / running / paused / cancelled / finished`) — this is exactly the state machine we want on `MarketingAssetDraft`. Pattern worth adopting: status enum + audit trail. Limitation: no AI drafter — the human writes copy in a Markdown/HTML editor.

- **n8n** (`n8n-io/n8n`) — workflow automation with first-party LinkedIn, Gmail, Postmark, SendGrid, Google Ads, Facebook Lead Ads nodes. Each integration is a versioned `node` with `credentials` schema + `operations` list. Pattern worth adopting: per-integration credentials schema + capability surface, mirrored in our `Integration` model. n8n's "execute when approved" is a manual user click in the editor — doesn't match our queue, but the integration shape is reusable.

- **Postal** (`postalserver/postal`) — OSS mail server with HTTP API for sending and inbound webhooks. Useful as a self-hostable Postmark-equivalent for DPF installs that don't want to use a SaaS email provider. Inbound message webhook → JSON → handler is the right shape for the inbound responder phase.

### 3.2 Commercial precedent

- **Buffer** (publishing only) — best-in-class publish queue UX. Patterns to adopt: side-by-side preview (raw markdown vs. rendered LinkedIn / X / Threads) at the approval step; calendar view of "queued for posting"; click-to-reschedule; per-channel posting window. Anti-pattern to reject: no LLM drafter — Buffer assumes you wrote the post yourself. Our queue must show "drafted by marketing-specialist 2 minutes ago, awaiting review" provenance.

- **Lemlist** (outbound + sequences) — sequence-as-graph with per-step gating. Each step (LinkedIn connection / LinkedIn message / email A / email B / wait) has its own approval and per-prospect personalization. Pattern to adopt: sequence graph with branches, where each node is a `MarketingAssetTask` plus optional wait/condition. Worth adopting: AI-personalization that fills `{{firstName}}` style tokens from CRM context before approval, so the human reviews the actual personalized output, not a template.

- **Customer.io** (multi-channel orchestration) — `Broadcast` (one-shot) vs. `Campaign` (triggered) distinction. Channels = delivery nodes. "Review and activate" is the only gate. Patterns to adopt: distinction between one-shot (a single LinkedIn post) and triggered (auto-reply to inbound inquiry); per-channel delivery telemetry table. Anti-pattern: "activate once, run forever" — DPF expects re-review per planning cycle.

- **HubSpot Breeze** (AI content generation across the marketing suite) — LLM drafter for blog posts, social posts, emails, ad copy. Outputs land directly in the publishing surface as draft. Patterns to adopt: drafter takes brief + brand voice + audience context and produces channel-specific output with channel-appropriate length / hashtag conventions / CTA shape. Anti-pattern to reject: HubSpot's "everything in one giant suite" — we keep the loop composable and conduit-only.

- **Beehiiv** (newsletter + paid acquisition) — bundles email outbound with paid traffic acquisition for newsletter growth. KPI loop is tight: subscriber growth → engagement → ad spend ROI. Pattern worth adopting: per-asset attribution from inquiry / subscriber back to source campaign, surfaced in CRM. Not a primary model for DPF since it's newsletter-specific.

### 3.3 Patterns adopted, adapted, rejected

**Adopt:**

- listmonk's `MarketingAssetDraft.status` state machine (`draft / pending-review / approved / rejected / scheduled / published / failed`).
- Buffer's side-by-side preview at the approval step.
- Lemlist's per-step approval gating within a sequence.
- n8n's `IntegrationCredential` shape per channel adapter.
- Customer.io's one-shot vs. triggered distinction (`scheduled_publish` vs. `auto_responder`).
- Mautic's event-bus contract between drafter and channel adapter.
- HubSpot Breeze's channel-aware drafter (different prompt for LinkedIn vs. email vs. ad copy).

**Adapt:**

- Mautic's campaign DAG → we represent the 4-week strategist plan as a sequence of `MarketingAssetTask`s, where the existing `dueWindow` field acts as the schedule. We don't need a new DAG model; the strategist's plan already encodes the structure.
- Lemlist's sequence graph → start with linear sequences (week 1 → week 2 → week 3 → week 4). Branch/condition support is a Phase 5 nice-to-have, not a Phase 1 requirement.
- HubSpot's drafter → DPF's drafter is a coworker tool, not a hidden internal service. Outputs are auditable AgentMessage + ToolExecution rows.

**Reject:**

- Mautic's coarse-grained campaign approval (whole campaign on/off). DPF approves per asset.
- Bring-your-own-server-with-our-creds patterns. Per DPF's conduit-not-broker principle, every channel adapter requires the customer to bring their own OAuth token / SMTP creds / ad account. DPF never enrolls as partner, never escrows credentials, never proxies API calls through DPF-owned accounts.
- Implicit approval ("activate once, run forever"). Each external action requires a fresh human approval until the user explicitly opts that channel into bounded autopilot (Phase 5).
- One-giant-suite UX (HubSpot). The loop stays composable: drafter can be invoked from chat OR from a one-click button next to an asset task; approval queue can be reviewed in the marketing workspace OR consumed via the existing dashboard / inbox surfaces.

## 4. Architecture

### 4.1 The loop

```
┌─────────────────────────┐
│ marketing-specialist    │  strategist plans, persists MarketingAssetTask
│   (existing)            │
└─────────────┬───────────┘
              │
              ▼  draft_marketing_asset(taskId)
┌─────────────────────────┐
│ content-drafter agent   │  new agent: takes brief + brand voice + context
│   (new, Phase 1)        │  produces channel-shaped body, saves as
└─────────────┬───────────┘  MarketingAssetDraft(status=pending-review)
              │
              ▼
┌─────────────────────────┐
│ MarketingApprovalQueue  │  human reviews, edits in-place, approves/rejects
│   (new, Phase 1)        │  audit trail of who approved, what text changed
└─────────────┬───────────┘
              │ approved
              ▼
┌─────────────────────────┐
│ channel publisher       │  per-channel adapter: LinkedIn (P2), Email (P3),
│   (new, P2-P4)          │  Ads (P4). Uses customer's own OAuth/creds.
└─────────────┬───────────┘  Writes MarketingPublishedAsset on success.
              │ published
              ▼
┌─────────────────────────┐
│ channel analytics pull  │  per-channel KPI fetcher (post engagement,
│   (new, Phase 4)        │  email opens, ad CPC). Writes into existing
└─────────────┬───────────┘  MarketingKpiCheckpoint records.
              │
              ▼
┌─────────────────────────┐
│ marketing-specialist    │  next cycle: strategist reads checkpoints,
│   (existing)            │  rewrites plan, loop continues.
└─────────────────────────┘
```

Inbound side (Phase 3+):

```
inbound email/DM ─► webhook ─► inquiry-responder agent ─► MarketingInboundReply
                                                           (status=pending-review)
                                                            │
                                                            ▼
                                              MarketingApprovalQueue (shared)
                                                            │
                                                            ▼ approved
                                              outbound channel publisher
                                                            │
                                                            ▼ delivered
                                              CRM Engagement created/updated
```

### 4.2 Channel adapter contract

Every channel adapter implements one shape (mirrors n8n's node contract but DPF-flavoured):

```typescript
interface MarketingChannelAdapter {
  readonly channelId: string;             // "linkedin" | "email-postmark" | "linkedin-ads" | ...
  readonly displayName: string;
  readonly capabilities: ChannelCapability[]; // ["publish-post", "send-email", "place-ad", "fetch-engagement"]
  readonly credentialsSchema: JsonSchema; // OAuth scopes or API key shape
  readonly assetTypes: string[];          // ["linkedin-post", "linkedin-article", ...]

  publish(draft: MarketingAssetDraft, creds: ChannelCredential): Promise<PublishResult>;
  fetchEngagement?(publishedAsset: MarketingPublishedAsset, creds: ChannelCredential): Promise<EngagementSnapshot>;
  receiveInbound?(payload: unknown, creds: ChannelCredential): Promise<InboundMessage[]>;
}
```

The adapter lives in `apps/web/lib/marketing/channels/<channel-id>/index.ts` and is registered via the existing tool-evaluation pipeline before going live. Every adapter is small (< 300 lines) because all the loop logic (drafting, approval, scheduling, analytics) lives in the platform, not the adapter.

### 4.3 Reusability beyond marketing

The same `Drafter → ApprovalQueue → ChannelPublisher → AnalyticsPull` shape applies to other coworker domains:

- `customer-advisor` outbound to existing customers (renewal nudges, NPS surveys)
- `build-specialist` contributor recruitment (starter-issue invitations, contributor-of-the-month posts)
- `ops-coordinator` status communications (incident postmortems published externally)

To avoid premature abstraction, Phase 1 builds the marketing-specific tables and tool surface concretely. When the second domain hits the same gap, the substrate is generalized in a follow-up refactor (per the platform's 20% refactoring budget). Models will be named generically (`OutboundDraft`, `ApprovalQueueItem`) but seeded with `domain="marketing"` so the first cut isn't marketing-coupled at the schema level.

## 5. Data Model Changes

All additions, no breaking changes. Each Phase only adds the models it needs.

### 5.1 Phase 1 (drafter + approval queue)

```prisma
// New: durable draft of a marketing asset, produced by the content-drafter
model MarketingAssetDraft {
  draftId          String   @id @default(cuid())
  organizationId   String
  strategyId       String?
  assetTaskId      String?  // upstream MarketingAssetTask if drafted from a brief
  status           String   // pending-review | approved | rejected | scheduled | published | failed
  channelId        String   // "linkedin" | "email-postmark" | "linkedin-ads" | ...
  assetType        String   // "linkedin-post" | "linkedin-article" | "email" | "ad-headline" | ...
  body             String   @db.Text // the actual content the human reviews
  bodyFormat       String   // "markdown" | "html" | "plain"
  metadata         Json?    // channel-specific: subject line, hashtags, link preview, ad targeting
  createdByAgentId String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  assetTask        MarketingAssetTask? @relation(fields: [assetTaskId], references: [taskId])
  strategy         MarketingStrategy?  @relation(fields: [strategyId],   references: [strategyId])
  approvals        MarketingApproval[]
  publishes        MarketingPublishedAsset[]

  @@index([organizationId, status])
  @@index([assetTaskId])
}

// New: explicit human-approval event with full audit trail
model MarketingApproval {
  approvalId       String   @id @default(cuid())
  draftId          String
  reviewerUserId   String
  decision         String   // approved | rejected | needs-changes
  editedBody       String?  @db.Text // if reviewer edited inline before approval
  notes            String?  @db.Text
  decidedAt        DateTime @default(now())

  draft            MarketingAssetDraft @relation(fields: [draftId], references: [draftId])

  @@index([draftId])
  @@index([reviewerUserId])
}
```

### 5.2 Phase 2 (LinkedIn publishing)

```prisma
model MarketingPublishedAsset {
  publishedId      String   @id @default(cuid())
  draftId          String
  channelId        String
  externalId       String   // LinkedIn post URN, email message-id, ad creative id
  externalUrl      String?  // shareable URL where visible
  publishedAt      DateTime @default(now())
  publishedByUserId String  // person who approved the publish
  channelMetadata  Json?    // raw response from the channel API for audit

  draft            MarketingAssetDraft @relation(fields: [draftId], references: [draftId])

  @@unique([channelId, externalId])
  @@index([draftId])
}
```

Plus a `ChannelCredential` (or extension of existing `Integration`) to store the customer's OAuth refresh token for LinkedIn. See §7 for conduit posture.

### 5.3 Phase 3 (email + inbound)

```prisma
model MarketingInboundReply {
  inboundId         String   @id @default(cuid())
  channelId         String
  externalThreadId  String   // email thread id, LinkedIn conversation id
  fromAddress       String   // email / linkedin profile / handle
  subject           String?
  body              String   @db.Text
  receivedAt        DateTime @default(now())
  classification    String?  // "qualified-inquiry" | "spam" | "support" | "other"
  routedToEngagementId String?
  draftedReplyId    String?  // optional drafter output

  @@index([channelId, receivedAt])
  @@index([classification])
}
```

### 5.4 Phase 4 (KPI pullback)

No new model required. Channel analytics pulled into existing `MarketingKpiCheckpoint`. Add fields to `MarketingPublishedAsset`:

```prisma
// added in Phase 4 migration
lastEngagementPolledAt   DateTime?
lastEngagementSnapshot   Json?      // {impressions, likes, comments, clicks, ...}
```

### 5.5 Phase 5 (scheduler + autopilot)

```prisma
model MarketingScheduledPublish {
  scheduleId       String   @id @default(cuid())
  draftId          String   @unique
  scheduledFor     DateTime
  status           String   // pending | fired | cancelled | failed
  firedAt          DateTime?
  autopilotPolicyId String?

  @@index([scheduledFor, status])
}

model MarketingAutopilotPolicy {
  policyId         String   @id @default(cuid())
  channelId        String
  autoApproveBelow Int?     // auto-approve drafts under N words / ad spend
  autoPublishAfter Int?     // minutes after draft creation if no human review
  weeklyCeiling    Int      // hard cap on publishes per week
  spendCeilingCents Int?    // ad-channel daily / weekly cap
  enabledByUserId  String
  enabledAt        DateTime @default(now())

  @@unique([channelId])
}
```

## 6. The Five Phases

### Phase 1 — Content drafter + approval queue (no external channel)

**Scope.** Single PR. New `MarketingAssetDraft` + `MarketingApproval` models + migration. New `content-drafter` coworker agent (or a tool on the existing `marketing-specialist` — TBD in implementation plan, see Open Questions). New `draft_marketing_asset(assetTaskId)` MCP tool. New approval-queue panel on `/customer/marketing` showing pending drafts with inline edit + approve / reject buttons. Output: the human sees a polished LinkedIn post body in the workspace, ready to copy-paste to LinkedIn.

**Acceptance.** From the existing "Week 1 LinkedIn Post Asset: Top 5 AI Workflow Leaks Teardown" asset task, the strategist (or a one-click button next to the task) calls `draft_marketing_asset`. Within 30 seconds, a `MarketingAssetDraft` row exists with a full LinkedIn-shaped post body. The body appears in the new "Awaiting your review" panel. Mark clicks Approve. Status moves to `approved`. No external API call yet.

**Build gate.** Unit tests for the draft state machine. Production build. UX verification: drive the actual flow as Mark and confirm the post body is ready-to-paste quality.

### Phase 2 — LinkedIn publish via personal OAuth

**Scope.** New `/admin/integrations/linkedin` page with OAuth flow. `Integration` row stores customer's refresh token. New `publish_to_linkedin` tool gated by `approved` draft status. New `MarketingPublishedAsset` row on success with LinkedIn post URN. Approval-queue panel grows a "Publish to LinkedIn" button (only enabled for `approved` drafts in `linkedin` channel).

**Acceptance.** Mark connects his LinkedIn account in `/admin/integrations`. Mark approves the Phase 1 draft. Mark clicks "Publish to LinkedIn". Within 5 seconds, the post is live on his LinkedIn feed. The post URL is captured in `MarketingPublishedAsset.externalUrl` and surfaces in the workspace as "Published 2026-MM-DD by Mark Bodman" with a link.

**Conduit posture.** OAuth scopes requested: `w_member_social` only (post on member's own behalf). No company-page write, no ads-account access (those are separate scopes for Phase 4). DPF never enrolls as partner with LinkedIn; we use LinkedIn's standard OpenID Connect + Marketing Developer Platform self-service application. The customer's refresh token is encrypted at rest with the install's `AUTH_SECRET`.

### Phase 3 — Email outbound + inbox responder

**Scope.** Email adapter (Postmark by default, SMTP fallback). Outbound: `send_marketing_email` tool gated by `approved` draft. Inbound: webhook endpoint `/api/integrations/email/inbound` accepting Postmark or generic IMAP-relay payloads → `MarketingInboundReply` → `respond_to_inquiry` agent classifies + drafts a reply → reply goes through the same approval queue. Qualified inquiries create/update `Engagement` rows in the existing CRM.

**Acceptance.** Mark connects a Postmark account in `/admin/integrations`. Mark sends a test outbound email through the flow (draft → approve → send). Mark sends a test reply to the configured inbound address. Within 30 seconds the reply appears in the marketing inbox panel, classified as `qualified-inquiry` if appropriate, with a drafted reply pending Mark's approval. Approval triggers the outbound send.

### Phase 4 — Ads with hard spend gates + KPI pullback

**Scope.** LinkedIn Ads + Google Ads adapters. Per-campaign spend cap (in cents, hard ceiling). Each ad-spend action requires fresh approval — there is no "approve once, spend forever" path even with autopilot. KPI pullback job (hourly cron): per published asset, fetch engagement / open rate / CPC and update `MarketingKpiCheckpoint`. Dashboard shows real numbers.

**Acceptance.** Mark connects LinkedIn Ads. Mark drafts an ad creative, approves it, sets a $20 daily ceiling, approves the spend. Ad goes live. Within 24 hours the dashboard shows impressions / clicks / cost-per-click pulled from LinkedIn Ads API into `MarketingKpiCheckpoint`. Spend never exceeds the ceiling (verified by integration test against ads API sandbox).

### Phase 5 — Scheduler + bounded autopilot

**Scope.** Calendar surface showing all `MarketingScheduledPublish` rows. Auto-fire of drafter agents N days before each `MarketingAssetTask.dueWindow` start. `MarketingAutopilotPolicy` per channel with bounded auto-approval (e.g. "auto-approve LinkedIn posts under 250 words written by `marketing-specialist`, hard ceiling 5 posts per week, no auto-approval for ad spend ever"). Override always available to the human.

**Acceptance.** Mark sets a LinkedIn policy: auto-publish 24h after draft if no human review, max 3 posts/week. Mark goes on vacation. Week 2's content tasks fire automatically. Mark returns to find 3 LinkedIn posts published with full audit trail (who/what/when, including "auto-approved by policy MAUP-xxx"). Mark can disable the policy with one click; in-flight scheduled publishes pause until re-approved.

## 7. Conduit Posture / Bring-Your-Own-Credentials

DPF is a conduit, never a broker. This means:

- Every external integration requires the customer's own account at the third party (LinkedIn, Postmark, Google Ads, etc.).
- The customer completes OAuth or supplies API credentials through `/admin/integrations`. DPF never escrows credentials in a DPF-owned vault and never proxies calls through a DPF-owned account.
- Each channel's API key / refresh token is encrypted at rest with the install's local `AUTH_SECRET`. Rotation of `AUTH_SECRET` rotates all stored credentials.
- DPF never enrolls as a Partner / Developer with the third-party service in a way that gives the DPF organization shared access to customer data. Standard self-service developer apps only.
- This makes DPF-as-product self-hostable: the install owns its data, owns its credentials, owns its publishing rights. Cloud-hosted DPF works the same way — each tenant's credentials are siloed.

This rule is non-negotiable per the kernel principle. Any phase that tries to shortcut it (e.g. "we'll set up a DPF LinkedIn app and proxy customer posts through it") gets rejected at design review.

## 8. Approval Queue Design

**Surface.** New panel on `/customer/marketing`, plus the existing dashboard's notification feed gets entries when drafts are awaiting review. Approval queue items also surface in the CRM cockpit's "next actions" list.

**Item shape.** Each pending item shows:
- Channel + asset type pill (LinkedIn post / Email / LinkedIn ad / etc.)
- Source: which `MarketingAssetTask` this draft is for, which campaign brief
- Drafted by: agent name + timestamp
- Side-by-side: brief (left) vs. drafted body (right) — Buffer-inspired
- Inline-editable body field (markdown for posts, rich text for emails)
- Buttons: **Approve**, **Approve with edits**, **Request changes** (sends back to drafter with notes), **Reject**

**Audit trail.** Every approval/rejection writes a `MarketingApproval` row. If the reviewer edited the body before approving, the edited text is stored as `editedBody` and that becomes the published version. The original `draft.body` is preserved for comparison.

**Permission model.** Reusing existing platform role permissions: `operate_marketing` capability required to approve. `view_marketing` to view the queue. No new capability surface needed.

## 9. KPI Pullback Contract

Per channel, the adapter implements `fetchEngagement(publishedAsset, creds)` returning an `EngagementSnapshot`:

```typescript
interface EngagementSnapshot {
  channelId: string;
  externalId: string;
  polledAt: Date;
  metrics: Record<string, number>; // impressions, likes, comments, shares, clicks, opens, cpc, etc.
  raw: unknown; // channel-specific payload for forensics
}
```

A platform-wide hourly cron (existing inngest scheduler) walks `MarketingPublishedAsset` rows still inside their analytics window (default: 30 days post-publish), calls `fetchEngagement`, persists the snapshot, and aggregates into `MarketingKpiCheckpoint` rows on the rolling cadence the strategist set. Stale snapshots (> 30 days) stop being polled.

The strategist's next chat turn already reads `MarketingKpiCheckpoint` via `get_marketing_summary`, so once Phase 4 lands, the next "plan review" turn sees real numbers automatically.

## 10. Risks and Mitigations

- **External API rate limits.** LinkedIn personal-profile posting is rate-limited (~25 posts/day, much less for ads). Mitigation: per-channel rate-limit window enforced by the adapter; approval queue surfaces "would exceed channel rate limit" warnings before approve.
- **Account suspension from spam-like patterns.** Cold outbound at volume gets accounts banned. Mitigation: Phase 5 autopilot policies have weekly ceilings that default conservative (e.g. 5 LinkedIn posts/week, 100 emails/week). Hard-coded floor on ceiling values prevents user mis-configuration. Ad accounts get even tighter spend caps.
- **Content quality from LLM drafter.** Bad drafts erode trust faster than no drafts. Mitigation: the drafter agent has a focused system prompt with brand-voice slot, audience profile, and channel-specific style guide. Approval queue is the safety net. Drafter outputs always include "draft confidence" self-assessment (low / medium / high) — anything `low` is flagged for explicit review even under autopilot.
- **Credential leakage.** Encrypted-at-rest with `AUTH_SECRET` mitigates filesystem exposure; per-tenant siloing mitigates cross-tenant. We do NOT log credentials, response bodies containing tokens, or OAuth redirect URLs. Adapter test fixtures use redacted tokens.
- **Inbound responder hallucinating commitments.** An auto-drafted reply to a prospect could promise things the org can't deliver. Mitigation: inbound auto-reply is ALWAYS gated through the approval queue (never autopilot, even in Phase 5). The drafter is forbidden from making commitments — its prompt limits it to "I'll check with the team and follow up by X date" style holding patterns.
- **Inbound spam volume.** Inbound webhook hits could be expensive (LLM classification per message). Mitigation: rule-based spam pre-filter (DKIM/SPF, sender reputation, prior-relationship check) runs before LLM classification. Adapter's `receiveInbound` returns the pre-filtered batch.
- **Scope creep.** It's tempting to add SMS, push, voice, etc. Mitigation: each new channel is its own PR, follows the adapter contract, and goes through the existing tool-evaluation pipeline. No "add 5 channels in one PR."

## 11. Verification Approach

Per build-gate-mandatory:

- **Unit tests.** State-machine transitions for `MarketingAssetDraft.status`. Approval audit-trail invariants. Per-adapter mock tests covering happy path + auth failure + rate-limit failure.
- **Integration tests.** Phase 2+ adapters tested against vendor sandbox accounts when available (LinkedIn has a sandbox via Marketing Developer Platform; Postmark and Google Ads both expose test modes).
- **UX verification.** Per phase, drive the actual flow against the running portal as the CEO and confirm end-to-end behavior. Documented in the phase's plan doc.
- **Spend-cap invariant test (Phase 4).** Explicit test that places enough ad-spend requests to exceed the ceiling and confirms the adapter refuses, not approves.

## 12. Open Questions

1. **Drafter as new coworker vs. tool on marketing-specialist?** Option A: introduce a `content-drafter` coworker (`AGT-WS-CONTENT-DRAFTER`) that the strategist delegates to. Pros: cleaner separation of strategy vs. craft; reusable across other coworker domains. Cons: more agent overhead, more prompt engineering. Option B: add `draft_marketing_asset` as another tool on `marketing-specialist`. Pros: minimal change, same chat. Cons: muddles strategist's role. Lean: Option A long-term, but Phase 1 can start as Option B and split out in Phase 5 when other domains adopt the substrate.
2. **Where does the inbound email actually arrive?** Per-install MX records via Postmark inbound-only addresses (`<install>@inbound.postmarkapp.com`) keep the customer not having to point DNS. Alternative: customer provides a forwarding rule from their existing inbox. Lean: support both, default to Postmark inbound-only for first-run simplicity.
3. **Should the approval queue have an SLA?** A draft sitting unreviewed for 7 days is stale. Auto-expire after N days? Auto-notify the reviewer at day 2? Lean: auto-notify at 48h, hard-expire at 14 days with `status=stale`. Configurable per install.
4. **Multi-tenant credential sharing inside one org.** If two users on the same install both connect LinkedIn, do they each get their own connection or share one org-level connection? Lean: per-user for posting (each user posts to their own profile); per-org for ads / shared mailbox / company page. Aligns with how LinkedIn's API auth works anyway.
5. **Does the strategist need to know about published asset performance to plan?** Yes (Phase 4 KPI pullback closes that loop). Until Phase 4, the strategist has to ask the user for numbers verbally, which is the current state.

## 13. Implementation Plan Pointer

Per the platform's "spec → plan → BIs" discipline, each phase gets its own implementation plan at `docs/superpowers/plans/2026-05-26-marketing-execution-loop-phase-<N>.md` once this spec is operator-approved. A new epic `EP-MARKETING-EXEC` (sibling of `EP-MARKETING`) holds the five phase-level backlog items.

## 14. Definition of Done for this Spec

- Operator (Mark) reviews and approves on PR.
- `EP-MARKETING-EXEC` epic exists in the live backlog with five sized backlog items.
- Phase 1's implementation plan is drafted and ready to enter Build Studio (or to be implemented directly while BS is non-functional, per the time-bound override in memory).
- The marketing-specialist's system prompt is updated to mention the drafter delegation path and the approval queue once Phase 1 ships.
