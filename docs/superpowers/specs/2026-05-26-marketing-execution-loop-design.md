# Marketing Execution Loop Design

| Field | Value |
| --- | --- |
| Date | 2026-05-26 |
| Review pass | 2026-05-27 chief-architect / UX review |
| Status | Revised draft for operator review |
| Owners | Mark Bodman, Claude, Codex review |
| Scope | Drafter, approval queue, channel publishers, inbound responder, KPI pullback, scheduler/autopilot |
| Related specs | `2026-05-26-pipedrive-inspired-crm-marketing-operations-design.md`, `2026-04-24-customer-marketing-workspace-design.md`, `2026-04-11-marketing-specialist-skills-design.md` |
| Related backlog | `EP-MARKETING` is live and in-progress; `EP-CRM-MKT-OPS` is also live and in-progress. Proposed execution epic: `EP-MARKETING-EXEC`, not yet created in live backlog. |

## 1. Purpose

Driving `/customer/marketing` end-to-end as the CEO of Open Digital Product Factory surfaced the product gap: the Marketing Strategist can now persist a high-quality plan, but the platform still stops before execution. It can save strategy, campaign briefs, asset tasks, KPI checkpoints, and automation candidates. It does not yet draft the LinkedIn post, route it through approval, publish it, answer inbound replies, or pull channel performance back into the next planning cycle.

This spec defines the missing execution loop:

```text
MarketingStrategy / MarketingAssetTask
  -> outbound draft
  -> human approval
  -> channel publish/send
  -> inbound response, where applicable
  -> KPI pullback
  -> next Marketing Strategist review
```

The loop is one architecture, not a bundle of unrelated channel features. LinkedIn posts, email campaigns, ads, and inbound replies should use the same draft -> approve -> publish/send -> measure backbone. Channel adapters provide provider-specific behavior; the platform owns state, approvals, audit, scheduling, and UX.

Non-goals:

- Replacing existing strategy capture tools: `save_marketing_review`, `create_marketing_campaign_brief`, `create_marketing_asset_task`, `record_marketing_kpi_checkpoint`, and `create_marketing_automation_candidate`.
- Replacing the Pipedrive-inspired CRM/marketing workspace spec. That spec defines the daily working surfaces; this spec defines the execution substrate those surfaces can call.
- Building a generic workflow engine. This is an outbound execution loop with bounded channel adapters, not arbitrary automation.
- Removing the human in the loop. External publishing, sending, scheduling, ad spend, public profile changes, and customer-facing replies require explicit human approval until a bounded policy allows a specific low-risk path.

## 2. Current Runtime Grounding

This review re-verified repo state in `D:\DPF\.claude\worktrees\keen-mclaren-5fff2e` on 2026-05-27. MCP backlog access was available; MCP spec search did not return this branch-only document.

What exists today:

- Live backlog includes `EP-MARKETING` in progress with nine items and `EP-CRM-MKT-OPS` in progress with five items.
- `packages/db/prisma/schema.prisma` already has `MarketingStrategy`, `MarketingReview`, `MarketingCampaignBrief`, `MarketingAssetTask`, `MarketingKpiCheckpoint`, and `MarketingAutomationCandidate`.
- `apps/web/lib/marketing.ts` owns the marketing enum catalogs, artifact builders, and `getMarketingWorkspaceSnapshot()`.
- `apps/web/lib/mcp-tools.ts` exposes `get_marketing_summary`, `suggest_campaign_ideas`, `save_marketing_review`, `create_marketing_campaign_brief`, `create_marketing_asset_task`, `record_marketing_kpi_checkpoint`, `create_marketing_automation_candidate`, and `analyze_seo_opportunity`.
- The write tools require `operate_marketing` platform capability and map to the agent grant `marketing_write` through `apps/web/lib/tak/agent-grants.ts`.
- `/customer/marketing` resolves to `marketing-specialist` with a prompt that explicitly allows internal drafting/work-product creation but requires human approval for external publish, send, schedule, or public changes.
- `MarketingStrategyOverview` renders campaign briefs, asset tasks, KPI checkpoints, and automation candidates on `/customer/marketing`.
- `apps/web/lib/crm/revenue-cockpit.ts` already counts open campaign briefs, asset tasks, and automation candidates into the customer/revenue attention model.
- `apps/web/lib/tools/native-integration-catalog.ts` includes HubSpot, Google Marketing Intelligence, Facebook Lead Ads, Facebook Pages, Google Business Profile, and Mailchimp. It does not include LinkedIn or Postmark.
- `IntegrationCredential` already exists as the encrypted polymorphic credential table for native integrations. It uses `fieldsEnc` and `tokenCacheEnc` encrypted by `apps/web/lib/govern/credential-crypto.ts` with `CREDENTIAL_ENCRYPTION_KEY`, not `AUTH_SECRET`.
- `AgentActionProposal` and `ToolExecution` already exist. They should be reused for audit/proposal linkage where possible, but they do not by themselves provide a route-owned marketing approval queue.

