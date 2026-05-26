# Feedback Support-Mode Entry (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development if available, or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking. This is product behavior and MUST run through Build Studio; do not implement this feature directly from a human chat thread.

**Goal:** Feedback clicks open the existing AI coworker shell in support-entry mode, carry typed context, and create or reconcile one local `PlatformIssueReport` in `support_triage` with route, trigger, support-session, thread, and build context where available.

**Architecture:** Define one typed feedback event contract that both feedback buttons and the coworker shell consume. The shell remains the only panel surface; it synchronously claims handled events, enriches the clicked event with the currently loaded thread and active Build Studio build, then calls a server action that uses Phase 0's `createPlatformIssueReport()` writer. Persist `triggerKind` and a per-user `supportSessionId` in Phase 1 because acceptance requires durable trigger context and review identified double-click/fallback races as a ship blocker; defer routing decisions, upstream bridge work, coalescing, implicit triggers, reverse notifications, and STT to later phases.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 7, Vitest, React Testing Library, DPF MCP, Docker-served portal verification.

---

## Build Studio Lane

- Spec: `docs/superpowers/specs/2026-05-24-capacity-aware-feedback-escalation-design.md`, especially Architect Verdict, section 6.1, and section 8 Phase 1.
- Phase 0 plan template: `docs/superpowers/plans/2026-05-24-feedback-substrate-cleanup.md`.
- Backlog item: `BI-4CDB18EE`.
- Target epic: `EP-9FC5D2FD` - live MCP check on 2026-05-26 confirms it is open.
- This plan is the Build Studio BI attachment. The Build Studio worker should run Ideate -> Design -> Build -> Ship from this plan and the spec, not bypass the phase gates.
- Required local verification before push: from `apps/web`, run `pnpm test` for the full web Vitest suite, not only targeted tests or typecheck.
- Required live UX verification at Ship: drive the click on `http://localhost:3000` using Chrome MCP against the Docker-served portal.

## Key Decisions

- **Persist `triggerKind` and `supportSessionId` now.** Phase 1 acceptance says the created report has `triggerKind`; the current schema has no such field. The support-session key is the minimal additional persistence needed to make support start idempotent across double-clicks, remounts, late thread creation, and shell/fallback races. Do not add coalescing, capacity decision, support summary, acknowledgement, or resolved fields.
- **Use the existing shell.** Do not create a new support chat surface. `AgentCoworkerShell` already listens for `open-agent-feedback` and `open-agent-panel`; extend that listener.
- **Support mode is an entry mode, not a new backend `CoworkerMode`.** Existing runtime `CoworkerMode` is `"advise" | "act"`. Phase 1 should add support copy and support report creation without widening that runtime enum.
- **Do not write public build IDs into relation fields.** The browser has the public Build Studio `buildId` such as `FB-12345678`. `PlatformIssueReport.featureBuildId` is a relation to internal `FeatureBuild.id`. The server action must resolve public `buildId` to internal `id` before calling the writer.
- **Manual click should not force category selection.** Healthy installs open the coworker with support copy. The fallback `FeedbackForm` remains only for shell-unavailable cases and continues to post through the existing fallback path, but it must carry the same `supportSessionId`, `routeContext`, and `triggerKind` so a fallback race cannot create a duplicate report.
- **Explicit Feedback buttons are `manual` triggers.** Per spec section 6.1, `triggerKind` describes why feedback was raised (`manual`, `runtime-error`, `grant-denied`, etc.), not which UI control was clicked. `FeedbackButton` and `HeaderFeedbackButton` should both emit `triggerKind: "manual"` for Phase 1. Do not invent button-specific trigger kinds such as `"feedback-button"` or `"header-feedback"`.
- **Thread reconciliation is monotonic.** A support report with no `threadId` may be updated with a validated user-owned thread. A report with the same `threadId` is already reconciled. A report with a different `threadId` must not be relinked.
- **Abuse limits are server-side.** Do not rely on client throttling. Enforce 3 support starts per user per minute and 10 per user per hour, with user-visible text feedback and audit logging on repeated burst violations.

