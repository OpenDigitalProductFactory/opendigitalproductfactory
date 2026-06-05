# Marketing Execution Loop — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the immediate strategy→publish gap on `/customer/marketing` by giving the platform the ability to turn a saved `MarketingAssetTask` into a channel-shaped, human-reviewable draft — gated by an explicit approval queue, with a full audit trail. No external API integration in this phase.

**Architecture:** Add the substrate-named outbound execution layer (`OutboundDraft` + `OutboundApprovalDecision`) with a `domain="marketing"` discriminator so it generalizes to other coworker domains later without a rename migration. Add a typed status catalog at `apps/web/lib/marketing/execution.ts` to keep enum strings out of pages, tools, and tests. Expose one new MCP tool — `draft_marketing_asset(assetTaskId)` — that the marketing-specialist (and a one-click UI affordance next to each asset task) can call to produce a draft. Render a new "Awaiting your review" panel on `/customer/marketing` with inline edit + Approve / Approve-with-edits / Request changes / Reject actions, writing one `OutboundApprovalDecision` per decision.

**Tech Stack:** Next.js app router, React server components + light client edit panel, Prisma 7 migration, Vitest, existing DPF MCP/tool surface, existing theme variables only.

**Reference spec:** [`docs/superpowers/specs/2026-05-26-marketing-execution-loop-design.md`](../specs/2026-05-26-marketing-execution-loop-design.md) (Phase 1 = §6.1 + §7 Phase 1 + §9).

---

## UX Architecture Fit Gate

Per the spec §8, every phase plan must answer this gate before implementation starts:

- **Feature:** Outbound draft + approval queue for marketing assets.
- **Owning area:** Business > Customer > Marketing.
- **Primary route family:** `/customer/marketing`.
- **Primary persona:** Mark Bodman as CEO / marketing operator using the Marketing Strategist coworker.
- **Job the first viewport helps complete:** "Review and approve content the strategist drafted for me to publish this week."
- **Navigation layer touched:** local route + contextual action only. No AppRail, Workspace, or Platform navigation additions.
- **Existing component or pattern reused:** `MarketingStrategyOverview` panel composition; `Section` + `Pill` helpers already in `apps/web/components/customer-marketing/`. Action buttons reuse the existing accent-button class. Side drawer / focused panel for the long-copy editor uses the existing inline-detail pattern (no new modal stack).
- **New component justified because:** none of the existing review surfaces (`AgentMessageInput`, `BuildReviewPanel`, `ReleaseDecisionPanel`) target a marketing-asset shape with inline copy editing + four-button decision. A new `ApprovalQueuePanel` keyed by domain="marketing" is the minimum surface; it lives next to other marketing components.
- **Source-of-truth model or service:** `OutboundDraft` (new) and `OutboundApprovalDecision` (new). Reads composed through `getMarketingWorkspaceSnapshot()` so the page stays one query path.
- **Empty state behavior:** "No drafts awaiting your review. Ask the Marketing Strategist to draft an asset, or click 'Draft' next to an asset task above." One concrete next action — not a wall of zeros.
- **Failure / unavailable behavior:** if the drafter tool fails, the asset task row surfaces "Draft failed — see chat for details" with a Retry button. The approval queue still renders empty (does not crash).
- **AI or coworker action boundary:** drafter writes to `OutboundDraft` (internal artifact). Approval is a button on the queue row — never an inferred outcome of chat. Per the kernel principle, approval cannot be auto-fired by the agent.
- **Theme and layout checks:** all colors via `var(--dpf-*)` tokens. No `text-white` except on accent buttons. Pills reuse existing badge class.
- **Routes to verify:** `/customer/marketing` desktop + mobile; light mode + dark mode.
- **Evidence required before merge:** screenshot + dynamic-analysis log of (a) draft created from existing Week 1 LinkedIn Post asset task, (b) edit-then-approve writing an `OutboundApprovalDecision` row with `editedBody`, (c) reject writing decision row with `decision=rejected`.

---

## Phase 0: Branch and Substrate Guard

- [ ] Confirm work is on an isolated branch/worktree off `origin/main`, not on `main` and not on a dirty worktree.

  ```powershell
  git status --short --branch
  git branch --show-current
  ```

- [ ] Re-read the governing docs before implementation:
  - [`AGENTS.md`](../../../AGENTS.md)
  - [`docs/superpowers/specs/2026-05-26-marketing-execution-loop-design.md`](../specs/2026-05-26-marketing-execution-loop-design.md)
  - [`docs/superpowers/specs/2026-05-26-pipedrive-inspired-crm-marketing-operations-design.md`](../specs/2026-05-26-pipedrive-inspired-crm-marketing-operations-design.md)
  - [`docs/platform-usability-standards.md`](../../platform-usability-standards.md)

