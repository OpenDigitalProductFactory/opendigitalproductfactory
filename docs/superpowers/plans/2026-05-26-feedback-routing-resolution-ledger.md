# Feedback Routing Resolution Ledger Implementation Plan

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Phase 2/2a for feedback: a pure `assessFeedbackRouting()` decision layer plus the `PlatformIssueResolution` ledger required before any upstream bridge filing.

**Architecture:** Keep `PlatformIssueReport` as the local source record and add a separate resolution layer around it. Support-mode report creation links immediately to a `routing` resolution; later support outcomes record scope, privacy/applicability seeds, report status, artifacts, install-state projection, notification idempotency, and a Dale-safe report timeline. This plan explicitly stops before GitHub issue filing, PR/release reconciliation, platform update application, STT, and Phase 3 bridge work.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 7, Vitest, pnpm workspace, DPF MCP backlog, Docker-served portal verification.

---

## Spec Anchor

- Backlog item: `BI-FBDC0861`
- Epic: `EP-9FC5D2FD`
- Specs:
  - `docs/superpowers/specs/2026-05-24-capacity-aware-feedback-escalation-design.md`
  - `docs/superpowers/specs/2026-05-26-feedback-resolution-closure-design.md`
- Existing prior plans:
  - `docs/superpowers/plans/2026-05-24-feedback-substrate-cleanup.md`
  - `docs/superpowers/plans/2026-05-26-feedback-support-mode-entry.md`

## Scope Check

This is one reviewable slice: Phase 2 plus Phase 2a only. It creates the routing decision and closure substrate that Phase 3 will depend on. Do not include upstream GitHub issue filing, PR/release marker parsing, webhook/polling, update application, or STT in this PR.

Use roughly 20 percent of the implementation budget on refactoring and substrate cleanup: keep report-status constants canonical, keep routing logic pure, keep ledger writes behind one service, and remove any duplicated notification or ID construction introduced while landing the slice. The user-facing payoff is that Dale sees one calm, trustworthy report timeline instead of implementation noise.

Implementation invariants:

- `PlatformIssueReport` remains the local source report; `PlatformIssueResolution*` records are closure/projection records around it.
- Every support-mode report gets an idempotent `routing` resolution when the support flow returns, including existing or reconciled reports that predate the ledger.
- Notification idempotency uses a deterministic `audienceKey`; do not rely on nullable columns inside unique indexes.
- Install-state idempotency uses a deterministic `installKey`; do not rely on nullable `installPrincipalId` uniqueness.
- `local_answered` is a first-class resolution status, artifact kind, and notification kind.
- Applicability targeting prefers exact `StorefrontConfig.archetypeId`; archetype category is evidence/fallback only.
- Phase 2/2a stores future bridge fields but does not file GitHub issues, parse PR/release markers, apply updates, or run a reconciler.

## File Map

- Create: `apps/web/lib/feedback-resolution/constants.ts`
- Create: `apps/web/lib/feedback-resolution/constants.test.ts`
- Create: `apps/web/lib/feedback-resolution/resolution-service.ts`
- Create: `apps/web/lib/feedback-resolution/resolution-service.test.ts`
- Create: `apps/web/lib/feedback-resolution/metrics.ts`
- Create: `apps/web/lib/feedback-resolution/metrics.test.ts`
- Create: `apps/web/lib/feedback-routing/assess-feedback-routing.ts`
- Create: `apps/web/lib/feedback-routing/assess-feedback-routing.test.ts`
- Create: `apps/web/lib/actions/feedback-routing.ts`
- Create: `apps/web/lib/actions/feedback-routing.test.ts`
- Create: `apps/web/lib/feedback/report-timeline.ts`
- Create: `apps/web/lib/feedback/report-timeline.test.ts`
- Create: `apps/web/components/feedback/FeedbackReportTimeline.tsx`
- Create: `apps/web/components/feedback/FeedbackReportTimeline.test.tsx`
- Create: `apps/web/app/(shell)/feedback/reports/[reportId]/page.tsx`
- Modify: `packages/db/prisma/schema.prisma`
- Modify: `apps/web/lib/actions/feedback-support.ts`
- Modify: `apps/web/lib/actions/feedback-support.test.ts`
- Create: `docs/superpowers/evidence/2026-05-26-feedback-routing-resolution-ledger-verification.md`

---

## Task 0: Baseline And Refactor Budget

**Files:**
- Read: `apps/web/lib/quality/issue-report-status.ts`
- Read: `apps/web/lib/quality/platform-issue-reports.ts`
- Read: `apps/web/lib/actions/feedback-support.ts`
- Read: `apps/web/lib/actions/feedback-support.test.ts`
- Read: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Confirm the current substrate**

Inspect the current report-status constants, canonical `createPlatformIssueReport()` writer, support action, and `PlatformIssueReport` schema before adding new rows. Confirm the work starts from the Phase 0/1 substrate in the two existing feedback plans.

- [ ] **Step 2: Run baseline tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/quality/issue-report-status.test.ts lib/quality/platform-issue-reports.test.ts lib/actions/feedback-support.test.ts
```

Expected: existing feedback support tests pass before ledger work begins. If a pre-existing failure appears, capture it in the evidence doc and fix it if it blocks this slice.

- [ ] **Step 3: Apply the refactor budget deliberately**

During the following tasks, spend the cleanup budget on:

- one canonical ID helper for `PIRR-*` and `PIRA-*`;
- one canonical audience/install key helper for nullable audience dimensions;
- one routing-service entry point for report, resolution, artifact, install-state, and notification writes;
- no duplicated status strings outside the constants modules.

## Task 1: Resolution Constants

**Files:**
- Create: `apps/web/lib/feedback-resolution/constants.ts`
- Create: `apps/web/lib/feedback-resolution/constants.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/feedback-resolution/constants.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  FEEDBACK_RESOLUTION_ARTIFACT_KIND,
  FEEDBACK_RESOLUTION_NOTIFICATION_KIND,
  FEEDBACK_RESOLUTION_SCOPE,
  FEEDBACK_RESOLUTION_STATUS,
  INSTALL_APPLICATION_STATE,
  INSTALL_APPLICABILITY_STATE,
  INSTALL_AVAILABILITY_STATE,
} from "./constants";

describe("feedback resolution constants", () => {
  it("defines the resolution statuses from the closure contract", () => {
    expect(Object.values(FEEDBACK_RESOLUTION_STATUS)).toEqual([
      "routing",
      "local_answered",
      "local_work_needed",
      "upstream_needed",
      "fix_in_progress",
      "fix_merged",
      "fix_available",
      "update_required",
      "applied_here",
      "verified_here",
      "not_applicable",
      "blocked",
      "superseded",
    ]);
  });

  it("defines scope, artifact, install, and notification vocabularies", () => {
    expect(Object.values(FEEDBACK_RESOLUTION_SCOPE)).toEqual(["instance", "archetype", "project"]);
    expect(Object.values(FEEDBACK_RESOLUTION_ARTIFACT_KIND)).toContain("platform_issue_report");
    expect(Object.values(FEEDBACK_RESOLUTION_ARTIFACT_KIND)).toContain("local_answer");
    expect(Object.values(FEEDBACK_RESOLUTION_ARTIFACT_KIND)).toContain("resolution_link");
    expect(Object.values(FEEDBACK_RESOLUTION_NOTIFICATION_KIND)).toContain("local_answered");
    expect(Object.values(INSTALL_APPLICABILITY_STATE)).toEqual(["applicable", "not_applicable", "unknown", "blocked"]);
    expect(Object.values(INSTALL_AVAILABILITY_STATE)).toEqual(["unavailable", "available", "update_pending", "conflict", "blocked"]);
    expect(Object.values(INSTALL_APPLICATION_STATE)).toEqual(["not_applied", "applied", "verified", "failed"]);
  });
});
```

- [ ] **Step 2: Run it to verify red**

Run:

```powershell
pnpm --filter web exec vitest run lib/feedback-resolution/constants.test.ts
```

Expected: fails because `constants.ts` does not exist.

- [ ] **Step 3: Implement the constants**

Create `apps/web/lib/feedback-resolution/constants.ts`:

```ts
export const FEEDBACK_RESOLUTION_STATUS = {
  ROUTING: "routing",
  LOCAL_ANSWERED: "local_answered",
  LOCAL_WORK_NEEDED: "local_work_needed",
  UPSTREAM_NEEDED: "upstream_needed",
  FIX_IN_PROGRESS: "fix_in_progress",
  FIX_MERGED: "fix_merged",
  FIX_AVAILABLE: "fix_available",
  UPDATE_REQUIRED: "update_required",
  APPLIED_HERE: "applied_here",
  VERIFIED_HERE: "verified_here",
  NOT_APPLICABLE: "not_applicable",
  BLOCKED: "blocked",
  SUPERSEDED: "superseded",
} as const;

