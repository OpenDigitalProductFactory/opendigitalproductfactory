# Marketing Execution Loop — Phase 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans / dpf-platform:dpf-writing-plans.

**Goal:** Close the loop. Schedule the drafter to fire ahead of each `MarketingAssetTask.dueWindow`, render a calendar of scheduled actions, expose a bounded autopilot policy so the operator can step away without the marketing pipeline stalling, and never let autopilot extend to ad spend, inbound replies, public profile changes, or low-confidence drafts.

**Architecture:** Two new Prisma models — `ScheduledOutboundAction` (one row per planned future action: scheduled drafter run, scheduled publish, or scheduled KPI pull) and `OutboundAutopilotPolicy` (per-channel bounded autopilot config). A small dispatcher loop walks `pending` schedule rows whose `scheduledFor <= now`, fires the action through the existing Phase 1-4 services (`draftMarketingAsset`, `publishApprovedDraft`, `pullChannelKpis`), and writes back the fired status. Two surfaces consume the dispatcher: an MCP tool `tick_marketing_scheduler` for manual / cron-driven firing, and Phase 5's recurring schedule wiring via the existing Inngest scheduler that the platform already uses.

Autopilot policy is the second tier: when present + enabled for a channel, an approved draft that's untouched after `autoPublishAfterMinutes` fires the publish service automatically — BUT only when (a) the draft's word count is below `autoApproveBelowWords`, (b) the weekly per-channel publish count hasn't hit `weeklyCeiling`, (c) the draft body doesn't contain confidence-flag markers, and (d) the channel is on the autopilot allowlist (`linkedin-personal-social` + `email-postmark` for Phase 5; never `linkedin-ads` and never inbound replies). Disabling the policy is a one-click action that stops in-flight scheduled publishes.

**Reference spec:** `docs/superpowers/specs/2026-05-26-marketing-execution-loop-design.md` §6.5 + §7 Phase 5 + §13.

---

## UX Architecture Fit Gate

- **Feature:** Calendar of scheduled actions + per-channel autopilot policy.
- **Owning area:** Business > Customer > Marketing.
- **Primary route family:** `/customer/marketing`.
- **Primary persona:** Mark Bodman as CEO who steps away for a week and expects the pipeline to advance without crossing safety lines.
- **Job the first viewport helps complete:** "See what the system plans to fire next + override anything that looks wrong + confirm the autopilot rules in effect."
- **Navigation layer touched:** local route + contextual action only.
- **Existing component or pattern reused:** approval-queue panel shape for the schedule list; `MarketingSpendCeilingPanel` shape (Phase 4) for the autopilot policy card.
- **New component justified because:** a calendar is genuinely a new affordance — neither the strategy overview nor the approval queue answers "what's pending tomorrow." Single new `ScheduledActionsPanel` component lives next to the existing four panels.
- **Source-of-truth model or service:** `ScheduledOutboundAction` + `OutboundAutopilotPolicy` (both new).
- **Empty state behavior:** "No scheduled actions queued. Asset tasks with a due window will get auto-drafted N days ahead once you enable scheduling on this org." One concrete next action.
- **Failure / unavailable behavior:** dispatcher failure marks the row `failed` with the error message; the operator can re-arm via the UI. Autopilot failure does NOT escalate to the human — it pauses the policy and surfaces the reason.
- **AI or coworker action boundary:** autopilot decisions are policy-bound; the operator sets the bounds, the runtime enforces them. The agent CANNOT modify the policy.
- **Routes to verify:** `/customer/marketing` (calendar + policy panel).

---

## Phase 0: Branch and Substrate Guard

- [x] Worktree on `feat/marketing-execution-loop-phase-5`, branched from `origin/main`.
- [x] Substrate sweep — no existing `ScheduledOutboundAction` or `OutboundAutopilotPolicy`.

## Phase 1: Prisma Models + Migration

- [ ] Add `ScheduledOutboundAction` + `OutboundAutopilotPolicy` to `schema.prisma`.
- [ ] Hand-author migration `20260603030000_marketing_execution_scheduler` + apply to live `dpf-postgres-1`.
- [ ] Regenerate Prisma client.

