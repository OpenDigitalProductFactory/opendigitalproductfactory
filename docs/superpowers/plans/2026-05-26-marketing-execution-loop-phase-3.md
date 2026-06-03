# Marketing Execution Loop — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans / dpf-platform:dpf-writing-plans. Tasks use checkbox syntax.

**Goal:** Second external channel — email — with the inbound responder loop wired through the same approval queue Phase 1/2 already use. Operator brings a Postmark account; DPF stores the server token encrypted, sends outbound from approved drafts, accepts inbound from the Postmark inbound webhook, classifies + drafts a reply, queues for human approval.

**Architecture:** New `email-postmark` channel adapter implementing the same `OutboundChannelAdapter` contract Phase 2 established. New `InboundChannelMessage` Prisma model captures parsed inbound webhook payloads with a `classification` (rule-based pre-filter + LLM classifier). The inbound responder is a small server-side service that runs on each new `InboundChannelMessage`: it classifies, optionally creates a new `OutboundDraft(sourceType="inbound-channel-message", assetType="reply")` in `pending-review`, and links a qualified inquiry into the existing `Engagement` CRM model. Postmark is chosen over Mailchimp because it natively supports both outbound + inbound webhooks in one product with the simplest possible auth (server token API key, no OAuth).

**Reference spec:** `docs/superpowers/specs/2026-05-26-marketing-execution-loop-design.md` §6.3 + §7 Phase 3.

---

## UX Architecture Fit Gate

- **Feature:** Send approved email drafts; classify inbound replies; queue a drafted response for human approval.
- **Owning area:** Business > Customer > Marketing (publish + inbound) and Platform > Tools > Integrations (one-time connection).
- **Primary route family:** `/customer/marketing` (Publish + Inbound panels) + `/platform/tools/integrations/email-postmark` (connection page).
- **Primary persona:** Mark Bodman as CEO managing both outbound campaigns and inbound founder inquiries.
- **Job the first viewport helps complete:** "See replies that came in overnight, review the drafted responses, send the ones I approve."
- **Navigation layer touched:** local route + contextual action only.
- **Existing component or pattern reused:** `MailchimpConnectPanel` shape for the connection page. Approval queue panel grows a single new "Inbound replies" section using the same `DraftRow` shape Phase 1 introduced, so reply drafts approve through the same code path as outbound drafts.
- **New component justified because:** `EmailPostmarkConnectPanel` mirrors the Mailchimp one but stores a Postmark server token + signing secret pair. `PublishEmailButton` mirrors `PublishLinkedInButton` for the approved-email row.
- **Source-of-truth model or service:** `InboundChannelMessage` (new) records the inbound. The existing `OutboundDraft` carries the reply (with `sourceType="inbound-channel-message"`, `sourceId=inboundId`). `OutboundPublication` records each outbound send including the externalId returned by Postmark.
- **Empty state behavior:** "No inbound replies in the last 30 days. Send an outbound email or configure the inbound webhook in your Postmark server to start the loop."
- **Failure / unavailable behavior:** Postmark API failures classify as retryable vs. permanent the same way the LinkedIn adapter does. Inbound webhook signature verification failure returns 401 and writes a `ToolExecution` row for audit; no `InboundChannelMessage` is created.
- **AI or coworker action boundary:** auto-classify + auto-draft an inbound reply is internal — those are `coworkerArtifact: true`. Sending the reply is gated by human approval — no `OutboundAutopilotPolicy` can auto-approve inbound replies per spec §13.
- **Theme and layout checks:** all colors via `var(--dpf-*)` tokens.
- **Routes to verify:** `/customer/marketing` + `/platform/tools/integrations/email-postmark` + the inbound webhook `POST /api/integrations/email-postmark/inbound`.

---

## Phase 0: Branch and Substrate Guard

- [x] Worktree on `feat/marketing-execution-loop-phase-3`, branched from `origin/main`.
- [x] Substrate sweep — no existing `InboundChannelMessage` model, no `email-postmark` integration.
- [x] Re-read the spec §6.3 + §7 Phase 3.

## Phase 1: Prisma Model + Migration

- [ ] Add `InboundChannelMessage` to `packages/db/prisma/schema.prisma`. Domain discriminator carries forward the substrate pattern from Phase 1/2.
- [ ] Hand-author migration `packages/db/prisma/migrations/20260527020000_marketing_execution_inbound_channel_message`. Apply to live `dpf-postgres-1` + record in `_prisma_migrations`.
- [ ] Regenerate Prisma client.

## Phase 2: Postmark Client

- [ ] New file `apps/web/lib/marketing/channels/email-postmark/client.ts` covering exactly three Postmark endpoints:
  - `POST /email` — send a transactional email.
  - `POST /email/batch` — TODO Phase 4 (batch send for campaigns).
  - HMAC verification of the inbound webhook payload using the operator's stored signing secret.
- [ ] Mockable via a `fetchImpl` parameter like the LinkedIn client.

## Phase 3: Email Channel Adapter

- [ ] New folder `apps/web/lib/marketing/channels/email-postmark/`.
  - `adapter.ts` implements `OutboundChannelAdapter`:
    - `validateDraft` rejects bodies > 100 KB, unsupported `assetType` (only `email` and `marketing-email` accepted Phase 3), missing subject (per `metadata.subject` or first markdown line `# subject`).
    - `publish` extracts subject + body, calls `client.sendEmail` with `From=metadata.from`, `To=metadata.to`, `Subject=...`, `HtmlBody`/`TextBody`. Returns `PublishResult` with `externalId` = Postmark's `MessageID`.
    - `EMAIL_MOCK_MODE=1` env flag mirrors `LINKEDIN_MOCK_MODE` for staging verification.
  - `tests/adapter.test.ts` — mocked-fetch happy path, 401 invalid token, 422 malformed payload, 429 retryable, missing-subject rejection.