- [ ] Substrate sweep — verify the proposed table names don't already exist on `origin/main` or in an open BS sandbox:

  ```bash
  grep -rn "model OutboundDraft\|model OutboundApprovalDecision" packages/db/prisma/schema.prisma
  ```

  Expected: zero matches. If anything matches, stop and align with the existing model first.

## Phase 1: Status Catalog + Prisma Models

- [ ] Add `apps/web/lib/marketing/execution.ts` with strongly-typed catalogs:

  ```typescript
  export const OUTBOUND_DRAFT_STATUS = [
    "draft",
    "pending-review",
    "approved",
    "rejected",
    "needs-changes",
    "stale",
  ] as const;
  export type OutboundDraftStatus = (typeof OUTBOUND_DRAFT_STATUS)[number];

  export const OUTBOUND_APPROVAL_DECISION = [
    "approved",
    "rejected",
    "needs-changes",
  ] as const;
  export type OutboundApprovalDecisionValue = (typeof OUTBOUND_APPROVAL_DECISION)[number];

  export const OUTBOUND_DOMAIN = ["marketing"] as const; // grows as other domains adopt
  export type OutboundDomain = (typeof OUTBOUND_DOMAIN)[number];

  export const OUTBOUND_SOURCE_TYPE = [
    "marketing-asset-task",
    "marketing-campaign-brief",
    "inbound-channel-message",
    "manual",
  ] as const;
  export type OutboundSourceType = (typeof OUTBOUND_SOURCE_TYPE)[number];

  export const OUTBOUND_BODY_FORMAT = ["markdown", "html", "plain"] as const;
  export type OutboundBodyFormat = (typeof OUTBOUND_BODY_FORMAT)[number];
  ```

- [ ] Add Prisma models to `packages/db/prisma/schema.prisma`:

  ```prisma
  model OutboundDraft {
    draftId          String   @id @default(cuid())
    organizationId   String
    domain           String
    sourceType       String
    sourceId         String?
    strategyId       String?
    status           String
    channelId        String
    assetType        String
    body             String   @db.Text
    bodyFormat       String
    metadata         Json?
    createdByAgentId String?
    originalPromptId String?
    createdAt        DateTime @default(now())
    updatedAt        DateTime @updatedAt

    approvals        OutboundApprovalDecision[]

    @@index([organizationId, domain, status])
    @@index([sourceType, sourceId])
    @@index([channelId, status])
  }

  model OutboundApprovalDecision {
    decisionId       String   @id @default(cuid())
    draftId          String
    reviewerUserId   String
    decision         String
    editedBody       String?  @db.Text
    notes            String?  @db.Text
    decidedAt        DateTime @default(now())

    draft            OutboundDraft @relation(fields: [draftId], references: [draftId], onDelete: Cascade)

    @@index([draftId])
    @@index([reviewerUserId, decidedAt])
  }
  ```

- [ ] Create migration: `pnpm --filter @dpf/db exec prisma migrate dev --name marketing_execution_outbound_draft`. Migration body is empty SQL (Prisma generates `CREATE TABLE` for both models).

- [ ] Regenerate the Prisma client.

- [ ] Verify migration applies cleanly on a fresh DB:
  - Run the migration against a scratch container or use the existing prisma migrate workflow.
  - Confirm `\d "OutboundDraft"` and `\d "OutboundApprovalDecision"` show the expected columns + indexes in `psql`.

## Phase 2: Data Access Helpers

- [ ] Extend `apps/web/lib/marketing.ts` with snapshot helpers (or add `apps/web/lib/marketing-execution.ts` if marketing.ts is already heavy — keep one source of truth per route data path):

  ```typescript
  export type OutboundDraftRow = {
    draftId: string;
    sourceType: OutboundSourceType;
    sourceId: string | null;
    assetTaskTitle?: string | null; // joined when sourceType=marketing-asset-task
    channelId: string;
    assetType: string;
    status: OutboundDraftStatus;
    body: string;
    bodyFormat: OutboundBodyFormat;
    createdByAgentId: string | null;
    createdAt: Date;
  };

  export async function listPendingOutboundDrafts(organizationId: string): Promise<OutboundDraftRow[]>;
  export async function getOutboundDraft(draftId: string): Promise<OutboundDraftRow | null>;
  ```

- [ ] Extend `getMarketingWorkspaceSnapshot()` to include `pendingDrafts: OutboundDraftRow[]`. Existing `workProducts` map stays untouched.