## File Map

- Create `apps/web/lib/feedback/feedback-event.ts`
  - Owns `FeedbackTriggerKind`, `FeedbackEventDetail`, trigger constants, and small helpers/type guards.
- Create `apps/web/lib/feedback/feedback-event.test.ts`
  - Protects the event vocabulary and manual payload shape.
- Modify `packages/db/prisma/schema.prisma`
  - Add `triggerKind String?`, `supportSessionId String?`, and a user-scoped unique constraint on `[reportedById, supportSessionId]` to `PlatformIssueReport`.
- Create migration under `packages/db/prisma/migrations/<timestamp>_add_issue_report_support_context/migration.sql`
  - Add nullable `triggerKind` and `supportSessionId`, plus the user-scoped unique index; no backfill.
- Modify `apps/web/lib/quality/platform-issue-reports.ts`
  - Accept and persist `triggerKind` and `supportSessionId`.
- Modify `apps/web/lib/quality/platform-issue-reports.test.ts`
  - Prove writer persists `triggerKind` and `supportSessionId`.
- Create `apps/web/lib/actions/feedback-support.ts`
  - Server action for support-triage report creation, idempotent reconciliation, build ID resolution, thread ownership validation, and rate limiting.
- Create `apps/web/lib/actions/feedback-support.test.ts`
  - Proves auth, build ID resolution, thread pass-through, status, source, trigger persistence, support-session dedupe, monotonic thread reconciliation, and rate limits.
- Modify `apps/web/components/feedback/FeedbackButton.tsx`
  - Dispatch typed event detail with route and `triggerKind: "manual"`.
- Modify `apps/web/components/feedback/HeaderFeedbackButton.tsx`
  - Same event detail (`triggerKind: "manual"`) and session-aware fallback behavior.
- Create or modify feedback button tests:
  - `apps/web/components/feedback/FeedbackButton.test.tsx`
  - `apps/web/components/feedback/HeaderFeedbackButton.test.tsx`
- Modify `apps/web/components/agent/AgentCoworkerShell.tsx`
  - Recognize feedback detail, open support entry, inject support copy, and create support report once per support start.
- Create `apps/web/components/agent/AgentCoworkerShell.test.tsx`
  - If this component is too heavy to test directly, extract a small helper and test that helper plus one shell smoke test.
- Create `docs/superpowers/evidence/2026-05-26-feedback-support-mode-entry-verification.md`
  - Ship evidence with targeted tests, full web test, typecheck, build, live click, and DB row query.

---

## Chunk 1: Baseline And Persistence Contract

### Task 1: Baseline the Phase 0 substrate

**Files:** none.

- [ ] **Step 1: Confirm branch and clean worktree**

Run:

```powershell
git status --short --branch
```

Expected: topic branch, no local changes except the Build Studio sandbox's intended working state.

- [ ] **Step 2: Run focused substrate tests before edits**

Run:

```powershell
pnpm --filter web exec vitest run lib/quality/issue-report-status.test.ts lib/quality/platform-issue-reports.test.ts app/api/quality/report/route.test.ts lib/actions/quality.test.ts lib/operate/issue-report-triage.test.ts
```

Expected: all pass. If they fail, stop and reconcile before changing Phase 1 code.