## Phase 4: Inbound Webhook + Responder

- [ ] New API route `apps/web/app/api/integrations/email-postmark/inbound/route.ts`:
  - Reads raw body for HMAC verification.
  - Verifies signature with the operator's stored signing secret.
  - On valid signature: parses Postmark inbound JSON shape, writes one `InboundChannelMessage(domain="marketing", channelId="email-postmark")`.
  - Triggers responder (fire-and-forget).
  - Returns 200 to Postmark (acks the webhook).
- [ ] New service `apps/web/lib/marketing/channels/email-postmark/responder.ts`:
  - Rule-based pre-filter: from non-existent SPF/DKIM domains → spam, no-reply addresses → discard, our own outbound bounce → discard.
  - Pre-filter survivors run through an LLM classifier (`marketing-specialist` prompt extended with classification step) — returns one of `qualified-inquiry | support | spam | other`.
  - Qualified-inquiry: creates or links to an `Engagement` row with `source="marketing-inbound"`, `sourceRefId=inboundId`.
  - Drafts the reply: a holding-pattern message keyed by classification. Reply prompt FORBIDS making any commitment beyond "I'll check with the team and follow up by X date" — per spec §13.
  - Persists the reply as `OutboundDraft(sourceType="inbound-channel-message", sourceId=inboundId, channelId="email-postmark", assetType="email", status="pending-review", body=...)`.

## Phase 5: send_marketing_email MCP Tool

- [ ] New `send_marketing_email(draftId)` MCP tool in `apps/web/lib/mcp-tools.ts`. Same shape as `publish_to_linkedin` — gated by `operate_marketing` capability and approved draft status. Goes through `publishApprovedDraft` (already domain-agnostic from Phase 2).
- [ ] `TOOL_TO_GRANTS["send_marketing_email"] = ["marketing_write"]`.
- [ ] Marketing-specialist prompt updated to mention the email send path with the same "never publish without human approval" gate.

## Phase 6: Integration Catalog + Connect Page

- [ ] Add `email-postmark` to `NATIVE_INTEGRATIONS` + the `NativeIntegrationId` union.
- [ ] New page `apps/web/app/(shell)/platform/tools/integrations/email-postmark/page.tsx` with `EmailPostmarkConnectPanel` (server token + signing secret + reply-to address). API-key only — no OAuth.
- [ ] Server actions: `saveEmailPostmarkAction(form)` (encrypts and saves), `disconnectEmailPostmarkAction()`.

## Phase 7: Approval Queue Inbound Reply Section

- [ ] Extend `getMarketingWorkspaceSnapshot()` to surface:
  - `inboundMessages: InboundChannelMessage[]` (last 30 days, ordered by `receivedAt desc`).
  - `pendingReplyDrafts`: subset of `pendingDrafts` with `sourceType="inbound-channel-message"` so the UI can render them as "Reply needed" rows with the original inbound preview.
- [ ] Update `ApprovalQueuePanel` to render a third section "Replies waiting for you" between the existing two sections.
- [ ] Approval flow reuses the existing `approveOutboundDraftAction` → `publishApprovedDraft` path. Publishing an approved reply fires `send_marketing_email`.

## Phase 8: Tests

- [ ] `apps/web/lib/marketing/channels/email-postmark/adapter.test.ts`.
- [ ] `apps/web/lib/marketing/channels/email-postmark/responder.test.ts` — rule-based pre-filter happy path, spam pre-filter, qualified-inquiry creates Engagement, classifier failure returns "other" not a hard failure.
- [ ] `apps/web/lib/marketing/channels/registry.test.ts` — extend with `email-postmark` resolution.
- [ ] `apps/web/app/api/integrations/email-postmark/inbound/route.test.ts` — invalid signature returns 401 + no DB write, valid signature creates `InboundChannelMessage` + fires responder.

## Phase 9: Build Gate

- [ ] vitest passing for the marketing surface.
- [ ] `pnpm --filter web typecheck` clean.
- [ ] `pnpm --filter web exec next build` exit 0.
- [ ] Migration applies on `dpf-postgres-1`.

## Phase 10: UX Verification

- [ ] `EMAIL_MOCK_MODE=1` exercise: seed connected `email-postmark` credential + approved `OutboundDraft(channelId=email-postmark)`, publish via the new tool, verify `OutboundPublication` row.
- [ ] Inbound webhook exercise: POST a synthetic Postmark inbound payload signed with the stored secret, verify `InboundChannelMessage` written + reply draft queued + `Engagement` row when qualified.

## Phase 11: Ship + Operator Handoff

- [ ] DCO-signed commit, push branch.
- [ ] Open PR titled "feat(marketing): execution loop Phase 3 — email outbound + inbox responder".
- [ ] Squash-merge.
- [ ] Rebuild portal.
- [ ] Operator setup doc at `docs/operations/integrations/email-postmark-setup.md` covering Postmark account creation, server token, signing secret, inbound webhook URL configuration.

---

## Definition of Done

- All Phase 3 build-gate steps pass.
- Email channel adapter passes unit tests for happy path + error classification.
- Inbound webhook verifies signature, writes `InboundChannelMessage`, fires responder.
- Reply drafts flow through the same approval queue and same publish service as outbound drafts.
- `BI-FBC9BA03` flipped to `done`.
- Operator handoff doc landed.