- [ ] Server actions in `apps/web/app/(shell)/customer/marketing/actions.ts` (new file if not present):
  - `approveOutboundDraftAction(draftId: string, editedBody?: string, notes?: string)` — writes `OutboundApprovalDecision(decision="approved", editedBody, notes)` + flips draft to `approved`.
  - `requestChangesOnDraftAction(draftId: string, notes: string)` — writes decision + flips draft to `needs-changes`.
  - `rejectOutboundDraftAction(draftId: string, notes?: string)` — writes decision + flips draft to `rejected`.

  All three:
  - Require `operate_marketing` capability via the existing `can()` helper.
  - Use a single Prisma transaction.
  - Revalidate `/customer/marketing` on success.

## Phase 3: MCP Tool — `draft_marketing_asset`

- [ ] Add tool definition in `apps/web/lib/mcp-tools.ts` after `create_marketing_asset_task`:

  ```typescript
  {
    name: "draft_marketing_asset",
    description: "Turn a saved MarketingAssetTask brief into a channel-shaped, human-reviewable draft. Outputs an OutboundDraft with status='pending-review' that appears in the marketing approval queue. No external API call — the draft is internal until a human approves and publishes.",
    inputSchema: {
      type: "object",
      properties: {
        assetTaskId: { type: "string", description: "MarketingAssetTask.taskId to draft from" },
        channelOverride: { type: "string", enum: [...MARKETING_CHANNELS], description: "Override the asset task's channel if drafting a variant" },
        toneNotes: { type: "string", description: "Optional one-line guidance the drafter should respect (e.g. 'first person, technical, no emojis')" },
      },
      required: ["assetTaskId"],
    },
    requiredCapability: "operate_marketing",
    sideEffect: true,
    coworkerArtifact: true,
  },
  ```

- [ ] Add `TOOL_TO_GRANTS["draft_marketing_asset"] = ["marketing_write"]` in `apps/web/lib/tak/agent-grants.ts`.

- [ ] Implement the tool handler in the `executeTool` switch:
  - Load the `MarketingAssetTask` by id; reject with `{ success: false, error: "Asset task not found" }` if missing.
  - Build a channel-shaped drafter prompt that consumes: `task.title`, `task.brief`, `task.assetType`, `task.channel`, `task.dueWindow`, the current `MarketingStrategy` snapshot (positioning, channels, KPIs), and the latest `MarketingReview.summary`.
  - Channel-aware shaping: for `assetType=LinkedIn post`, target 180–280 words, 0–3 hashtags, one CTA. For `assetType=email`, include subject line. For `assetType=ad-creative`, include 1 headline + 2 description variants. (Phase 1 covers LinkedIn post + email; other types ship later phases.)
  - Call the platform LLM via the existing `routeAndCall` path with the `marketing-specialist` agent context.
  - Persist the result as `OutboundDraft(status="pending-review", domain="marketing", sourceType="marketing-asset-task", sourceId=assetTaskId, channelId=task.channel, assetType=task.assetType, body=output, bodyFormat="markdown", createdByAgentId=agentId)`.
  - Return `{ success: true, draftId, message: "Draft N words queued for review on /customer/marketing" }`.

- [ ] Update the marketing-specialist agent prompt to mention the new tool:
  - In `apps/web/lib/tak/agent-routing.ts` line ~215, add: "When a campaign brief and asset task are saved, call `draft_marketing_asset(assetTaskId)` to produce the human-reviewable copy. The draft lands in the approval queue on the marketing page; do not claim it has been published."

## Phase 4: Approval Queue UI

- [ ] New component `apps/web/components/customer-marketing/ApprovalQueuePanel.tsx`:
  - Server component reads `snapshot.pendingDrafts`.
  - Empty state: "No drafts awaiting your review. Ask the Marketing Strategist to draft an asset, or click 'Draft' next to an asset task above."
  - Each row: channel + asset type pill, source asset task title, agent + timestamp, preview of first ~120 chars, "Review" button.
  - Click "Review" opens a focused detail panel (drawer pattern from `MarketingStrategyOverview` — no modal stack) with:
    - Left: the brief from the asset task (read-only).
    - Right: editable `<textarea>` pre-filled with `draft.body`.
    - Buttons: **Approve**, **Approve with edits**, **Request changes**, **Reject**.
    - Each action calls the corresponding server action.

- [ ] New client component `apps/web/components/customer-marketing/ApprovalQueueReview.tsx` for the edit surface (small client island; rest stays server-rendered).

- [ ] Wire `ApprovalQueuePanel` into `apps/web/app/(shell)/customer/marketing/page.tsx` immediately below the existing "Strategist work products" section.

- [ ] Add a one-click "Draft" affordance to each `MarketingAssetTask` row in `MarketingStrategyOverview` that calls the new tool via a server action; show inline "Drafting…" state and surface the new draft in the queue panel on success.