export type FeedbackResolutionStatus =
  (typeof FEEDBACK_RESOLUTION_STATUS)[keyof typeof FEEDBACK_RESOLUTION_STATUS];

export const FEEDBACK_RESOLUTION_SCOPE = {
  INSTANCE: "instance",
  ARCHETYPE: "archetype",
  PROJECT: "project",
} as const;

export type FeedbackResolutionScope =
  (typeof FEEDBACK_RESOLUTION_SCOPE)[keyof typeof FEEDBACK_RESOLUTION_SCOPE];

export const FEEDBACK_RESOLUTION_ARTIFACT_KIND = {
  PLATFORM_ISSUE_REPORT: "platform_issue_report",
  LOCAL_ANSWER: "local_answer",
  BACKLOG_ITEM: "backlog_item",
  FEATURE_BUILD: "feature_build",
  WORK_CAPSULE: "work_capsule",
  GITHUB_ISSUE: "github_issue",
  GITHUB_PR: "github_pr",
  MERGE_COMMIT: "merge_commit",
  PRODUCT_VERSION: "product_version",
  CHANGE_PROMOTION: "change_promotion",
  SELF_UPGRADE_RUN: "self_upgrade_run",
  PLATFORM_UPDATE: "platform_update",
  NOTIFICATION: "notification",
  VERIFICATION: "verification",
  RESOLUTION_LINK: "resolution_link",
} as const;

export type FeedbackResolutionArtifactKind =
  (typeof FEEDBACK_RESOLUTION_ARTIFACT_KIND)[keyof typeof FEEDBACK_RESOLUTION_ARTIFACT_KIND];

export const FEEDBACK_RESOLUTION_NOTIFICATION_KIND = {
  LOCAL_ANSWERED: "local_answered",
  FIX_AVAILABLE: "fix_available",
  UPDATE_REQUIRED: "update_required",
  INSTALLED_HERE: "installed_here",
  BLOCKED: "blocked",
  NOT_APPLICABLE: "not_applicable",
} as const;

export type FeedbackResolutionNotificationKind =
  (typeof FEEDBACK_RESOLUTION_NOTIFICATION_KIND)[keyof typeof FEEDBACK_RESOLUTION_NOTIFICATION_KIND];

export const INSTALL_APPLICABILITY_STATE = {
  APPLICABLE: "applicable",
  NOT_APPLICABLE: "not_applicable",
  UNKNOWN: "unknown",
  BLOCKED: "blocked",
} as const;

export const INSTALL_AVAILABILITY_STATE = {
  UNAVAILABLE: "unavailable",
  AVAILABLE: "available",
  UPDATE_PENDING: "update_pending",
  CONFLICT: "conflict",
  BLOCKED: "blocked",
} as const;

export const INSTALL_APPLICATION_STATE = {
  NOT_APPLIED: "not_applied",
  APPLIED: "applied",
  VERIFIED: "verified",
  FAILED: "failed",
} as const;
```

- [ ] **Step 4: Verify green**

Run:

```powershell
pnpm --filter web exec vitest run lib/feedback-resolution/constants.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add apps/web/lib/feedback-resolution/constants.ts apps/web/lib/feedback-resolution/constants.test.ts
git commit -s -m "feat(feedback): add resolution constants"
```

---

## Task 2: Prisma Ledger Models

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add report routing fields and ledger models to the schema**

Add these nullable/additive fields to `PlatformIssueReport` so routing decisions and support summaries are stored on the local source report:

```prisma
  capacityDecision          String?
  capacityDecisionReasons   Json      @default("[]")
  supportSummary            String?   @db.Text
  resolvedAt                DateTime?
  coalesceKey               String?
  coalesceBucket            String?
  occurrenceCount           Int       @default(1)
  lastSeenAt                DateTime?
  escalationAcknowledgedAt  DateTime?
  escalationAcknowledgedById String?
  escalationPolicy          Json      @default("{}")

  @@index([status, capacityDecision])
  @@index([coalesceKey])
```

Append these models near `PlatformIssueReport` so the feedback/quality substrate stays easy to scan:

```prisma
model PlatformIssueResolution {
  id                       String   @id @default(cuid())
  resolutionId             String   @unique
  title                    String
  summary                  String?  @db.Text
  status                   String   @default("routing")
  scope                    String   @default("instance")
  source                   String
  producerKind             String?
  producerAgentId          String?
  producerToolExecId       String?
  sourcePseudonym          String?
  sourceArchetypeId        String?
  sourceArchetypeCategory  String?
  targetArchetypeIds       String[] @default([])
  excludedArchetypeIds     String[] @default([])
  requiresCapabilityFlags  String[] @default([])
  privacyDecision          Json     @default("{}")
  applicabilityDecision    Json     @default("{}")
  fixedInVersion           String?
  fixedInGitSha            String?
  releaseChannel           String?
  availableAt              DateTime?
  appliedAt                DateTime?
  verifiedAt               DateTime?
  reports                  PlatformIssueResolutionReport[]
  artifacts                PlatformIssueResolutionArtifact[]
  installStates            PlatformIssueResolutionInstallState[]
  notifications            PlatformIssueResolutionNotification[]
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt

  @@index([status, scope])
  @@index([fixedInGitSha])
  @@index([createdAt])
}

model PlatformIssueResolutionReport {
  id            String   @id @default(cuid())
  resolutionId  String
  reportId      String
  role          String   @default("primary")
  createdAt     DateTime @default(now())
  resolution    PlatformIssueResolution @relation(fields: [resolutionId], references: [resolutionId], onDelete: Cascade)
  report        PlatformIssueReport     @relation(fields: [reportId], references: [reportId], onDelete: Cascade)

  @@unique([resolutionId, reportId])
  @@index([reportId])
}

model PlatformIssueResolutionArtifact {
  id            String   @id @default(cuid())
  artifactId    String   @unique
  resolutionId  String
  kind          String
  dedupeKey     String
  localId       String?
  semanticId    String?
  url           String?
  gitSha        String?
  version       String?
  status        String?
  producerKind  String?
  evidence      Json     @default("{}")
  createdAt     DateTime @default(now())
  resolution    PlatformIssueResolution @relation(fields: [resolutionId], references: [resolutionId], onDelete: Cascade)

  @@unique([resolutionId, kind, dedupeKey])
  @@index([resolutionId, kind])
  @@index([semanticId])
  @@index([gitSha])
}