### Task 2: Add support context to `PlatformIssueReport`

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_add_issue_report_support_context/migration.sql`
- Modify: `apps/web/lib/quality/platform-issue-reports.ts`
- Modify: `apps/web/lib/quality/platform-issue-reports.test.ts`

- [ ] **Step 1: Write the failing writer test**

Add a test to `platform-issue-reports.test.ts`:

```ts
it("persists support context when provided", async () => {
  await createPlatformIssueReport({
    type: "user_report",
    title: "Build help",
    source: "support_mode",
    status: ISSUE_REPORT_STATUS.SUPPORT_TRIAGE,
    triggerKind: "manual",
    supportSessionId: "dpf_support_test",
  });

  const args = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
  expect(args?.data.triggerKind).toBe("manual");
  expect(args?.data.supportSessionId).toBe("dpf_support_test");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
pnpm --filter web exec vitest run lib/quality/platform-issue-reports.test.ts
```

Expected: fail because support context is not in `CreatePlatformIssueReportInput` or writer data.

- [ ] **Step 3: Add schema fields, index, and migration**

Modify `PlatformIssueReport`:

```prisma
  triggerKind         String?
  supportSessionId    String?

  @@unique([reportedById, supportSessionId])
  @@index([reportedById, source, status, createdAt])
```

Create migration:

```powershell
pnpm --filter @dpf/db exec prisma migrate dev --name add_issue_report_support_context
```

Expected migration SQL includes:

```sql
ALTER TABLE "PlatformIssueReport" ADD COLUMN "triggerKind" TEXT;
ALTER TABLE "PlatformIssueReport" ADD COLUMN "supportSessionId" TEXT;
```

Do not backfill existing reports.

- [ ] **Step 4: Extend the writer input and data**

Add to `CreatePlatformIssueReportInput`:

```ts
  triggerKind?: string | null;
  supportSessionId?: string | null;
```

Add to the `create` data:

```ts
      triggerKind: trimTo(input.triggerKind ?? null, LIMITS.source),
      supportSessionId: trimTo(input.supportSessionId ?? null, LIMITS.source),
```

Use the existing short string limit style; if dedicated `triggerKind` or `supportSessionId` limits are added, keep them near the Phase 0 `LIMITS` object.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/quality/platform-issue-reports.test.ts app/api/quality/report/route.test.ts lib/actions/quality.test.ts
```

Expected: all pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations apps/web/lib/quality/platform-issue-reports.ts apps/web/lib/quality/platform-issue-reports.test.ts
git commit -s -m "feat(feedback): persist issue report support context"
```

---

## Chunk 2: Typed Event Detail And Feedback Buttons

### Task 3: Create the feedback event contract

**Files:**
- Create: `apps/web/lib/feedback/feedback-event.ts`
- Create: `apps/web/lib/feedback/feedback-event.test.ts`

- [ ] **Step 1: Write tests for trigger vocabulary and manual detail**

Create `feedback-event.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  FEEDBACK_TRIGGER_KINDS,
  createManualFeedbackEventDetail,
  isFeedbackEventDetail,
} from "./feedback-event";

describe("feedback-event", () => {
  it("matches the Phase 1 trigger vocabulary", () => {
    expect(FEEDBACK_TRIGGER_KINDS).toEqual([
      "manual",
      "runtime-error",
      "grant-denied",
      "structural-verification-fail",
      "coworker-stall",
      "issue-spike",
    ]);
  });

  it("builds the manual Feedback payload from route context", () => {
    expect(createManualFeedbackEventDetail("/build")).toMatchObject({
      triggerKind: "manual",
      routeContext: "/build",
      supportSessionId: expect.stringMatching(/^dpf_support_/),
      autoFilePolicy: "ask",
    });
  });

  it("rejects malformed event details", () => {
    expect(isFeedbackEventDetail({ triggerKind: "manual", routeContext: "/build", supportSessionId: "dpf_support_test" })).toBe(true);
    expect(isFeedbackEventDetail({ triggerKind: "unknown", routeContext: "/build" })).toBe(false);
    expect(isFeedbackEventDetail({ triggerKind: "manual" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
pnpm --filter web exec vitest run lib/feedback/feedback-event.test.ts
```

Expected: fail because the module does not exist.

- [ ] **Step 3: Implement the contract module**

Implement the spec shape in a browser/server-safe module with no React imports:

```ts
export const FEEDBACK_TRIGGER_KINDS = [
  "manual",
  "runtime-error",
  "grant-denied",
  "structural-verification-fail",
  "coworker-stall",
  "issue-spike",
] as const;

export type FeedbackTriggerKind = (typeof FEEDBACK_TRIGGER_KINDS)[number];

export type FeedbackEventDetail = {
  triggerKind: FeedbackTriggerKind;
  routeContext: string;
  supportSessionId: string;
  title?: string;
  description?: string;
  errorStack?: string;
  userAgent?: string;
  featureBuildId?: string;
  threadId?: string;
  taskRunId?: string;
  sourceId?: string;
  autoFilePolicy?: "ask" | "auto-hard-failure";
};
```

Also add `createManualFeedbackEventDetail(routeContext: string)` and `isFeedbackEventDetail(value: unknown)`. Generate `supportSessionId` with at least 128 bits of entropy. Validate `routeContext` as a normalized path string with a conservative length cap; reject malformed trigger details.

- [ ] **Step 4: Run the contract test**

Run:

```powershell
pnpm --filter web exec vitest run lib/feedback/feedback-event.test.ts
```

Expected: pass.

### Task 4: Dispatch typed detail from both feedback buttons

**Files:**
- Modify: `apps/web/components/feedback/FeedbackButton.tsx`
- Modify: `apps/web/components/feedback/HeaderFeedbackButton.tsx`
- Create: `apps/web/components/feedback/FeedbackButton.test.tsx`
- Create: `apps/web/components/feedback/HeaderFeedbackButton.test.tsx`

- [ ] **Step 1: Write failing component tests**

Test both components with `next/navigation` mocked to return `/build`. Capture `document.addEventListener("open-agent-feedback", handler)` and assert the dispatched `CustomEvent.detail`:

```ts
expect(detail).toMatchObject({
  triggerKind: "manual",
  routeContext: "/build",
  supportSessionId: expect.stringMatching(/^dpf_support_/),
  autoFilePolicy: "ask",
});
```

Also keep a fallback test with fake timers:

```ts
vi.useFakeTimers();
render(<FeedbackButton userId="user-1" />);
fireEvent.click(screen.getByRole("button", { name: /feedback/i }));
act(() => vi.advanceTimersByTime(500));
expect(screen.getByText("Send Feedback")).toBeInTheDocument();
```

For the non-fallback case, append an element with `data-agent-panel="true"` before the timer fires and assert the form does not appear.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
pnpm --filter web exec vitest run components/feedback/FeedbackButton.test.tsx components/feedback/HeaderFeedbackButton.test.tsx
```

Expected: fail because details are not dispatched yet.

- [ ] **Step 3: Implement typed dispatch**

In both button files:

```ts
import { createManualFeedbackEventDetail } from "@/lib/feedback/feedback-event";

const event = new CustomEvent("open-agent-feedback", {
  cancelable: true,
  detail: createManualFeedbackEventDetail(pathname),
});
const handled = !document.dispatchEvent(event);
```

Leave fallback `FeedbackForm` behavior intact:

```tsx
<FeedbackForm routeContext={pathname} source="manual" triggerKind={detail.triggerKind} supportSessionId={detail.supportSessionId} ... />
```

Only open the fallback form if `handled` is false after the existing shell-detection grace period.

- [ ] **Step 4: Run feedback component tests**

Run:

```powershell
pnpm --filter web exec vitest run components/feedback/FeedbackButton.test.tsx components/feedback/HeaderFeedbackButton.test.tsx
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add apps/web/lib/feedback apps/web/components/feedback
git commit -s -m "feat(feedback): dispatch typed feedback event detail"
```

---

## Chunk 3: Support Report Creation Through Phase 0 Writer

### Task 5: Add support-triage server action

**Files:**
- Create: `apps/web/lib/actions/feedback-support.ts`
- Create: `apps/web/lib/actions/feedback-support.test.ts`

- [ ] **Step 1: Write failing server-action tests**

Mock `auth`, `prisma`, and `createPlatformIssueReport`. Cover:

- unauthenticated user returns `{ ok: false }` and does not create a report;
- manual `/build` support creates `status: ISSUE_REPORT_STATUS.SUPPORT_TRIAGE`;
- public `activeBuildId: "FB-12345678"` resolves to internal `FeatureBuild.id`;
- `threadId` is passed when available;
- `triggerKind` is passed as `"manual"`;
- `supportSessionId` is passed and dedupes repeated calls for the same user action;
- a conflicting existing `threadId` is not overwritten;
- rate limits reject the fourth support start inside one minute;
- if no active build is found, the action still writes route/thread/trigger with `featureBuildId: null`.

Expected writer call:

```ts
expect(createPlatformIssueReportMock).toHaveBeenCalledWith(
  expect.objectContaining({
    type: "user_report",
    title: expect.stringContaining("Support request"),
    source: "support_mode",
    status: ISSUE_REPORT_STATUS.SUPPORT_TRIAGE,
    routeContext: "/build",
    triggerKind: "manual",
    supportSessionId: "dpf_support_test",
    reportedById: "user-1",
    threadId: "thread-1",
    featureBuildId: "internal-feature-build-id",
  }),
);
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
pnpm --filter web exec vitest run lib/actions/feedback-support.test.ts
```

Expected: fail because action does not exist.

- [ ] **Step 3: Implement action**

Add:

```ts
"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { ISSUE_REPORT_STATUS } from "@/lib/quality/issue-report-status";
import { createPlatformIssueReport } from "@/lib/quality/platform-issue-reports";
import type { FeedbackEventDetail } from "@/lib/feedback/feedback-event";
```

Input should be:

```ts
type StartFeedbackSupportInput = {
  detail: FeedbackEventDetail;
  activeBuildId?: string | null; // public FB-* Build Studio buildId
  threadId?: string | null;
};
```

Require `detail.supportSessionId`, normalize route/trigger values, and reject oversized optional text fields. Look up existing reports by authenticated `reportedById` plus `supportSessionId` before creating. If an existing row has no `threadId`, update it with the validated user-owned thread. If it has a different `threadId`, return a conflict without overwriting.

Resolve public build ID:

```ts
const featureBuild = input.activeBuildId
  ? await prisma.featureBuild.findUnique({
      where: { buildId: input.activeBuildId },
      select: { id: true, threadId: true },
    })
  : null;
```

Create through the Phase 0 writer:

```ts
const { reportId } = await createPlatformIssueReport({
  type: input.detail.errorStack ? "runtime_error" : "user_report",
  title: input.detail.title ?? "Support request",
  description: input.detail.description ?? null,
  severity: input.detail.errorStack ? "high" : "medium",
  routeContext: input.detail.routeContext,
  errorStack: input.detail.errorStack ?? null,
  userAgent: input.detail.userAgent ?? null,
  source: "support_mode",
  status: ISSUE_REPORT_STATUS.SUPPORT_TRIAGE,
  triggerKind: input.detail.triggerKind,
  supportSessionId: input.detail.supportSessionId,
  reportedById: session.user.id,
  threadId: input.threadId ?? input.detail.threadId ?? featureBuild?.threadId ?? null,
  taskRunId: input.detail.taskRunId ?? null,
  featureBuildId: featureBuild?.id ?? null,
});
```

Return `{ ok: true, reportId }` or `{ ok: false, error: "..." }`. Do not throw into the client shell for normal failures. Enforce 3 support starts per user per minute and 10 per user per hour at this server boundary.

- [ ] **Step 4: Run action tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/actions/feedback-support.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add apps/web/lib/actions/feedback-support.ts apps/web/lib/actions/feedback-support.test.ts
git commit -s -m "feat(feedback): create support triage reports"
```

---

## Chunk 4: Existing Coworker Shell Support Entry

### Task 6: Open support entry from `open-agent-feedback`

**Files:**
- Modify: `apps/web/components/agent/AgentCoworkerShell.tsx`
- Create: `apps/web/components/agent/AgentCoworkerShell.test.tsx`

- [ ] **Step 1: Write failing shell tests**

Mock:

- `getOrCreateThreadSnapshot` to return `{ threadId: "thread-1", messages: [] }`;
- `startFeedbackSupport` from `@/lib/actions/feedback-support`;
- `AgentCoworkerPanel` to expose props in the DOM instead of rendering the full panel.

Test cases:

1. Dispatching `open-agent-feedback` with typed detail opens the panel.
2. The panel receives an injected support welcome message containing "What is stuck?" and "try to resolve it here".
3. When `build-studio-active-build` was previously dispatched with `"FB-12345678"`, the support action receives `{ activeBuildId: "FB-12345678", threadId: "thread-1" }`.
4. Support report creation is called once for a single support start, even if React effects re-run.
5. Legacy `open-agent-panel` still accepts `{ autoMessage, welcomeMessage, targetBuildId }`.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
pnpm --filter web exec vitest run components/agent/AgentCoworkerShell.test.tsx
```

Expected: fail because support detail is not handled.

- [ ] **Step 3: Extend shell event handling**

In `AgentCoworkerShell.tsx`:

- import `isFeedbackEventDetail`, `FeedbackEventDetail`, and `startFeedbackSupport`;
- keep legacy panel detail support unchanged;
- when event name is `open-agent-feedback` and detail is valid:
  - validate `isFeedbackEventDetail()` first, then call `preventDefault()` only after accepting a valid support event so malformed or unhandled events can still fall through to the existing fallback path;
  - set panel open and save preference;
  - inject a support welcome message, not a category form;
  - store pending support detail in state or ref;
  - create or reconcile the support report once per `supportSessionId`, updating the same report when `threadId` becomes available.

Recommended visible support copy:

```ts
const SUPPORT_WELCOME_MESSAGE =
  "What is stuck? I can help with this page first. If it looks like the project team needs to fix the platform, I will package a safe report for you to approve.";
```

Manual click should use `welcomeMessage` behavior and not force an immediate model call before Dale types. Future hard-failure triggers can pass `description` or `errorStack` and choose auto-send behavior in Phase 4.

- [ ] **Step 4: Preserve auto-message queueing**

Do not regress the existing target-build queue:

```ts
if (shouldDispatchAutoMessageImmediately({ targetBuildId, activeBuildId, threadId })) {
  setPendingAutoMessage(autoMessage);
}
```

The support path should reuse the current `activeBuildId` state from the `build-studio-active-build` event. Do not add a second build tracker.

- [ ] **Step 5: Run shell and agent tests**

Run:

```powershell
pnpm --filter web exec vitest run components/agent/AgentCoworkerShell.test.tsx components/agent/agent-auto-message.test.ts components/agent/AgentPanelHeader.test.tsx
```

Expected: all pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add apps/web/components/agent/AgentCoworkerShell.tsx apps/web/components/agent/AgentCoworkerShell.test.tsx
git commit -s -m "feat(feedback): open coworker support entry"
```

---

## Chunk 5: Verification, Evidence, And Ship Gate

### Task 7: Full automated verification

**Files:**
- Create: `docs/superpowers/evidence/2026-05-26-feedback-support-mode-entry-verification.md`

- [ ] **Step 1: Run targeted tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/feedback/feedback-event.test.ts lib/actions/feedback-support.test.ts lib/quality/platform-issue-reports.test.ts components/feedback/FeedbackButton.test.tsx components/feedback/HeaderFeedbackButton.test.tsx components/agent/AgentCoworkerShell.test.tsx
```

Expected: all pass.

- [ ] **Step 2: Run full web Vitest suite**

Run from `apps/web` as required by the handoff:

```powershell
cd apps/web
pnpm test
```

Expected: full suite passes. If there is a pre-existing failure, capture the exact test and prove whether the Phase 1 diff touches that surface.

- [ ] **Step 3: Run typecheck**

Run:

```powershell
pnpm --filter web typecheck
```

Expected: pass.

- [ ] **Step 4: Run production build**

Run:

```powershell
cd apps/web
pnpm exec next build
```

Expected: pass. Investigate new root-cause warnings; do not chase known environmental Turbopack noise unless it blocks the build.

- [ ] **Step 5: Apply migration cleanly**

Run against the local dev database:

```powershell
pnpm --filter @dpf/db exec prisma migrate dev
```

Expected: migration applies with no drift. If Build Studio uses a sandbox DB, record that migration apply result too.

### Task 8: Live UX and DB verification

**Files:**
- Update: `docs/superpowers/evidence/2026-05-26-feedback-support-mode-entry-verification.md`

- [ ] **Step 1: Rebuild and run Docker-served portal if needed**

Use the install's normal Docker path from the root install worktree, not a stale `next dev` session and not a linked feature worktree with an accidental root Compose project. If running from a linked worktree, first confirm it has a unique `COMPOSE_PROJECT_NAME`; otherwise run this from `D:\DPF` in the intentional production-path verification context:

```powershell
docker compose build --no-cache portal portal-init sandbox
docker compose up -d
```

If the environment is already running the exact build under test, record the image/version evidence instead of rebuilding unnecessarily.

- [ ] **Step 2: Drive `/build` feedback with Chrome MCP**

Open `http://localhost:3000/build`, log in as `admin@dpf.local` using `ADMIN_PASSWORD` from root `.env` if needed, and click Feedback.

Expected UI:

- existing coworker panel opens;
- support copy appears;
- fallback category form does not appear;
- no new support shell or modal appears.

- [ ] **Step 3: Verify DB row**

Run:

```powershell
docker exec dpf-postgres-1 psql -U dpf -d dpf -c "SELECT \"reportId\", status, source, \"triggerKind\", \"supportSessionId\" IS NOT NULL AS has_support_session, \"routeContext\", \"threadId\" IS NOT NULL AS has_thread, \"featureBuildId\" IS NOT NULL AS has_build FROM \"PlatformIssueReport\" WHERE status='support_triage' ORDER BY \"createdAt\" DESC LIMIT 3;"
```

Expected: newest row has `status=support_triage`, `source=support_mode`, `triggerKind=manual`, `has_support_session=true`, `routeContext=/build`, and `has_thread=true` when the coworker thread loaded. `has_build=true` only when a Build Studio active build exists.

- [ ] **Step 4: Verify fallback still posts**

Temporarily test a shell-unavailable path without source edits if possible: use a route/layout state where `AgentCoworkerShell` is not mounted, or in a browser devtools test remove the panel listener before click. Submit fallback form.

Expected DB row: `source=manual`, ordinary `status=open`, and the same `supportSessionId`/`triggerKind` carried from the click. No duplicate `support_triage` row should appear for the same user action unless the shell genuinely handled and reconciled that same support session.

- [ ] **Step 5: Verify non-build route**

Click Feedback on one non-build route such as `/platform/ai/providers`.

Expected: coworker opens with support copy; created report has the non-build `routeContext`, `triggerKind=manual`, `status=support_triage`, and no `featureBuildId`.

- [ ] **Step 6: Capture evidence**

Evidence doc must include:

- commands run and pass/fail result;
- Chrome MCP path driven;
- screenshots or text observations for `/build` and non-build support entry;
- SQL query output proving `routeContext`, `triggerKind`, `supportSessionId`, `threadId` when available, and `status=support_triage`;
- fallback-form result;
- explicit statement that Phase 2+ out-of-scope items were not implemented.

### Task 9: Final branch hygiene and PR

**Files:** all changed files.

- [ ] **Step 1: Inspect diff**

Run:

```powershell
git status --short
git diff --stat
git diff --check
```

Expected: only Phase 1 files changed; no whitespace errors.

- [ ] **Step 2: Push**

Run:

```powershell
git push -u origin HEAD
```

- [ ] **Step 3: Create PR only when ship gate is green**

Open the PR only after targeted tests, full `apps/web` `pnpm test`, typecheck, production build, migration apply, and live UX/DB evidence pass.

PR title:

```text
Phase 1: feedback support-mode entry
```

PR body must include:

- spec link;
- BI ID;
- summary of typed event detail, support report writer usage, and existing shell reuse;
- verification checklist with command output summaries;
- evidence doc link;
- note that Phase 2 `assessFeedbackRouting()`, Phase 3 bridge wiring, Phase 4 implicit triggers, Phase 5 reverse channel, and Phase 6 STT are not included.