## Phase 5: Tests

- [ ] Unit tests in `apps/web/lib/marketing/execution.test.ts`:
  - Status enum invariants (each catalog value present, no rogue strings).
  - `OUTBOUND_DRAFT_STATUS` type assignability sanity checks.

- [ ] Unit tests in `apps/web/lib/marketing/draft-state-machine.test.ts` (small pure-function state transition module if extracted, otherwise inline):
  - `pending-review → approved` valid via approve decision.
  - `pending-review → needs-changes` valid via request-changes decision.
  - `pending-review → rejected` valid via reject decision.
  - `approved → approved` rejected (idempotency boundary).
  - `rejected → approved` rejected (no resurrection without a new draft revision).

- [ ] Integration test in `apps/web/app/(shell)/customer/marketing/actions.test.ts`:
  - Approve writes an `OutboundApprovalDecision` row with `decision="approved"`, no `editedBody`.
  - Approve-with-edits writes a row with `editedBody` populated.
  - Request changes writes a row with `decision="needs-changes"` and a non-null `notes`.
  - Reject writes a row with `decision="rejected"`.
  - User without `operate_marketing` is rejected.

- [ ] MCP tool test in `apps/web/lib/mcp-tools.test.ts` (or a new `mcp-tools-marketing-execution.test.ts`):
  - `draft_marketing_asset` with a missing `assetTaskId` returns success=false.
  - With a valid `assetTaskId`, it writes an `OutboundDraft` with `status="pending-review"` and a non-empty body.

## Phase 6: Build Gate

- [ ] `pnpm --filter web exec vitest run lib/marketing lib/actions lib/mcp-tools` — all passing.
- [ ] `pnpm --filter web typecheck` — clean.
- [ ] `pnpm --filter web exec next build` — exit 0.
- [ ] Migration applies cleanly when portal is rebuilt (no manual SQL needed).

## Phase 7: UX Verification on Live Install

- [ ] Drive the flow as Mark on `http://localhost:3000/customer/marketing`:
  1. Confirm the Week 1 LinkedIn Post asset task already exists (it does — `cmpnaj574008z01s2hcwomedy`).
  2. Click "Draft" next to it. Observe inline "Drafting…" → success.
  3. Confirm a new row appears in the "Awaiting your review" panel.
  4. Click "Review". Drawer opens with brief on left, editable body on right.
  5. Approve as-is. Confirm row leaves queue. Confirm `OutboundApprovalDecision` row in DB.
  6. Trigger a second draft (different asset task). Edit the body. Click "Approve with edits". Confirm `editedBody` written.
  7. Trigger a third draft. Click "Reject". Confirm `decision="rejected"` row.
  8. Take screenshots of (a) populated queue, (b) drawer with side-by-side, (c) audit-trail surfacing.

- [ ] Mobile width verification: queue rows do not overlap badges/buttons. Touch targets ≥ 44px.
- [ ] Light mode + dark mode + a brand-token override: drawer + buttons render correctly.

## Phase 8: Ship

- [ ] DCO-signed commit per concern (separate commits for migration, helpers + tool, UI, tests).
- [ ] Push branch `feat/marketing-execution-loop-phase-1`.
- [ ] Open PR titled "feat: marketing execution loop Phase 1 — drafter + approval queue".
- [ ] PR body links the spec and this plan, includes UX verification screenshots, lists which acceptance criteria pass.
- [ ] CI green → squash-merge → delete branch.
- [ ] Rebuild portal at `D:/DPF/.claude/worktrees/portal-latest-main` (fast-forward main, `docker compose build --no-cache portal portal-init sandbox`, `docker compose up -d`).
- [ ] Re-drive the flow on the rebuilt portal to confirm behavior survives the rebuild.

## Phase 9: Cleanup and Follow-on

- [ ] Mark `BI-7A152AED` (Phase 1 backlog item) `done` once the rebuilt portal verifies.
- [ ] File a tiny follow-up BI to update the `customer-marketing.prompt.md` content (point users at the approval queue in plain-language UX copy) if any prompt copy needs adjustment after seeing the live flow.
- [ ] Confirm the next phase (Phase 2 LinkedIn publish vs. Phase 3 email — see spec §15 Q2) before opening the next plan.

---

## Definition of Done

- All Phase 1 build-gate steps pass.
- Live install demonstrates: existing asset task → drafted LinkedIn-shaped body → reviewed in queue → approved (with and without edits) → audit row visible.
- No external API calls fire from this PR.
- All theme tokens used per platform-usability-standards.
- `EP-MARKETING-EXEC` epic has `BI-7A152AED` flipped to `done` post-merge.