model PlatformIssueResolutionInstallState {
  id                  String   @id @default(cuid())
  resolutionId        String
  installPrincipalId  String?
  dedupeKey           String   @unique
  applicability       String   @default("unknown")
  availability        String   @default("unavailable")
  application         String   @default("not_applied")
  localVersion        String?
  localGitSha         String?
  targetVersion       String?
  targetGitSha        String?
  blockingReason      String?
  lastCheckedAt       DateTime @default(now())
  updatedAt           DateTime @updatedAt
  resolution          PlatformIssueResolution @relation(fields: [resolutionId], references: [resolutionId], onDelete: Cascade)

  @@index([resolutionId])
  @@index([installPrincipalId])
  @@index([applicability, availability, application])
}

model PlatformIssueResolutionNotification {
  id                String   @id @default(cuid())
  resolutionId      String
  reportId          String?
  installPrincipalId String?
  userId            String?
  dedupeKey         String   @unique
  notificationKind  String
  notificationId    String?  @unique
  createdAt         DateTime @default(now())
  resolution        PlatformIssueResolution @relation(fields: [resolutionId], references: [resolutionId], onDelete: Cascade)
  notification      Notification?           @relation(fields: [notificationId], references: [id], onDelete: SetNull)

  @@index([resolutionId, notificationKind])
  @@index([notificationId])
  @@index([userId])
}
```

Also add inverse relation fields to existing models:

```prisma
model PlatformIssueReport {
  // existing fields...
  resolutionLinks PlatformIssueResolutionReport[]
}

model Notification {
  // existing fields...
  feedbackResolutionLinks PlatformIssueResolutionNotification[]
}
```

- [ ] **Step 2: Create the migration**

Run:

```powershell
pnpm --filter @dpf/db exec prisma migrate dev --name feedback_resolution_ledger
```

Expected: Prisma creates a migration adding the five `PlatformIssueResolution*` tables with indexes and unique constraints.

- [ ] **Step 3: Validate schema**

Run:

```powershell
pnpm --filter @dpf/db exec prisma validate
pnpm --filter @dpf/db exec prisma generate
```

Expected: both commands pass.

- [ ] **Step 4: Commit**

Run:

```powershell
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -s -m "feat(db): add feedback resolution ledger tables"
```

---

## Task 3: Resolution Service

**Files:**
- Create: `apps/web/lib/feedback-resolution/resolution-service.ts`
- Create: `apps/web/lib/feedback-resolution/resolution-service.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `apps/web/lib/feedback-resolution/resolution-service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FEEDBACK_RESOLUTION_ARTIFACT_KIND, FEEDBACK_RESOLUTION_STATUS } from "./constants";

const prismaMock = vi.hoisted(() => ({
  platformIssueReport: { findUnique: vi.fn(), update: vi.fn() },
  platformIssueResolution: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  platformIssueResolutionReport: { create: vi.fn(), findFirst: vi.fn() },
  platformIssueResolutionArtifact: { create: vi.fn(), findFirst: vi.fn(), upsert: vi.fn() },
  platformIssueResolutionInstallState: { upsert: vi.fn() },
  platformIssueResolutionNotification: { create: vi.fn(), findUnique: vi.fn() },
  notification: { create: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock)),
}));

vi.mock("@dpf/db", () => ({ prisma: prismaMock }));

import {
  appendResolutionArtifact,
  createOrGetResolutionForReport,
  createResolutionNotificationOnce,
  recordRoutingDecision,
} from "./resolution-service";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.platformIssueReport.findUnique.mockResolvedValue({
    reportId: "PIR-AAA11",
    title: "Support session started",
    routeContext: "/build",
    reportedById: "user-1",
  });
  prismaMock.platformIssueResolutionReport.findFirst.mockResolvedValue(null);
  prismaMock.platformIssueResolution.create.mockResolvedValue({
    resolutionId: "PIRR-AAA11",
    status: "routing",
  });
  prismaMock.platformIssueResolutionReport.create.mockResolvedValue({});
  prismaMock.platformIssueResolutionArtifact.findFirst.mockResolvedValue(null);
  prismaMock.platformIssueResolutionArtifact.create.mockResolvedValue({});
  prismaMock.platformIssueResolutionArtifact.upsert.mockResolvedValue({});
  prismaMock.platformIssueResolutionNotification.findUnique.mockResolvedValue(null);
  prismaMock.notification.create.mockResolvedValue({ id: "notif-1" });
  prismaMock.platformIssueResolutionNotification.create.mockResolvedValue({});
});

describe("resolution-service", () => {
  it("creates a routing resolution, report join, report artifact, and install state", async () => {
    const result = await createOrGetResolutionForReport({
      reportId: "PIR-AAA11",
      source: "support",
      scope: "instance",
    });

    expect(result.resolutionId).toMatch(/^PIRR-/);
    expect(prismaMock.platformIssueResolution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: FEEDBACK_RESOLUTION_STATUS.ROUTING,
          scope: "instance",
          source: "support",
        }),
      }),
    );
    expect(prismaMock.platformIssueResolutionReport.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reportId: "PIR-AAA11", role: "primary" }),
      }),
    );
    expect(prismaMock.platformIssueResolutionArtifact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: FEEDBACK_RESOLUTION_ARTIFACT_KIND.PLATFORM_ISSUE_REPORT,
          semanticId: "PIR-AAA11",
        }),
      }),
    );
    expect(prismaMock.platformIssueResolutionInstallState.upsert).toHaveBeenCalled();
  });

  it("dedupes artifacts by resolutionId, kind, and dedupeKey", async () => {
    prismaMock.platformIssueResolutionArtifact.findFirst.mockResolvedValue({ artifactId: "PIRA-OLD" });
    const artifact = await appendResolutionArtifact({
      resolutionId: "PIRR-AAA11",
      kind: "platform_issue_report",
      dedupeKey: "PIR-AAA11",
      semanticId: "PIR-AAA11",
      evidence: { routeContext: "/build" },
    });
    expect(artifact.artifactId).toBe("PIRA-OLD");
    expect(prismaMock.platformIssueResolutionArtifact.create).not.toHaveBeenCalled();
  });

  it("records routing decision without upstream send", async () => {
    await recordRoutingDecision({
      resolutionId: "PIRR-AAA11",
      reportId: "PIR-AAA11",
      route: "upstream",
      scope: "project",
      expectedClosurePath: "upstream_issue_pr_release",
      privacySeed: { canShareUpstream: false, requiresSecretScan: true, requiresAcknowledgement: true },
      reasons: ["support loop did not converge"],
    });

    expect(prismaMock.platformIssueResolution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { resolutionId: "PIRR-AAA11" },
        data: expect.objectContaining({
          status: FEEDBACK_RESOLUTION_STATUS.UPSTREAM_NEEDED,
          scope: "project",
        }),
      }),
    );
    expect(prismaMock.platformIssueReport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { reportId: "PIR-AAA11" },
        data: expect.objectContaining({
          status: "awaiting_escalation_ack",
          capacityDecision: "upstream",
          capacityDecisionReasons: ["support loop did not converge"],
        }),
      }),
    );
  });

  it("records local answers as closure artifacts and marks the report resolved", async () => {
    await recordRoutingDecision({
      resolutionId: "PIRR-AAA11",
      reportId: "PIR-AAA11",
      route: "resolved_locally",
      scope: "instance",
      expectedClosurePath: "local_answer",
      privacySeed: { canShareUpstream: false, requiresSecretScan: false, requiresAcknowledgement: false },
      reasons: ["support answered the report locally"],
      supportSummary: "Use the provider settings panel.",
    });

    expect(prismaMock.platformIssueResolutionArtifact.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          resolutionId_kind_dedupeKey: {
            resolutionId: "PIRR-AAA11",
            kind: "local_answer",
            dedupeKey: "PIR-AAA11:local_answer",
          },
        },
        create: expect.objectContaining({
          kind: FEEDBACK_RESOLUTION_ARTIFACT_KIND.LOCAL_ANSWER,
          status: "complete",
        }),
      }),
    );
    expect(prismaMock.platformIssueReport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { reportId: "PIR-AAA11" },
        data: expect.objectContaining({
          status: "resolved_locally",
          capacityDecision: "resolved_locally",
          supportSummary: "Use the provider settings panel.",
        }),
      }),
    );
  });

  it("creates local-answer notifications once per resolution, audience, and kind", async () => {
    await createResolutionNotificationOnce({
      resolutionId: "PIRR-AAA11",
      reportId: "PIR-AAA11",
      userId: "user-1",
      notificationKind: "local_answered",
      title: "Feedback handled here",
      body: "Your Feedback report was handled here.",
      deepLink: "/feedback/reports/PIR-AAA11",
    });

    expect(prismaMock.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        type: "feedback_local_answered",
        deepLink: "/feedback/reports/PIR-AAA11",
      }),
    });
    expect(prismaMock.platformIssueResolutionNotification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          audienceKey: "install:local|user:user-1",
          notificationKind: "local_answered",
          notificationId: "notif-1",
        }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify red**

Run:

```powershell
pnpm --filter web exec vitest run lib/feedback-resolution/resolution-service.test.ts
```

Expected: fails because the service does not exist.

- [ ] **Step 3: Implement the service**

Create `apps/web/lib/feedback-resolution/resolution-service.ts` with these exported functions:

```ts
import { prisma } from "@dpf/db";
import { randomUUID } from "node:crypto";
import { ISSUE_REPORT_STATUS } from "@/lib/quality/issue-report-status";
import {
  FEEDBACK_RESOLUTION_ARTIFACT_KIND,
  FEEDBACK_RESOLUTION_SCOPE,
  FEEDBACK_RESOLUTION_STATUS,
  INSTALL_APPLICATION_STATE,
  INSTALL_APPLICABILITY_STATE,
  INSTALL_AVAILABILITY_STATE,
  type FeedbackResolutionArtifactKind,
  type FeedbackResolutionNotificationKind,
  type FeedbackResolutionScope,
} from "./constants";