### 2.1 Strategy grounding had no write path (BI-06BB96F0, closed 2026-08-27)

A defect this section's original inventory did not surface. `recordMarketingStrategistReview()` in `apps/web/lib/marketing.ts` is the only `prisma.marketingStrategy.update` call in the codebase, and its payload covers seven fields: `status`, `primaryChannels`, `secondaryChannels`, `reviewCadence`, `lastReviewedAt`, `nextReviewAt`, `specialistNotes`.

It never wrote `targetSegments`, `idealCustomerProfiles`, `proofAssets`, `differentiators`, `constraints`, `geographicScope` or `seasonalityNotes`. Those were populated once at bootstrap and were then unreachable for the life of the install — no tool, server action or UI could set them.

That mattered because the drafter reads exactly those fields: `draft-builder.ts` takes `targetSegments[0]`, falls back to `idealCustomerProfiles[0]`, and reads `proofAssets[0]`. On an install where the bootstrap derived nothing, every generated asset was built against an empty audience with no proof — the mechanism behind generic marketing output. `determineStaleAreas()` already reported "Target segments need definition", so the platform could diagnose the gap and had no way to close it.

Closed by `record_marketing_grounding` (`apps/web/lib/mcp/marketing-grounding-tool.ts`) over `apps/web/lib/marketing/strategy-grounding.ts`. Two decisions worth keeping written down:

- **Grounding is separate from a review.** A review is the strategist's periodic recommendation and supersedes the last one. Grounding is the durable business fact underneath it — who this organization serves, and what proof it has. Different authors (the operator knows the grounding, the coworker proposes the review), different lifetimes, different truth conditions. They are not folded into one write.
- **Only supplied fields are written.** An interview runs over several turns, so a later round must never blank what an earlier one established. An empty string is treated as "no answer given" rather than an instruction to erase.

`assessMarketingGrounding()` is the paired read: it reports which of the three drafter-critical fields are still empty, and distinguishes an untouched archetype bootstrap (`lastReviewedAt === null` on a row carrying a `sourceSummary`) from a plan someone edited and left incomplete, so the refusal copy can be accurate about which one the operator is looking at.

What is missing:

- No durable outbound draft model.
- No marketing approval queue item/decision model.
- No published/sent asset record that links a draft to an external id/url.
- No scheduler/autopilot policy for outbound execution.
- No inbound marketing message/reply loop.
- No LinkedIn publishing connector or OAuth page.
- No Postmark inbound/outbound connector in the native catalog.
- No external marketing publish/send MCP tools.

Design implication: existing marketing models should remain the planning source of truth. Execution should sit downstream of `MarketingAssetTask`, link back to existing strategy/campaign records, and feed metrics into `MarketingKpiCheckpoint`. The new durable concepts should not be named only for marketing if they are inherently shared outbound execution concepts.

## 3. Research and Benchmarking

Sources checked for this review:

- [Mautic campaigns overview](https://docs.mautic.org/en/5.2/campaigns/campaigns_overview.html) and [Mautic developer campaign docs](https://developer.mautic.org/)
- [listmonk campaign API docs](https://listmonk.app/docs/apis/campaigns/)
- [n8n credentials docs](https://docs.n8n.io/credentials/) and [custom operations docs](https://docs.n8n.io/integrations/custom-operations/)
- [Buffer Publish](https://buffer.com/publish) and [Buffer draft approval docs](https://support.buffer.com/article/665-managing-and-approving-draft-posts)
- [Customer.io campaign concepts](https://docs.customer.io/journeys/campaigns-in-customerio/)
- [HubSpot Breeze social post generation docs](https://knowledge.hubspot.com/social/use-hubspots-ai-assistant-to-create-social-posts)
- [Postmark manual](https://postmarkapp.com/manual)
- [LinkedIn Posts API docs](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-04)

Patterns to adopt:

- listmonk's explicit campaign status transitions, adapted to outbound draft states.
- Buffer's approval queue and side-by-side review experience for social posts.
- n8n's separation between credential schemas, operations, and node/adaptor capabilities.
- Customer.io's distinction between one-shot broadcasts and triggered campaigns.
- Postmark's JSON inbound webhook shape for email replies.
- HubSpot Breeze's channel-aware drafting inside the work surface.
- Mautic's event/plugin idea, adapted as small channel adapters rather than a broad workflow builder.

Patterns to reject:

- Whole-campaign approval toggles. DPF needs per-asset and per-spend approval.
- One giant marketing suite UX. The first screen must remain a calm operations surface under `/customer/marketing`.
- Credential brokerage. DPF connector code may exist, but the install owns third-party accounts, OAuth apps where required, API keys, tokens, and stored credentials.
- "Activate once, run forever" automation. Autopilot is a bounded policy with audit, ceilings, and stop controls.

## 4. Product and UX Principles

1. Strategy remains first. Execution starts from saved strategy, campaign brief, or asset task context.
2. The first viewport is operational: pending approvals, scheduled items, recent sends/publishes, and KPI movement. No hero, no marketing landing page, no explanatory card stack.
3. No-surprise AI. Clicking a metric, tab, card, or pending item navigates or opens review; it does not silently send a coworker prompt or publish anything.
4. AI may draft and prepare internal artifacts through governed tools. External channel effects require explicit approval and produce audit evidence.
5. Channel adapters stay small. Drafting, approval, scheduling, and metrics are platform services.
6. Existing CRM and marketing models are reused before adding new tables.
7. UI uses DPF theme variables only. No hardcoded colors, inline status hex, disabled future tabs, or nested cards.
8. The implementation budget reserves roughly 20 percent for refactoring shared presentation, state machines, and integration helpers.

## 5. Architecture

### 5.1 Loop

```text
marketing-specialist
  creates MarketingCampaignBrief / MarketingAssetTask
        |
        v
draft_marketing_asset(taskId)
        |
        v
OutboundDraft(status = pending-review, domain = marketing)
        |
        v
Approval queue on /customer/marketing
        |
        v
publish/send tool gated by approved draft + connected credential
        |
        v
OutboundPublication + ToolExecution audit
        |
        v
engagement/KPI pullback into MarketingKpiCheckpoint
        |
        v
next strategist review sees real performance
```

Inbound path:

```text
channel webhook / inbox poll
  -> InboundChannelMessage(domain = marketing)
  -> responder drafter
  -> OutboundDraft(status = pending-review, kind = reply)
  -> same approval queue
  -> approved send
  -> CRM Engagement/Activity linkage where qualified
```

### 5.2 Channel Adapter Contract

Every adapter implements the same shape:

```typescript
interface OutboundChannelAdapter {
  readonly channelId: string;
  readonly displayName: string;
  readonly capabilities: Array<
    "draft-preview" | "publish-post" | "send-email" | "place-ad" | "fetch-engagement" | "receive-inbound"
  >;
  readonly credentialIntegrationId: string;
  readonly credentialsSchema: JsonSchema;
  readonly assetTypes: string[];

  validateDraft(draft: OutboundDraft): AdapterValidationResult;
  publish?(draft: OutboundDraft, credential: IntegrationCredential): Promise<PublishResult>;
  fetchEngagement?(publication: OutboundPublication, credential: IntegrationCredential): Promise<EngagementSnapshot>;
  receiveInbound?(payload: unknown, credential: IntegrationCredential): Promise<InboundMessage[]>;
}
```

Adapters live under `apps/web/lib/marketing/channels/<channel-id>/`. New third-party channels must pass the existing tool evaluation and native integration review before side-effecting operations ship.

### 5.3 Substrate Reuse Decision

Use generic execution model names now, with marketing as the first domain:

- `OutboundDraft`
- `OutboundApprovalDecision`
- `OutboundPublication`
- `InboundChannelMessage`
- `ScheduledOutboundAction`
- `OutboundAutopilotPolicy`

Reason: draft, approval, publication, inbound message, schedule, and autopilot are not marketing-only concepts. Customer-advisor follow-ups, operations status updates, contributor recruitment messages, and customer-facing support replies will need the same substrate. Starting with generic names avoids a later rename migration while still keeping Phase 1 behavior scoped to `/customer/marketing`.

This is not a generic workflow engine. The generic layer is only for outbound/inbound communication execution with strongly typed domain references and channel adapters.

## 6. Data Model Changes

All status fields added by this work must have matching typed catalogs in a new `apps/web/lib/marketing/execution.ts` (or similarly scoped module) and matching MCP/tool schema enum arrays in the same implementation PR.

### 6.1 Phase 1: Draft and Approval Queue

```prisma
model OutboundDraft {
  draftId          String   @id @default(cuid())
  organizationId   String
  domain           String   // marketing
  sourceType       String   // marketing-asset-task | marketing-campaign-brief | inbound-channel-message | manual
  sourceId         String?
  strategyId       String?
  status           String   // draft | pending-review | approved | rejected | needs-changes | stale
  channelId        String   // linkedin-personal | mailchimp | postmark | facebook-pages | ...
  assetType        String   // linkedin-post | email | ad-creative | reply
  body             String   @db.Text
  bodyFormat       String   // markdown | html | plain
  metadata         Json?
  createdByAgentId String?
  originalPromptId String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  approvals        OutboundApprovalDecision[]
  publications     OutboundPublication[]

  @@index([organizationId, domain, status])
  @@index([sourceType, sourceId])
  @@index([channelId, status])
}

model OutboundApprovalDecision {
  decisionId       String   @id @default(cuid())
  draftId          String
  reviewerUserId   String
  decision         String   // approved | rejected | needs-changes
  editedBody       String?  @db.Text
  notes            String?  @db.Text
  decidedAt        DateTime @default(now())

  draft            OutboundDraft @relation(fields: [draftId], references: [draftId], onDelete: Cascade)

  @@index([draftId])
  @@index([reviewerUserId, decidedAt])
}
```

Phase 1 does not call external APIs. It proves the loop from `MarketingAssetTask` to reviewable content and approval audit.

### 6.2 Phase 2: Publication Record

```prisma
model OutboundPublication {
  publicationId      String   @id @default(cuid())
  draftId            String
  channelId          String
  credentialId       String?
  externalId         String
  externalUrl        String?
  publishedAt        DateTime @default(now())
  publishedByUserId  String
  toolExecutionId    String?
  channelMetadata    Json?
  lastMetricsPolledAt DateTime?
  lastMetricsSnapshot Json?

  draft              OutboundDraft @relation(fields: [draftId], references: [draftId], onDelete: Cascade)

  @@unique([channelId, externalId])
  @@index([draftId])
  @@index([channelId, publishedAt])
}
```

`credentialId` points to `IntegrationCredential.id`. `toolExecutionId` should be populated when the publish/send tool executes, giving `/platform/ai/authority` a cross-cutting audit trail.

### 6.3 Phase 3: Inbound Messages

```prisma
model InboundChannelMessage {
  inboundId          String   @id @default(cuid())
  organizationId     String
  domain             String   // marketing
  channelId          String
  externalThreadId   String
  externalMessageId  String?
  fromAddress        String?
  fromDisplayName    String?
  subject            String?
  body               String   @db.Text
  receivedAt         DateTime @default(now())
  classification     String?  // qualified-inquiry | support | spam | other
  routedEngagementId String?
  metadata           Json?

  @@index([organizationId, domain, receivedAt])
  @@index([channelId, externalThreadId])
  @@index([classification])
}
```

Inbound responder drafts use `OutboundDraft(sourceType = "inbound-channel-message", sourceId = inboundId, assetType = "reply")`.

### 6.4 Phase 5: Scheduling and Autopilot

```prisma
model ScheduledOutboundAction {
  scheduleId        String   @id @default(cuid())
  draftId           String   @unique
  scheduledFor      DateTime
  status            String   // pending | paused | fired | cancelled | failed
  firedAt           DateTime?
  autopilotPolicyId String?

  @@index([scheduledFor, status])
}

model OutboundAutopilotPolicy {
  policyId           String   @id @default(cuid())
  organizationId      String
  domain              String   // marketing
  channelId           String
  enabled             Boolean  @default(false)
  autoApproveBelow    Int?
  autoPublishAfterMin Int?
  weeklyCeiling       Int
  spendCeilingCents   Int?
  enabledByUserId     String
  enabledAt           DateTime @default(now())

  @@unique([organizationId, domain, channelId])
}
```

No autopilot policy can approve ad spend, inbound customer replies, public profile changes, or content below the drafter confidence threshold.

## 7. Implementation Phases

### Phase 1: Drafter + Approval Queue, No External Channel

Deliver:

- `OutboundDraft` and `OutboundApprovalDecision` migrations.
- `draft_marketing_asset(assetTaskId)` tool, side-effecting but internal only.
- Approval queue panel on `/customer/marketing`.
- Inline editing, Approve, Request changes, Reject.
- Reusable draft status helpers and tests.

Acceptance:

- Starting from an existing `MarketingAssetTask`, the user can create a channel-shaped draft.
- A pending draft appears in `/customer/marketing`.
- Approving with no edits and approving with edits both write an `OutboundApprovalDecision`.
- No external API call happens.
- The first viewport remains scan-first and does not become a tutorial/landing page.

### Phase 2: LinkedIn Personal Publishing

Deliver:

- Native integration descriptor for LinkedIn personal publishing, e.g. `linkedin-personal-social`.
- `/platform/tools/integrations/linkedin-personal-social` connection page.
- `publish_to_linkedin` tool gated by approved draft status, `operate_marketing`, `marketing_write`, and connected credentials.
- `OutboundPublication` creation on success.

Acceptance:

- An approved LinkedIn draft can be published through the connected user's credential.
- The workspace shows external URL, channel id, publisher, and timestamp.
- Publish failure leaves the draft approved but not published, with an actionable error.
- The LinkedIn adapter requests only the minimum needed scope for personal posting, currently `w_member_social` per LinkedIn Posts API docs.

### Phase 3: Email Outbound + Inbound Responder

Deliver:

- Preferred first path: use the existing Mailchimp Marketing descriptor for marketing campaign context if it can support the target email operation.
- If reply/inbound webhook support is required, add a new Postmark native integration descriptor and run tool evaluation before write operations.
- `send_marketing_email` tool gated by approved draft.
- `/api/integrations/email/inbound` or provider-specific webhook endpoint that creates `InboundChannelMessage`.
- Responder drafter that creates a pending reply draft; approval triggers outbound send.
- Qualified inbound messages link to `Engagement` and `Activity` where evidence exists.

Acceptance:

- Test outbound email follows draft -> approval -> send -> publication audit.
- Test inbound email creates an inbound message row, classifies it, drafts a reply, and queues the reply for human review.
- Inbound replies are never autopilot-approved.

### Phase 4: Ads + KPI Pullback

Deliver:

- LinkedIn Ads and/or Google Ads adapter only after the required native integration review.
- Hard spend ceiling per campaign/action.
- Hourly metrics pullback into `OutboundPublication.lastMetricsSnapshot`.
- Aggregation or copied checkpoint notes into existing `MarketingKpiCheckpoint`.

Acceptance:

- Ad creation requires explicit approval of creative, audience, and spend ceiling.
- Attempting to exceed the spend ceiling is rejected before API call.
- KPI pullback writes visible evidence used by the next Marketing Strategist review.

### Phase 5: Scheduler + Bounded Autopilot

Deliver:

- Calendar/list view of scheduled outbound actions.
- Auto-draft ahead of `MarketingAssetTask.dueWindow`.
- Autopilot policy with conservative defaults, weekly ceilings, and one-click disable.
- Clear audit labels for policy-approved actions.

Acceptance:

- Scheduled drafts pause when credentials disconnect, policies disable, or channel validation fails.
- Autopilot never applies to ads, inbound replies, public profile changes, or low-confidence drafts.
- The user can see and stop in-flight scheduled actions without opening chat.

## 8. UX Architecture Fit Gate

Before Phase 1 implementation, the plan must answer:

```text
Feature:
Owning area: Business > Customer > Marketing
Primary route family: /customer/marketing
Primary persona: Marketing Strategist
Job the first viewport helps complete:
Navigation layer touched: local route / contextual action only
Existing component or pattern reused:
New component justified because:
Source-of-truth model or service:
Empty state behavior:
Failure / unavailable behavior:
AI or coworker action boundary:
Theme and layout checks:
Routes to verify:
Evidence required before merge:
```

Guardrails:

- Do not add global AppRail, Workspace, or Platform navigation.
- Do not use vendor-branded language in product UI. "LinkedIn" may appear as a channel; "Pipedrive-inspired" stays in research docs.
- No disabled future tabs. Show only implemented routes or meaningful read-only routes.
- Every approval item must have a clear source, channel, action, and risk.
- The approval action is a button; metric tiles and attention items navigate only.
- Empty states must say what is missing and offer one next action, not a wall of zeros.

## 9. Approval Queue Design

Surface: `/customer/marketing`, with notification/attention links from the customer revenue cockpit when pending items exist.

Item shape:

- Channel and asset type.
- Source work product: asset task, campaign brief, inbound message, or manual draft.
- Drafted by: agent name, timestamp, and optional ToolExecution link.
- Brief/context pane.
- Rendered preview pane for channel-specific shape.
- Editable body.
- Actions: Approve, Approve with edits, Request changes, Reject.
- After approval, a separate Publish/Send/Schedule action appears only when the needed channel credential is connected.

Interaction design:

- Keep list rows compact and stable. Open a drawer or focused panel for editing long copy.
- Use icons for compact controls where lucide icons exist; labels stay on destructive or externally visible actions.
- Minimum 44px touch targets.
- Visible focus states and keyboard order matching visual order.
- No text overlapping badges, previews, or buttons at mobile widths.
- Use `text-[var(--dpf-text)]`, `text-[var(--dpf-muted)]`, `bg-[var(--dpf-surface-1)]`, `bg-[var(--dpf-surface-2)]`, `border-[var(--dpf-border)]`, and `bg-[var(--dpf-accent)]` only. The sole `text-white` exception is on accent buttons.

Audit behavior:

- Original draft body stays immutable unless a regeneration action explicitly creates a new draft revision.
- Reviewer edits are stored on the approval decision and become the effective published body.
- Publish/send tools record `ToolExecution` and link the result to `OutboundPublication`.
- External failures do not erase approval history.

## 10. Credential and Conduit Posture

DPF is a conduit, not a broker:

- Every side-effecting channel requires the customer's own third-party account and credential.
- Credentials use the existing `IntegrationCredential` model, `fieldsEnc`, `tokenCacheEnc`, and `CREDENTIAL_ENCRYPTION_KEY` encryption path.
- The platform should not store channel secrets in new marketing-specific tables.
- Connector setup must make clear when the customer must create or authorize a third-party developer app.
- DPF connector code may support a provider; DPF must not proxy customer traffic through a DPF-owned account or shared broker credential.
- Credential health and key-rotation failure states must surface as "reconnect this integration" before publish/send buttons become active.

## 11. KPI Pullback Contract

Per channel, the adapter can implement:

```typescript
interface EngagementSnapshot {
  channelId: string;
  externalId: string;
  polledAt: Date;
  metrics: Record<string, number>;
  raw: unknown;
}
```

An hourly scheduler walks recent `OutboundPublication` rows still inside their analytics window, calls `fetchEngagement`, updates `lastMetricsSnapshot`, and rolls meaningful metrics into existing `MarketingKpiCheckpoint` records or checkpoint notes.

Default analytics window: 30 days after publish/send. After that, snapshots stop polling unless the user refreshes manually.

## 12. Refactor Budget

Reserve roughly 20 percent of implementation effort for refactoring that keeps this architecture clean.

Required refactor targets:

1. Create a small marketing execution state module for draft, approval, publication, inbound, schedule, and autopilot statuses. Do not scatter string literals across pages, tools, and tests.
2. Reuse `IntegrationCredential`, native integration descriptors, and credential health helpers. Do not create marketing-specific credential custody.
3. Extract channel-adapter registration and validation helpers before adding the second channel.
4. Converge approval queue UI with existing DPF review/attention patterns where they fit; document any new component family before creating it.
5. Centralize channel label/tone/icon metadata. Do not hardcode provider badges in page files.
6. Add tests around state transitions before adding external API behavior.

## 13. Risks and Mitigations

- External API volatility and scope gates. Mitigation: each channel adapter has a connection readiness check, mock tests, and a blocked state that disables publish/send before API call.
- Overpromising LinkedIn access. Mitigation: Phase 2 must verify the connected app and scope path before implementation is considered ready.
- Account suspension from spam-like patterns. Mitigation: conservative channel defaults, weekly ceilings, and no cold-outbound autopilot.
- Content quality. Mitigation: channel-specific drafter prompt, brand/context slots, confidence flag, and mandatory review for low-confidence drafts.
- Credential leakage. Mitigation: existing encrypted credential substrate, no secret logging, redacted fixtures, and credential health checks.
- Inbound responder hallucinating commitments. Mitigation: inbound replies always go through approval and the prompt forbids promises beyond safe holding language.
- Cost blowup from inbound classification. Mitigation: rule-based pre-filter before LLM classification.
- Scope creep. Mitigation: one channel per PR after Phase 1 unless the second channel only exercises the same already-proven substrate.

## 14. Verification Approach

Doc-only closeout:

- `git diff --check`
- Search for unresolved placeholder markers and unsupported future-state claims.

Implementation closeout:

- Unit tests for draft/approval/publication/schedule state transitions.
- Unit tests for channel validation, auth failure, rate limits, and spend ceilings.
- `pnpm --filter web typecheck`
- `pnpm --filter web exec next build` or the current project-standard production build command.
- Migration deploy verification for each migration phase.
- UX verification against the Docker-served app at `AUTH_URL` / `APP_URL`.

UI verification:

- Desktop and mobile checks for `/customer/marketing`.
- Light mode, dark mode, and brand token checks.
- No hardcoded colors in touched files.
- No clipped text in badges, queue rows, editor controls, or publish buttons.
- Keyboard approval flow works without mouse.

Agent/tool verification:

- Route contracts still resolve `/customer/marketing` to `marketing-specialist`.
- Internal draft tools are callable only with the correct capability/grant.
- Publish/send tools require approved draft status and connected credentials.
- External side-effect tools create `ToolExecution` evidence.

## 15. Open Questions

1. Should Phase 1 expose `draft_marketing_asset` only through a button next to asset tasks, through chat, or both?
   - Recommendation: both, but the button is the primary UX proof. Chat can call the same tool.

2. Should LinkedIn personal publishing be Phase 2, or should the first external channel be Mailchimp because it already exists in the native catalog?
   - Recommendation: keep LinkedIn as Phase 2 only if app/scope verification is done before implementation. Otherwise use Mailchimp/Postmark email as the first external proof.

3. Does the first approval queue need a dedicated route?
   - Recommendation: start as a panel on `/customer/marketing`; add `/customer/marketing/approvals` only when volume justifies it.

4. Should `OutboundDraft` revisions be modeled as separate rows or version rows?
   - Recommendation: separate draft rows for regenerated alternatives; approval decisions preserve edits for the approved version. Add draft revision rows only if copy iteration becomes noisy.

5. When should `EP-MARKETING-EXEC` be created?
   - Recommendation: after operator approval of this revised spec. Link it to `EP-MARKETING` and `EP-CRM-MKT-OPS` rather than burying the execution work under either parent.

## 16. Implementation Plan Pointer

After operator approval, create phase plans at:

- `docs/superpowers/plans/2026-05-26-marketing-execution-loop-phase-1.md`
- `docs/superpowers/plans/2026-05-26-marketing-execution-loop-phase-2.md`
- and so on only as each phase becomes ready.

Phase 1 should be the next implementation plan. It must include the UX Architecture Fit Gate, the refactor budget tasks, migration scope, typed status catalogs, tests, and Docker-served UX verification.

## 17. Definition of Done for this Spec

- Operator reviews and approves the revised spec.
- Live backlog has a scoped `EP-MARKETING-EXEC` epic or an explicit decision to attach Phase 1 to an existing epic.
- Phase 1 implementation plan exists and is ready for Build Studio or direct implementation.
- The Marketing Strategist prompt is updated after Phase 1 ships to mention the drafter and approval queue.
- No implementation starts until the Phase 1 plan identifies the target worktree/branch and confirms no unrelated dirty files will be touched.
