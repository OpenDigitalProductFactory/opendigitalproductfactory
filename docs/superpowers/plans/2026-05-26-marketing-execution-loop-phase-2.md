# Marketing Execution Loop — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Tasks use checkbox syntax.

**Goal:** First external channel for the marketing execution loop — LinkedIn personal publishing via the operator's own LinkedIn developer app, with `w_member_social` scope, gated by an approved `OutboundDraft`. Phase 2 ships the OAuth handshake, the LinkedIn channel adapter, the `publish_to_linkedin` MCP tool, and the **Publish** button on the approval queue. No mass-channel support yet, no ad spend, no autopilot.

**Architecture:** Reuse `IntegrationCredential` for credential storage (encrypted via `CREDENTIAL_ENCRYPTION_KEY`). Reuse `OAuthPendingFlow` for the transient state + code-verifier (integration id serves as the flow's `providerId` discriminator — string column, no FK). New `OutboundPublication` Prisma model captures `externalId`/`externalUrl`/`publishedAt`/`publishedByUserId`/`toolExecutionId` per publish. New channel-adapter contract at `apps/web/lib/marketing/channels/contracts.ts` lays the foundation for Phase 3+ adapters (email, ads).

**Reference spec:** [`docs/superpowers/specs/2026-05-26-marketing-execution-loop-design.md`](../specs/2026-05-26-marketing-execution-loop-design.md) §6.2 + §7 Phase 2 + §10 + §13.

**Tech Stack:** Next.js app router, server components + small client islands, Prisma 7 migration, Vitest, LinkedIn REST API (`/v2/userinfo` + `/v2/ugcPosts` or `/rest/posts`), existing IntegrationCredential + OAuth helpers.

**Conduit posture:** Customer brings their own LinkedIn developer app. DPF never enrolls as partner. Scopes requested: `openid profile email w_member_social` only. Refresh tokens encrypted at rest in `IntegrationCredential.tokenCacheEnc`.

---

## UX Architecture Fit Gate

- **Feature:** Publish an approved marketing draft to the operator's LinkedIn feed.
- **Owning area:** Business > Customer > Marketing (publish action) and Platform > Tools > Integrations (one-time connection).
- **Primary route family:** `/customer/marketing` (Publish button) + `/platform/tools/integrations/linkedin-personal-social` (connection page).
- **Primary persona:** Mark Bodman as CEO operating his own LinkedIn for OpenDigitalProductFactory.
- **Job the first viewport helps complete:** "Push the LinkedIn draft I just approved to my LinkedIn feed."
- **Navigation layer touched:** local route + contextual action only.
- **Existing component or pattern reused:** `MailchimpConnectPanel` shape for the connection page (form + connection status). Approval queue row gains a single new button next to the existing **Review** control once a draft is `approved` and a LinkedIn credential is connected. Existing `IntegrationCredential` substrate, `credential-crypto` helpers, OAuth state/verifier helper.
- **New component justified because:** there is no shared "publish to channel" button; introducing `PublishLinkedInButton` once means Phases 3-4 can mirror the same shape with their own adapter selection.
- **Source-of-truth model or service:** `OutboundPublication` (new) records the result. `OutboundDraft.status` flips `approved → published` on success. `IntegrationCredential(integrationId="linkedin-personal-social")` holds the OAuth tokens.
- **Empty state behavior:** when no LinkedIn credential is connected, the Publish button is replaced with a tooltip-linked "Connect LinkedIn first" prompt that deep-links to the integration page.
- **Failure / unavailable behavior:** publish failure leaves the draft `approved` (NOT `published`), surfaces the actionable error in the queue row + writes a `ToolExecution` row with the error reason for audit.
- **AI or coworker action boundary:** the agent may CALL `publish_to_linkedin` only on `approved` drafts with connected credentials. The button click is the only authorized publish trigger from the UI.
- **Theme and layout checks:** all colors via `var(--dpf-*)` tokens.
- **Routes to verify:** `/customer/marketing` + `/platform/tools/integrations/linkedin-personal-social` desktop + mobile.
- **Evidence required before merge:** unit tests (state-machine + adapter mocking + scope assertion), production build green, mock-mode publish flow exercised end-to-end (without live LinkedIn API call — that's operator-side once they bring their own app).

---

## Phase 0: Branch and Substrate Guard

- [x] Worktree on `feat/marketing-execution-loop-phase-2`, branched from `origin/main`.
- [x] Substrate sweep: confirm no existing `OutboundPublication` model:
  ```bash
  grep -n "model OutboundPublication" packages/db/prisma/schema.prisma
  ```
- [x] Re-read [`docs/superpowers/specs/2026-05-26-marketing-execution-loop-design.md`](../specs/2026-05-26-marketing-execution-loop-design.md) §6.2, §7 Phase 2, §10, §13.

## Phase 1: Prisma Model + Migration

- [ ] Add `OutboundPublication` to `packages/db/prisma/schema.prisma`. `credentialId` is a string pointer to `IntegrationCredential.id` (no FK to keep the substrate decoupled per spec §5.3). `toolExecutionId` populated by the publish tool for cross-audit with `/platform/ai/authority`.

- [ ] Hand-author migration at `packages/db/prisma/migrations/20260527010000_marketing_execution_outbound_publication/migration.sql` (Prisma migrate dev requires interactive shadow DB; mirror the format used by Phase 1's migration).

- [ ] Apply migration to live `dpf-postgres-1` and record in `_prisma_migrations`.

- [ ] Regenerate Prisma client.

## Phase 2: Channel Adapter Contracts

- [ ] New file `apps/web/lib/marketing/channels/contracts.ts` declaring:
  - `OutboundChannelAdapter` interface (mirrors spec §5.2)
  - `PublishResult`, `EngagementSnapshot`, `InboundMessage`, `AdapterValidationResult` value types
  - `ChannelCapability` enum

- [ ] New file `apps/web/lib/marketing/channels/registry.ts` exporting `getAdapter(channelId)` lookup. Phase 2 registers exactly one adapter: `linkedin-personal-social`.

## Phase 3: LinkedIn Channel Adapter

- [ ] New folder `apps/web/lib/marketing/channels/linkedin-personal-social/` containing:
  - `client.ts` — small fetch wrapper for the two LinkedIn endpoints we use:
    - `GET https://api.linkedin.com/v2/userinfo` → `{ sub: string, name: string, email?: string }` → resolves the member URN `urn:li:person:{sub}`.
    - `POST https://api.linkedin.com/v2/ugcPosts` → submits the post, returns `{ id: "urn:li:share:..." }`. External URL is derived: `https://www.linkedin.com/feed/update/${id}/`.
  - `adapter.ts` — implements `OutboundChannelAdapter`:
    - `validateDraft` rejects bodies > 3000 chars (LinkedIn's hard limit), unsupported `assetType` (only `LinkedIn post` and `linkedin-post` accepted in Phase 2), or missing connected credential.
    - `publish` calls `client.fetchUserInfo()` to discover the member URN, then `client.publishUgcPost(body)`. Returns `PublishResult` with `externalId`, `externalUrl`, raw response.
    - `fetchEngagement` — TODO stub for Phase 4; throws "not implemented in Phase 2".
  - `tests/adapter.test.ts` — mocks `fetch` and validates: happy publish path, 401 → returns auth error (no throw, no partial publication), rate-limit 429 → returns retryable error, scope assertion (we only pass `w_member_social` plus the OIDC trio).

## Phase 4: Credential Custody + OAuth Flow

- [ ] Extend `apps/web/lib/tools/native-integration-catalog.ts` with the LinkedIn personal social descriptor:
  ```typescript
  {
    id: "linkedin-personal-social",
    integrationId: "linkedin-personal-social",
    provider: "linkedin",
    name: "LinkedIn (personal publishing)",
    description: "Publish approved marketing drafts to your own LinkedIn feed. You bring your own LinkedIn developer app and OAuth credentials; DPF stores the refresh token encrypted in this install.",
    href: "/platform/tools/integrations/linkedin-personal-social",
    category: "marketing",
    pricingModel: "paid",
    model: "native",
    tags: ["marketing", "social", "publish", "linkedin"],
    enables: ["Publish marketing draft to LinkedIn feed"],
    relevantAgentIds: ["marketing-specialist"],
    requiredGrantKeys: ["marketing_write"],
  }
  ```

- [ ] Update the `NativeIntegrationId` union to include `"linkedin-personal-social"`.

- [ ] New file `apps/web/lib/marketing/channels/linkedin-personal-social/oauth.ts`:
  - `startLinkedInOAuth({ clientId, clientSecret, redirectUri })` — saves the app credentials to `IntegrationCredential(integrationId="linkedin-personal-social")` (status=`pending-oauth`), creates an `OAuthPendingFlow` row keyed by random state, returns the authorize URL.
  - `completeLinkedInOAuth(state, code)` — looks up flow, exchanges code at `https://www.linkedin.com/oauth/v2/accessToken`, encrypts the access + refresh token into `tokenCacheEnc`, sets status=`connected`, fetches `/v2/userinfo` to capture member display name + URN in `fieldsEnc`.

- [ ] New API route `apps/web/app/api/integrations/linkedin-personal-social/callback/route.ts` — handles the OAuth callback, calls `completeLinkedInOAuth`, redirects to `/platform/tools/integrations/linkedin-personal-social?oauth=success` or `?oauth=error&reason=...`.

- [ ] New server actions `apps/web/app/(shell)/platform/tools/integrations/linkedin-personal-social/actions.ts`:
  - `startLinkedInOAuthAction(form)` — server-side validates inputs, calls `startLinkedInOAuth`, returns the authorize URL for the client to navigate to.
  - `disconnectLinkedInAction()` — wipes `IntegrationCredential` row, requires `manage_provider_connections` capability.

- [ ] New page `apps/web/app/(shell)/platform/tools/integrations/linkedin-personal-social/page.tsx` modeled on `mailchimp/page.tsx`:
  - Shows current connection state + member display name when connected.
  - Form for `clientId`, `clientSecret`, `redirectUri` (default `${PUBLIC_URL}/api/integrations/linkedin-personal-social/callback`).
  - **Connect** button starts the OAuth flow (returns the LinkedIn authorize URL; client navigates).
  - **Disconnect** button on the connected state.
  - Inline explainer: "You need your own LinkedIn developer app with Sign In with LinkedIn using OpenID Connect + Share on LinkedIn (`w_member_social`). See https://learn.microsoft.com/linkedin/marketing/getting-access for setup."

## Phase 5: Publish Service + MCP Tool

- [ ] New file `apps/web/lib/marketing/publish.ts` exporting `publishApprovedDraft({ draftId, publishedByUserId })`:
  - Loads the draft. Returns error if not in `approved` state.
  - Loads the adapter via `getAdapter(draft.channelId)`. Returns error if unknown.
  - Loads `IntegrationCredential` for the adapter. Returns error if not connected.
  - Calls `adapter.publish(draft, credential)`.
  - On success: writes `OutboundPublication`, flips draft `approved → published`.
  - On failure: writes `OutboundPublication`-less audit (the `ToolExecution` row covers the failure log); draft stays `approved`; returns the actionable error.

- [ ] Add `publish_to_linkedin` MCP tool in `apps/web/lib/mcp-tools.ts`:
  - Input: `{ draftId: string }`.
  - `requiredCapability: "operate_marketing"`, `sideEffect: true`, `coworkerArtifact: false` (this IS an external action, not internal artifact capture).
  - Handler calls `publishApprovedDraft`. Returns `{ success, entityId, message, data }`.

- [ ] Add `publish_to_linkedin: ["marketing_write", "manage_provider_connections"]` in `TOOL_TO_GRANTS`.

- [ ] Extend `OUTBOUND_DRAFT_STATUS` in `apps/web/lib/marketing/execution.ts` to include `"published"`. Update the state-machine transition table: `approved → published` is the only legal transition into `published`, and `published` is terminal.

## Phase 6: Approval Queue Publish Button

- [ ] Extend `getMarketingWorkspaceSnapshot()` to surface:
  - `pendingDrafts` already there.
  - `approvedDrafts`: pull `OutboundDraft.status="approved"` rows (separate query, limit 10).
  - `connectedChannels`: read `IntegrationCredential` table for `status="connected"` and map to channel ids.

- [ ] Update `ApprovalQueuePanel` to render two sections: "Awaiting your review" (existing) and "Ready to publish" (new), the latter shows approved drafts with a `PublishLinkedInButton` (disabled if `connectedChannels` doesn't include `linkedin-personal-social`, with a deep-link tooltip).

- [ ] New `PublishLinkedInButton` client component invokes the server action `publishOutboundDraftAction(draftId)` which gates on capability + calls `publishApprovedDraft`.

- [ ] On success, the draft disappears from "Ready to publish" and (Phase 4 work) will surface in a published-history panel; for Phase 2, the success state shows `Published — view post` linking to `OutboundPublication.externalUrl`.

## Phase 7: Tests

- [ ] `apps/web/lib/marketing/channels/linkedin-personal-social/tests/adapter.test.ts` — mocked-fetch tests covering happy path, scope assertion, auth failure, body length validation, missing credential.
- [ ] `apps/web/lib/marketing/publish.test.ts` — state-machine boundaries (not-approved rejected, missing adapter rejected, missing credential rejected, success transitions draft to published + writes OutboundPublication).
- [ ] `apps/web/lib/marketing/execution.test.ts` — extend with `approved → published` legal, `pending-review → published` illegal, `published` terminal.
- [ ] `apps/web/lib/marketing/channels/registry.test.ts` — `getAdapter("linkedin-personal-social")` returns the LinkedIn adapter, unknown channel returns null.

## Phase 8: Build Gate

- [ ] `pnpm --filter web exec vitest run lib/marketing` — all green.
- [ ] `pnpm --filter web typecheck` — clean.
- [ ] `pnpm --filter web exec next build` — exit 0.
- [ ] Migration applies cleanly on `dpf-postgres-1`.

## Phase 9: UX Verification (mock-mode)

- [ ] Drive the flow against live `localhost:3000` with the channel adapter MOCKED so we don't need a real LinkedIn account:
  - Insert a test `IntegrationCredential(integrationId="linkedin-personal-social", status="connected")` row directly in DB to simulate connection.
  - Drive the strategist to draft + approve a LinkedIn asset (Phase 1 flow).
  - Trigger the publish tool with the mock adapter (or via a `LINKEDIN_MOCK_MODE=1` env flag the adapter checks at runtime — wired only for non-production environments).
  - Verify `OutboundPublication` row written, draft flipped to `published`, queue panel reflects state.

## Phase 10: Ship

- [ ] DCO-signed commits per concern (migration, adapter, OAuth, tool, UI, tests).
- [ ] Open PR titled "feat(marketing): execution loop Phase 2 — LinkedIn publish via personal OAuth".
- [ ] CI green → squash-merge → delete branch.
- [ ] Rebuild portal at `D:/DPF/.claude/worktrees/portal-latest-main`.
- [ ] Flip `BI-2752E612` to `done` with merged-commit reference.

## Phase 11: Operator Handoff

- [ ] Add a small note at `docs/operations/integrations/linkedin-personal-social-setup.md` walking the operator through:
  1. Create a LinkedIn developer app at https://www.linkedin.com/developers/apps
  2. Add products: "Sign In with LinkedIn using OpenID Connect" + "Share on LinkedIn"
  3. Configure OAuth redirect URL: `${PUBLIC_URL}/api/integrations/linkedin-personal-social/callback`
  4. Copy client ID + client secret into `/platform/tools/integrations/linkedin-personal-social`
  5. Click Connect, complete authorize on LinkedIn, return to DPF.

---

## Definition of Done

- All Phase 2 build-gate steps pass.
- LinkedIn channel adapter shape + tests demonstrate scope, body limits, auth-failure, and successful publish path against mocked fetch.
- OAuth start/callback wired with `OAuthPendingFlow` reuse and proper PKCE-equivalent state handling.
- `publish_to_linkedin` MCP tool exposed, gated on `marketing_write` + `manage_provider_connections`, callable only on approved drafts with connected credentials.
- `OutboundPublication` table populated by mock-mode publish run.
- `BI-2752E612` flipped to `done`.
- Operator setup doc landed.