function semanticId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function installKey(installPrincipalId: string | null): string {
  return installPrincipalId ? `install:${installPrincipalId}` : "install:local";
}

function notificationAudienceKey(input: {
  installPrincipalId?: string | null;
  userId?: string | null;
}): string {
  return `${installKey(input.installPrincipalId ?? null)}|user:${input.userId ?? "none"}`;
}

export async function createOrGetResolutionForReport(input: {
  reportId: string;
  source: "support" | "triage" | "build_studio" | "upstream" | "system";
  scope?: FeedbackResolutionScope;
}): Promise<{ resolutionId: string }> {
  const existing = await prisma.platformIssueResolutionReport.findFirst({
    where: { reportId: input.reportId, role: "primary" },
    select: { resolutionId: true },
  });
  if (existing) return { resolutionId: existing.resolutionId };

  const report = await prisma.platformIssueReport.findUnique({
    where: { reportId: input.reportId },
    select: { reportId: true, title: true, routeContext: true, reportedById: true },
  });
  if (!report) throw new Error(`PlatformIssueReport not found: ${input.reportId}`);

  return prisma.$transaction(async (tx) => {
    const created = await tx.platformIssueResolution.create({
      data: {
        resolutionId: semanticId("PIRR"),
        title: report.title,
        status: FEEDBACK_RESOLUTION_STATUS.ROUTING,
        scope: input.scope ?? FEEDBACK_RESOLUTION_SCOPE.INSTANCE,
        source: input.source,
        privacyDecision: {},
        applicabilityDecision: {},
      },
      select: { resolutionId: true },
    });

    await tx.platformIssueResolutionReport.create({
      data: { resolutionId: created.resolutionId, reportId: report.reportId, role: "primary" },
    });

    await tx.platformIssueResolutionArtifact.create({
      data: {
        artifactId: semanticId("PIRA"),
        resolutionId: created.resolutionId,
        kind: FEEDBACK_RESOLUTION_ARTIFACT_KIND.PLATFORM_ISSUE_REPORT,
        dedupeKey: report.reportId,
        semanticId: report.reportId,
        evidence: { routeContext: report.routeContext },
      },
    });

    const localInstallKey = installKey(null);

    await tx.platformIssueResolutionInstallState.upsert({
      where: {
        resolutionId_installKey: {
          resolutionId: created.resolutionId,
          installKey: localInstallKey,
        },
      },
      update: { lastCheckedAt: new Date() },
      create: {
        resolutionId: created.resolutionId,
        installPrincipalId: null,
        installKey: localInstallKey,
        applicability: INSTALL_APPLICABILITY_STATE.UNKNOWN,
        availability: INSTALL_AVAILABILITY_STATE.UNAVAILABLE,
        application: INSTALL_APPLICATION_STATE.NOT_APPLIED,
      },
    });

    return { resolutionId: created.resolutionId };
  });
}

export async function appendResolutionArtifact(input: {
  resolutionId: string;
  kind: FeedbackResolutionArtifactKind;
  dedupeKey: string;
  localId?: string | null;
  semanticId?: string | null;
  url?: string | null;
  gitSha?: string | null;
  version?: string | null;
  status?: string | null;
  producerKind?: string | null;
  evidence?: Record<string, unknown>;
}): Promise<{ artifactId: string }> {
  const existing = await prisma.platformIssueResolutionArtifact.findFirst({
    where: { resolutionId: input.resolutionId, kind: input.kind, dedupeKey: input.dedupeKey },
    select: { artifactId: true },
  });
  if (existing) return existing;

  return prisma.platformIssueResolutionArtifact.create({
    data: {
      artifactId: semanticId("PIRA"),
      resolutionId: input.resolutionId,
      kind: input.kind,
      dedupeKey: input.dedupeKey,
      localId: input.localId ?? null,
      semanticId: input.semanticId ?? null,
      url: input.url ?? null,
      gitSha: input.gitSha ?? null,
      version: input.version ?? null,
      status: input.status ?? null,
      producerKind: input.producerKind ?? null,
      evidence: input.evidence ?? {},
    },
    select: { artifactId: true },
  });
}