## Phase 2: Scheduler State Machine + Catalog

- [ ] Extend `apps/web/lib/marketing/execution.ts` with `SCHEDULED_ACTION_KIND` (`draft-marketing-asset` | `publish-approved-draft` | `pull-channel-kpis`), `SCHEDULED_ACTION_STATUS` (`pending` | `paused` | `fired` | `cancelled` | `failed`), and the transition table.

## Phase 3: Dispatcher

- [ ] New file `apps/web/lib/marketing/scheduler.ts`:
  - `scheduleAction(input)` — upsert a new `ScheduledOutboundAction(status=pending)`.
  - `pauseSchedule(scheduleId)` / `cancelSchedule(scheduleId)` — explicit transitions.
  - `tickScheduler({ now? })` — query `pending` rows with `scheduledFor <= now`, dispatch each through the right service (Phase 1 draft / Phase 2-4 publish / Phase 4 pullback), set `status=fired` + `firedAt=now` on success, or `status=failed` + error.
  - `planUpcomingForAssetTasks()` — walk recent `MarketingAssetTask` rows, schedule a drafter run 3 days before each task's `dueWindow` if one isn't already queued (idempotent).

## Phase 4: Autopilot Policy + Gate

- [ ] New file `apps/web/lib/marketing/autopilot.ts`:
  - `isAutopilotEligible(draft, policy)` — checks word count, channel allowlist, weekly publish count vs ceiling, and confidence flags.
  - `autopilotApprove(draftId)` — if eligible, writes an `OutboundApprovalDecision(reviewerUserId=policy.enabledByUserId, decision=approved, notes="auto-approved by policy MAUP-…")` + flips draft to `approved`.
  - Channel allowlist hard-coded: `linkedin-personal-social`, `email-postmark`. `linkedin-ads` is explicitly excluded.

## Phase 5: MCP Tools

- [ ] `tick_marketing_scheduler` — fires `tickScheduler`; reports fired/failed counts.
- [ ] `set_marketing_autopilot_policy` — operator-only, gated by `manage_provider_connections`. Validates the channel is in the allowlist + ceiling values are sane.
- [ ] Marketing-specialist prompt updated: never call autopilot policy mutators; surface scheduled-action state when the user asks.

## Phase 6: UI

- [ ] `ScheduledActionsPanel` on `/customer/marketing`: calendar-style list of pending + recently-fired actions, with Pause/Cancel buttons.
- [ ] `MarketingAutopilotPolicyPanel` on `/customer/marketing`: per-channel toggle, weekly ceiling, word-count threshold, last-fire-window. Disable button stops in-flight scheduled publishes.

## Phase 7: Tests

- [ ] `scheduler.test.ts`: tick fires pending rows; failure marks row failed; planUpcoming is idempotent.
- [ ] `autopilot.test.ts`: eligibility checks all 4 dimensions; channel allowlist enforced; ad channel explicitly refused.
- [ ] `registry.test.ts`: still resolves all four adapters.

## Phase 8: Build Gate

- [ ] vitest passing; typecheck clean; next build exit 0; migration applies.

## Phase 9: UX Verification (mock mode)

- [ ] Seed a scheduled drafter action, call tick, verify draft created.
- [ ] Seed autopilot policy + an approved draft below word threshold; tick again; verify approval written + published.
- [ ] Set up an ad-channel autopilot policy — expect refusal.

## Phase 10: Ship + Operator Handoff

- [ ] Squash-merge.
- [ ] Update `docs/operations/integrations/linkedin-personal-social-setup.md` with the autopilot policy note: "Autopilot never extends to ads, inbound replies, or public profile changes."

---

## Definition of Done

- All Phase 5 build-gate steps pass.
- Scheduler dispatches pending rows correctly.
- Autopilot policy enforces channel allowlist + 4 eligibility dimensions; ads channel hard-refused.
- `BI-4C0792D0` flipped to `done`.
- Operator handoff updated.