export async function recordRoutingDecision(input: {
  resolutionId: string;
  reportId: string;
  route: "resolved_locally" | "local_bi" | "upstream" | "ask";
  scope: FeedbackResolutionScope;
  expectedClosurePath: string;
  privacySeed: Record<string, unknown>;
  reasons: string[];
  applicabilitySeed?: Record<string, unknown>;
  supportSummary?: string | null;
}): Promise<void> {
  const resolutionStatus =
    input.route === "resolved_locally"
      ? FEEDBACK_RESOLUTION_STATUS.LOCAL_ANSWERED
      : input.route === "local_bi"
        ? FEEDBACK_RESOLUTION_STATUS.LOCAL_WORK_NEEDED
        : input.route === "upstream"
          ? FEEDBACK_RESOLUTION_STATUS.UPSTREAM_NEEDED
          : FEEDBACK_RESOLUTION_STATUS.ROUTING;

  const reportStatus =
    input.route === "resolved_locally"
      ? ISSUE_REPORT_STATUS.RESOLVED_LOCALLY
      : input.route === "local_bi"
        ? ISSUE_REPORT_STATUS.TRIAGED_LOCAL
        : input.route === "upstream"
          ? ISSUE_REPORT_STATUS.AWAITING_ESCALATION_ACK
          : ISSUE_REPORT_STATUS.SUPPORT_TRIAGE;

  await prisma.$transaction(async (tx) => {
    await tx.platformIssueResolution.update({
      where: { resolutionId: input.resolutionId },
      data: {
        status: resolutionStatus,
        scope: input.scope,
        privacyDecision: input.privacySeed,
        applicabilityDecision: {
          expectedClosurePath: input.expectedClosurePath,
          reasons: input.reasons,
          ...(input.applicabilitySeed ?? {}),
        },
      },
    });
    await tx.platformIssueReport.update({
      where: { reportId: input.reportId },
      data: {
        status: reportStatus,
        capacityDecision: input.route,
        capacityDecisionReasons: input.reasons,
        supportSummary: input.supportSummary ?? null,
        ...(input.route === "resolved_locally" ? { resolvedAt: new Date() } : {}),
      },
    });

    if (input.route === "resolved_locally") {
      await tx.platformIssueResolutionArtifact.upsert({
        where: {
          resolutionId_kind_dedupeKey: {
            resolutionId: input.resolutionId,
            kind: FEEDBACK_RESOLUTION_ARTIFACT_KIND.LOCAL_ANSWER,
            dedupeKey: `${input.reportId}:local_answer`,
          },
        },
        update: {
          status: "complete",
          evidence: { reasons: input.reasons, supportSummary: input.supportSummary ?? null },
        },
        create: {
          artifactId: semanticId("PIRA"),
          resolutionId: input.resolutionId,
          kind: FEEDBACK_RESOLUTION_ARTIFACT_KIND.LOCAL_ANSWER,
          dedupeKey: `${input.reportId}:local_answer`,
          semanticId: input.reportId,
          status: "complete",
          evidence: { reasons: input.reasons, supportSummary: input.supportSummary ?? null },
        },
      });
    }
  });
}

export async function createResolutionNotificationOnce(input: {
  resolutionId: string;
  reportId?: string | null;
  userId: string;
  notificationKind: FeedbackResolutionNotificationKind;
  title: string;
  body: string;
  deepLink: string;
}): Promise<{ notificationId: string | null; created: boolean }> {
  const audienceKey = notificationAudienceKey({
    installPrincipalId: null,
    userId: input.userId,
  });
  const existing = await prisma.platformIssueResolutionNotification.findUnique({
    where: {
      resolutionId_audienceKey_notificationKind: {
        resolutionId: input.resolutionId,
        audienceKey,
        notificationKind: input.notificationKind,
      },
    },
    select: { notificationId: true },
  });
  if (existing) return { notificationId: existing.notificationId, created: false };

  const notification = await prisma.notification.create({
    data: {
      userId: input.userId,
      type: `feedback_${input.notificationKind}`,
      title: input.title,
      body: input.body,
      deepLink: input.deepLink,
    },
    select: { id: true },
  });

  await prisma.platformIssueResolutionNotification.create({
    data: {
      resolutionId: input.resolutionId,
      reportId: input.reportId ?? null,
      installPrincipalId: null,
      userId: input.userId,
      audienceKey,
      notificationKind: input.notificationKind,
      notificationId: notification.id,
    },
  });

  return { notificationId: notification.id, created: true };
}
```

- [ ] **Step 4: Run the tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/feedback-resolution/resolution-service.test.ts
```

Expected: service tests pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add apps/web/lib/feedback-resolution packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -s -m "feat(feedback): add resolution ledger service"
```

---

## Task 4: Pure Routing Decision

**Files:**
- Create: `apps/web/lib/feedback-routing/assess-feedback-routing.ts`
- Create: `apps/web/lib/feedback-routing/assess-feedback-routing.test.ts`

- [ ] **Step 1: Write failing routing tests**

Create `apps/web/lib/feedback-routing/assess-feedback-routing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assessFeedbackRouting } from "./assess-feedback-routing";

describe("assessFeedbackRouting", () => {
  it("resolves a local answer without upstream sharing", () => {
    expect(assessFeedbackRouting({
      triggerKind: "manual",
      supportOutcome: "answered",
      routeContext: "/platform/ai/providers",
      buildStudio: { hasStrongRemoteProvider: true },
      contributionMode: "selective",
      privacy: { hasSecretRisk: false },
    })).toMatchObject({
      route: "resolved_locally",
      scope: "instance",
      expectedClosurePath: "local_answer",
      privacySeed: { canShareUpstream: false, requiresSecretScan: false, requiresAcknowledgement: false },
    });
  });

  it("routes provider setup to local admin action instead of upstream", () => {
    expect(assessFeedbackRouting({
      triggerKind: "manual",
      supportOutcome: "blocked",
      routeContext: "/build",
      buildStudio: { hasStrongRemoteProvider: false },
      contributionMode: "selective",
      privacy: { hasSecretRisk: false },
    })).toMatchObject({
      route: "ask",
      scope: "instance",
      expectedClosurePath: "admin_action",
    });
  });

  it("recommends upstream for repeated platform failure without sending", () => {
    expect(assessFeedbackRouting({
      triggerKind: "structural-verification-fail",
      supportOutcome: "not_converged",
      routeContext: "/build",
      repeatedFailureCount: 3,
      buildStudio: { hasStrongRemoteProvider: true },
      contributionMode: "selective",
      privacy: { hasSecretRisk: false },
      archetype: {
        sourceArchetypeId: "storefront-photography",
        sourceArchetypeCategory: "services",
        shareArchetypeInUpstream: true,
      },
    })).toMatchObject({
      route: "upstream",
      scope: "project",
      acknowledgement: "required",
      expectedClosurePath: "upstream_issue_pr_release",
      privacySeed: { canShareUpstream: true, requiresSecretScan: true, requiresAcknowledgement: true },
      applicabilitySeed: {
        sourceArchetypeId: "storefront-photography",
        targetArchetypeIds: ["storefront-photography"],
        sourceArchetypeCategory: "services",
        categoryFallbackOnly: false,
      },
    });
  });

  it("blocks upstream shareability when privacy risk exists", () => {
    expect(assessFeedbackRouting({
      triggerKind: "runtime-error",
      supportOutcome: "not_converged",
      routeContext: "/customer/acme/jobs",
      repeatedFailureCount: 2,
      buildStudio: { hasStrongRemoteProvider: true },
      contributionMode: "contribute_all",
      privacy: { hasSecretRisk: true },
    })).toMatchObject({
      route: "upstream",
      privacySeed: { canShareUpstream: false, requiresSecretScan: true, requiresAcknowledgement: true },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify red**

Run:

```powershell
pnpm --filter web exec vitest run lib/feedback-routing/assess-feedback-routing.test.ts
```

Expected: fails because the module does not exist.

- [ ] **Step 3: Implement the pure function**

Create `apps/web/lib/feedback-routing/assess-feedback-routing.ts`:

```ts
import type { FeedbackTriggerKind } from "@/lib/feedback/feedback-event";
import type { FeedbackResolutionScope } from "@/lib/feedback-resolution/constants";

export type FeedbackRoutingSupportOutcome = "answered" | "blocked" | "not_converged" | "local_work";

export type FeedbackRoutingDecision =
  | (FeedbackRoutingBase & { route: "resolved_locally" })
  | (FeedbackRoutingBase & { route: "local_bi"; suggestedBacklogTitle: string })
  | (FeedbackRoutingBase & { route: "upstream"; acknowledgement: "not_required" | "required" })
  | (FeedbackRoutingBase & { route: "ask"; prompt: string });

export type FeedbackRoutingBase = {
  reasons: string[];
  scope: FeedbackResolutionScope;
  expectedClosurePath:
    | "local_answer"
    | "local_backlog"
    | "local_build"
    | "upstream_issue_pr_release"
    | "admin_action";
  privacySeed: {
    canShareUpstream: boolean;
    requiresSecretScan: boolean;
    requiresAcknowledgement: boolean;
  };
  applicabilitySeed: {
    sourceArchetypeId: string | null;
    sourceArchetypeCategory: string | null;
    targetArchetypeIds: string[];
    categoryFallbackOnly: boolean;
    shareArchetypeInUpstream: boolean;
  };
};

export function assessFeedbackRouting(input: {
  triggerKind: FeedbackTriggerKind;
  supportOutcome: FeedbackRoutingSupportOutcome;
  routeContext: string;
  repeatedFailureCount?: number;
  buildStudio: { hasStrongRemoteProvider: boolean };
  contributionMode: "fork_only" | "selective" | "contribute_all";
  privacy: { hasSecretRisk: boolean };
  archetype?: {
    sourceArchetypeId?: string | null;
    sourceArchetypeCategory?: string | null;
    shareArchetypeInUpstream?: boolean;
  };
}): FeedbackRoutingDecision {
  const applicabilitySeed = buildApplicabilitySeed(input.archetype);

  if (input.supportOutcome === "answered") {
    return {
      route: "resolved_locally",
      reasons: ["support answered the report locally"],
      scope: "instance",
      expectedClosurePath: "local_answer",
      privacySeed: { canShareUpstream: false, requiresSecretScan: false, requiresAcknowledgement: false },
      applicabilitySeed,
    };
  }

  if (input.routeContext.startsWith("/build") && !input.buildStudio.hasStrongRemoteProvider) {
    return {
      route: "ask",
      prompt: "This looks like local provider setup. An admin should connect a strong remote provider before sending a project issue.",
      reasons: ["Build Studio lacks a strong remote provider"],
      scope: "instance",
      expectedClosurePath: "admin_action",
      privacySeed: { canShareUpstream: false, requiresSecretScan: false, requiresAcknowledgement: false },
      applicabilitySeed,
    };
  }

  if (input.supportOutcome === "local_work") {
    return {
      route: "local_bi",
      suggestedBacklogTitle: `Feedback follow-up for ${input.routeContext}`,
      reasons: ["support found local work"],
      scope: "instance",
      expectedClosurePath: "local_backlog",
      privacySeed: { canShareUpstream: false, requiresSecretScan: false, requiresAcknowledgement: false },
      applicabilitySeed,
    };
  }

  const canShareUpstream = !input.privacy.hasSecretRisk && input.contributionMode !== "fork_only";
  return {
    route: "upstream",
    acknowledgement: input.contributionMode === "contribute_all" && canShareUpstream ? "not_required" : "required",
    reasons: [
      input.repeatedFailureCount && input.repeatedFailureCount > 1
        ? `repeated failure count ${input.repeatedFailureCount}`
        : "support did not converge",
    ],
    scope: "project",
    expectedClosurePath: "upstream_issue_pr_release",
    privacySeed: {
      canShareUpstream,
      requiresSecretScan: true,
      requiresAcknowledgement: !canShareUpstream || input.contributionMode !== "contribute_all",
    },
    applicabilitySeed,
  };
}

function buildApplicabilitySeed(input: {
  sourceArchetypeId?: string | null;
  sourceArchetypeCategory?: string | null;
  shareArchetypeInUpstream?: boolean;
} | undefined): FeedbackRoutingBase["applicabilitySeed"] {
  const sourceArchetypeId = input?.sourceArchetypeId ?? null;
  const sourceArchetypeCategory = input?.sourceArchetypeCategory ?? null;
  const shareArchetypeInUpstream = input?.shareArchetypeInUpstream === true;

  return {
    sourceArchetypeId,
    sourceArchetypeCategory,
    targetArchetypeIds: sourceArchetypeId && shareArchetypeInUpstream ? [sourceArchetypeId] : [],
    categoryFallbackOnly: sourceArchetypeId == null && sourceArchetypeCategory != null,
    shareArchetypeInUpstream,
  };
}
```

- [ ] **Step 4: Run tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/feedback-routing/assess-feedback-routing.test.ts
```

Expected: routing tests pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add apps/web/lib/feedback-routing
git commit -s -m "feat(feedback): add pure routing decision"
```

---

## Task 5: Link Support Reports To Resolutions

**Files:**
- Modify: `apps/web/lib/actions/feedback-support.ts`
- Modify: `apps/web/lib/actions/feedback-support.test.ts`

- [ ] **Step 1: Write failing action expectations**

In `apps/web/lib/actions/feedback-support.test.ts`, mock `createOrGetResolutionForReport` and assert it is called for created, existing, and reconciled support reports:

```ts
expect(mockCreateOrGetResolutionForReport).toHaveBeenCalledWith({
  reportId: "PIR-SUPPORT",
  source: "support",
  scope: "instance",
});
```

Also assert repeated/existing support starts return the existing report while still invoking the idempotent ledger service:

```ts
expect(result.status).toBe("existing");
expect(mockCreateOrGetResolutionForReport).toHaveBeenCalledTimes(1);
```

The service owns deduplication, so the action can safely repair old support reports that predate the ledger.

- [ ] **Step 2: Run tests to verify red**

Run:

```powershell
pnpm --filter web exec vitest run lib/actions/feedback-support.test.ts
```

Expected: fails because the action does not call the resolution service yet.

- [ ] **Step 3: Wire the service**

In `apps/web/lib/actions/feedback-support.ts`, import:

```ts
import { createOrGetResolutionForReport } from "@/lib/feedback-resolution/resolution-service";
```

After the action has a returned `FeedbackSupportResult` for `created`, `existing`, or `reconciled`, add:

```ts
await createOrGetResolutionForReport({
  reportId: result.reportId,
  source: "support",
  scope: "instance",
});
```

Do not call it for `skipped` thread-conflict results because those reports intentionally remain attached to the original support thread.

Refactor the action returns through a small helper so every non-skipped path is covered:

```ts
async function attachResolution(result: FeedbackSupportResult): Promise<FeedbackSupportResult> {
  if (result.status === "skipped") return result;

  await createOrGetResolutionForReport({
    reportId: result.reportId,
    source: "support",
    scope: "instance",
  });

  return result;
}
```

- [ ] **Step 4: Run tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/actions/feedback-support.test.ts lib/feedback-resolution/resolution-service.test.ts
```

Expected: both pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add apps/web/lib/actions/feedback-support.ts apps/web/lib/actions/feedback-support.test.ts
git commit -s -m "feat(feedback): link support reports to resolutions"
```

---

## Task 6: Routing Decision Server Action

**Files:**
- Create: `apps/web/lib/actions/feedback-routing.ts`
- Create: `apps/web/lib/actions/feedback-routing.test.ts`

- [ ] **Step 1: Write failing server-action tests**

Create `apps/web/lib/actions/feedback-routing.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  recordRoutingDecision: vi.fn(),
  createResolutionNotificationOnce: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/feedback-resolution/resolution-service", () => ({
  recordRoutingDecision: mocks.recordRoutingDecision,
  createResolutionNotificationOnce: mocks.createResolutionNotificationOnce,
}));

import { recordFeedbackRoutingDecision } from "./feedback-routing";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
});

const applicabilitySeed = {
  sourceArchetypeId: null,
  sourceArchetypeCategory: null,
  targetArchetypeIds: [],
  categoryFallbackOnly: false,
  shareArchetypeInUpstream: false,
};

describe("recordFeedbackRoutingDecision", () => {
  it("records local answered decisions and sends one local notification", async () => {
    await recordFeedbackRoutingDecision({
      resolutionId: "PIRR-AAA11",
      reportId: "PIR-AAA11",
      decision: {
        route: "resolved_locally",
        scope: "instance",
        expectedClosurePath: "local_answer",
        reasons: ["support answered the report locally"],
        privacySeed: { canShareUpstream: false, requiresSecretScan: false, requiresAcknowledgement: false },
        applicabilitySeed,
      },
    });

    expect(mocks.recordRoutingDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        resolutionId: "PIRR-AAA11",
        reportId: "PIR-AAA11",
        route: "resolved_locally",
      }),
    );
    expect(mocks.createResolutionNotificationOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        resolutionId: "PIRR-AAA11",
        reportId: "PIR-AAA11",
        userId: "user-1",
        notificationKind: "local_answered",
        deepLink: "/feedback/reports/PIR-AAA11",
      }),
    );
  });

  it("does not create a local-answer notification for upstream-needed decisions", async () => {
    await recordFeedbackRoutingDecision({
      resolutionId: "PIRR-AAA11",
      reportId: "PIR-AAA11",
      decision: {
        route: "upstream",
        acknowledgement: "required",
        scope: "project",
        expectedClosurePath: "upstream_issue_pr_release",
        reasons: ["support did not converge"],
        privacySeed: { canShareUpstream: true, requiresSecretScan: true, requiresAcknowledgement: true },
        applicabilitySeed,
      },
    });

    expect(mocks.recordRoutingDecision).toHaveBeenCalled();
    expect(mocks.createResolutionNotificationOnce).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify red**

Run:

```powershell
pnpm --filter web exec vitest run lib/actions/feedback-routing.test.ts
```

Expected: fails because `feedback-routing.ts` does not exist.

- [ ] **Step 3: Implement action**

Create `apps/web/lib/actions/feedback-routing.ts`:

```ts
"use server";

import { auth } from "@/lib/auth";
import type { FeedbackRoutingDecision } from "@/lib/feedback-routing/assess-feedback-routing";
import {
  createResolutionNotificationOnce,
  recordRoutingDecision,
} from "@/lib/feedback-resolution/resolution-service";

export async function recordFeedbackRoutingDecision(input: {
  resolutionId: string;
  reportId: string;
  decision: FeedbackRoutingDecision;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (!userId) return { ok: false, error: "Unauthorized" };

  await recordRoutingDecision({
    resolutionId: input.resolutionId,
    reportId: input.reportId,
    route: input.decision.route,
    scope: input.decision.scope,
    expectedClosurePath: input.decision.expectedClosurePath,
    privacySeed: input.decision.privacySeed,
    applicabilitySeed: input.decision.applicabilitySeed,
    reasons: input.decision.reasons,
  });

  if (input.decision.route === "resolved_locally") {
    await createResolutionNotificationOnce({
      resolutionId: input.resolutionId,
      reportId: input.reportId,
      userId,
      notificationKind: "local_answered",
      title: "Feedback handled here",
      body: "Your Feedback report was handled here. You can return to the page and keep working.",
      deepLink: `/feedback/reports/${input.reportId}`,
    });
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/actions/feedback-routing.test.ts
```

Expected: action tests pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add apps/web/lib/actions/feedback-routing.ts apps/web/lib/actions/feedback-routing.test.ts
git commit -s -m "feat(feedback): record routing decisions"
```

---

## Task 7: Dale-Safe Report Timeline

**Files:**
- Create: `apps/web/lib/feedback/report-timeline.ts`
- Create: `apps/web/lib/feedback/report-timeline.test.ts`
- Create: `apps/web/components/feedback/FeedbackReportTimeline.tsx`
- Create: `apps/web/components/feedback/FeedbackReportTimeline.test.tsx`
- Create: `apps/web/app/(shell)/feedback/reports/[reportId]/page.tsx`

- [ ] **Step 1: Write view-model tests**

Create `apps/web/lib/feedback/report-timeline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildFeedbackReportTimeline } from "./report-timeline";

describe("buildFeedbackReportTimeline", () => {
  it("hides tracker internals from Dale-facing timeline", () => {
    const timeline = buildFeedbackReportTimeline({
      reportId: "PIR-AAA11",
      routeContext: "/build",
      resolutionStatus: "update_required",
      artifacts: [
        { kind: "github_pr", semanticId: "PR-123", url: "https://github.com/example/repo/pull/123" },
      ],
    });

    expect(timeline.title).toBe("Feedback report PIR-AAA11");
    expect(timeline.primaryCopy).toBe("An admin needs to apply the update before you will see the fix.");
    expect(timeline.primaryCta).toEqual({ label: "View admin update", href: "/admin/platform-development" });
    expect(JSON.stringify(timeline)).not.toContain("github");
    expect(JSON.stringify(timeline)).not.toContain("PR-123");
  });
});
```

- [ ] **Step 2: Implement the view model**

Create `apps/web/lib/feedback/report-timeline.ts`:

```ts
import type { FeedbackResolutionStatus } from "@/lib/feedback-resolution/constants";

type TimelineArtifact = { kind: string; semanticId?: string | null; url?: string | null };

export type FeedbackReportTimeline = {
  title: string;
  primaryCopy: string;
  primaryCta: { label: string; href: string } | null;
  steps: Array<{ label: string; state: "done" | "active" | "pending"; stateLabel: string }>;
};

export function buildFeedbackReportTimeline(input: {
  reportId: string;
  routeContext: string | null;
  resolutionStatus: FeedbackResolutionStatus;
  artifacts: TimelineArtifact[];
}): FeedbackReportTimeline {
  const copy = copyForStatus(input.resolutionStatus);
  return {
    title: `Feedback report ${input.reportId}`,
    primaryCopy: copy.primaryCopy,
    primaryCta: copy.primaryCta,
    steps: [
      { label: "Report received", state: "done", stateLabel: "Received" },
      {
        label: "Checking local or platform path",
        state: input.resolutionStatus === "routing" ? "active" : "done",
        stateLabel: input.resolutionStatus === "routing" ? "Checking" : "Checked",
      },
      { label: copy.stepLabel, state: copy.terminal ? "done" : "active", stateLabel: copy.terminal ? "Complete" : "In progress" },
    ],
  };
}

function copyForStatus(status: FeedbackResolutionStatus): {
  primaryCopy: string;
  primaryCta: { label: string; href: string } | null;
  stepLabel: string;
  terminal: boolean;
} {
  switch (status) {
    case "local_answered":
      return { primaryCopy: "This was handled here.", primaryCta: null, stepLabel: "Handled locally", terminal: true };
    case "update_required":
      return {
        primaryCopy: "An admin needs to apply the update before you will see the fix.",
        primaryCta: { label: "View admin update", href: "/admin/platform-development" },
        stepLabel: "Admin action needed",
        terminal: false,
      };
    case "applied_here":
      return { primaryCopy: "The fix is installed here.", primaryCta: null, stepLabel: "Installed here", terminal: true };
    case "verified_here":
      return { primaryCopy: "The fix was installed and checked here.", primaryCta: null, stepLabel: "Checked here", terminal: true };
    case "blocked":
      return { primaryCopy: "We found the path, but this install needs attention first.", primaryCta: null, stepLabel: "Needs attention", terminal: false };
    case "not_applicable":
      return { primaryCopy: "This fix is not for this install.", primaryCta: null, stepLabel: "Not applicable", terminal: true };
    default:
      return { primaryCopy: "We received this and are checking whether it is local or a platform fix.", primaryCta: null, stepLabel: "Checking path", terminal: false };
  }
}
```

- [ ] **Step 3: Add component and route**

Create a small token-aware component in `apps/web/components/feedback/FeedbackReportTimeline.tsx` that renders `title`, `primaryCopy`, steps, and one CTA. Use only DPF CSS variables:

```tsx
import type { FeedbackReportTimeline as Timeline } from "@/lib/feedback/report-timeline";

export function FeedbackReportTimeline({ timeline }: { timeline: Timeline }) {
  return (
    <section className="space-y-4 text-[var(--dpf-text)]">
      <div>
        <h1 className="text-lg font-semibold">{timeline.title}</h1>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">{timeline.primaryCopy}</p>
      </div>
      <ol className="space-y-2">
        {timeline.steps.map((step) => (
          <li key={step.label} className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm">
            <span className="font-medium">{step.label}</span>
            <span className="ml-2 text-xs uppercase text-[var(--dpf-muted)]">{step.stateLabel}</span>
          </li>
        ))}
      </ol>
      {timeline.primaryCta && (
        <a className="inline-flex rounded-md bg-[var(--dpf-accent)] px-3 py-2 text-sm font-medium text-white" href={timeline.primaryCta.href}>
          {timeline.primaryCta.label}
        </a>
      )}
    </section>
  );
}
```

Create `apps/web/app/(shell)/feedback/reports/[reportId]/page.tsx` as a server page that loads the authenticated user, the report, primary resolution, and artifacts, then calls `buildFeedbackReportTimeline()`. If the report is missing, render `notFound()`. If the signed-in user is neither the reporter nor an admin/platform operator, render `notFound()` so report existence is not leaked.

- [ ] **Step 4: Test and scan UI tokens**

Run:

```powershell
pnpm --filter web exec vitest run lib/feedback/report-timeline.test.ts components/feedback/FeedbackReportTimeline.test.tsx
Select-String -Path "apps/web/components/feedback/FeedbackReportTimeline.tsx" -Pattern "rgba\\(|#[0-9a-fA-F]{3,6}|text-gray|bg-gray|border-gray"
```

Expected: tests pass and color scan returns zero matches.

- [ ] **Step 5: Commit**

Run:

```powershell
git add "apps/web/app/(shell)/feedback/reports/[reportId]/page.tsx" apps/web/lib/feedback/report-timeline.ts apps/web/lib/feedback/report-timeline.test.ts apps/web/components/feedback/FeedbackReportTimeline.tsx apps/web/components/feedback/FeedbackReportTimeline.test.tsx
git commit -s -m "feat(feedback): add Dale-safe report timeline"
```

---

## Task 8: Observability Metrics Summary

**Files:**
- Create: `apps/web/lib/feedback-resolution/metrics.ts`
- Create: `apps/web/lib/feedback-resolution/metrics.test.ts`

- [ ] **Step 1: Write tests for metric summary shape**

Create `apps/web/lib/feedback-resolution/metrics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { summarizeFeedbackResolutionMetrics } from "./metrics";

describe("summarizeFeedbackResolutionMetrics", () => {
  it("computes safe ratios without pre-committing SLO thresholds", () => {
    expect(summarizeFeedbackResolutionMetrics({
      totalReports: 10,
      resolvedLocally: 4,
      routed: 8,
      fallbackReports: 2,
      upstreamCandidates: 3,
      privacyBlocked: 1,
    })).toEqual({
      localResolutionRate: 0.4,
      routingDecisionRate: 0.8,
      fallbackUsageRate: 0.2,
      privacyGateBlockRate: 1 / 3,
    });
  });
});
```

- [ ] **Step 2: Implement metrics helper**

Create `apps/web/lib/feedback-resolution/metrics.ts`:

```ts
export function summarizeFeedbackResolutionMetrics(input: {
  totalReports: number;
  resolvedLocally: number;
  routed: number;
  fallbackReports: number;
  upstreamCandidates: number;
  privacyBlocked: number;
}): {
  localResolutionRate: number;
  routingDecisionRate: number;
  fallbackUsageRate: number;
  privacyGateBlockRate: number;
} {
  return {
    localResolutionRate: ratio(input.resolvedLocally, input.totalReports),
    routingDecisionRate: ratio(input.routed, input.totalReports),
    fallbackUsageRate: ratio(input.fallbackReports, input.totalReports),
    privacyGateBlockRate: ratio(input.privacyBlocked, input.upstreamCandidates),
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}
```

- [ ] **Step 3: Run metrics tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/feedback-resolution/metrics.test.ts
```

Expected: pass.

- [ ] **Step 4: Commit**

Run:

```powershell
git add apps/web/lib/feedback-resolution/metrics.ts apps/web/lib/feedback-resolution/metrics.test.ts
git commit -s -m "feat(feedback): add resolution metric summary"
```

---

## Task 9: Verification And Evidence

**Files:**
- Create: `docs/superpowers/evidence/2026-05-26-feedback-routing-resolution-ledger-verification.md`

- [ ] **Step 1: Run focused tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/feedback-resolution/constants.test.ts lib/feedback-resolution/resolution-service.test.ts lib/feedback-routing/assess-feedback-routing.test.ts lib/actions/feedback-routing.test.ts lib/feedback/report-timeline.test.ts components/feedback/FeedbackReportTimeline.test.tsx lib/feedback-resolution/metrics.test.ts lib/actions/feedback-support.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run full Vitest from `apps/web`**

Run:

```powershell
cd apps/web
pnpm test
```

Expected: all Vitest suites pass. This is required before push for this feedback body of work; focused tests do not replace it.

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

Expected: build succeeds.

- [ ] **Step 5: Apply migration cleanly**

Run:

```powershell
pnpm --filter @dpf/db exec prisma migrate dev
```

Expected: no drift; the `feedback_resolution_ledger` migration is applied.

- [ ] **Step 6: Live UX verification**

Against the Docker-served portal, verify:

- clicking Feedback on `/build` still opens the existing coworker support mode;
- a `support_triage` `PlatformIssueReport` receives a linked `PlatformIssueResolution`;
- `/feedback/reports/[reportId]` renders a simple timeline with no GitHub labels, branch names, CUIDs, or raw status enums;
- local answered routing creates only one `feedback_local_answered` notification for the same resolution/user/kind.

- [ ] **Step 7: Write evidence**

Create `docs/superpowers/evidence/2026-05-26-feedback-routing-resolution-ledger-verification.md` with:

```markdown
# Feedback Routing Resolution Ledger Verification

## Commands

- `pnpm --filter web exec vitest run ...`: PASS
- `cd apps/web && pnpm test`: PASS
- `pnpm --filter web typecheck`: PASS
- `cd apps/web && pnpm exec next build`: PASS
- `pnpm --filter @dpf/db exec prisma migrate dev`: PASS

## Live UX

- Route tested: `/build`
- Support report ID:
- Resolution ID:
- Timeline route:
- Notification idempotency result:

## Scope Guard

This slice did not file GitHub issues, parse PR/release markers, apply platform updates, add STT, or implement webhook/polling reconciliation.
```

Replace the blank values with the observed IDs and route before committing.

- [ ] **Step 8: Commit evidence**

Run:

```powershell
git add docs/superpowers/evidence/2026-05-26-feedback-routing-resolution-ledger-verification.md
git commit -s -m "evidence: feedback routing resolution ledger verification"
```

---

## Task 10: Final Branch Hygiene

**Files:** all changed files.

- [ ] **Step 1: Diff and whitespace check**

Run:

```powershell
git status --short --branch
git diff --stat
git diff --check
```

Expected: only Phase 2/2a files and evidence changed; no whitespace errors.

- [ ] **Step 2: Update backlog item**

Use the DPF MCP backlog tools to update `BI-FBDC0861` with the final plan path and evidence path. Do not use direct SQL for this.

- [ ] **Step 3: Push**

Run:

```powershell
git push -u origin HEAD
```

- [ ] **Step 4: Open PR only after gates pass**

PR title:

```text
Phase 2/2a: feedback routing resolution ledger
```

PR body must include:

- `BI-FBDC0861`
- spec links
- plan link
- summary of routing decision, ledger models, support-report linkage, local-answer notification idempotency, and Dale-safe timeline
- verification commands and evidence doc
- explicit non-goals: no GitHub issue filing, PR/release reconciler, platform update application, webhook/polling, or STT
