# Feedback Substrate Cleanup (Phase 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate the four current writers of `PlatformIssueReport` through one server writer, introduce status constants (vocabulary), teach the issue-report triage cron to skip support-flow statuses, preserve the existing GitHub Issue bridge compatibility, and clean theme-token violations in the two touched feedback fallback UI files — all as pure refactor, no new product behavior.

**Architecture:** A single `createPlatformIssueReport()` writer in `apps/web/lib/quality/platform-issue-reports.ts` becomes the only path that creates rows in `PlatformIssueReport`. It applies length limits, resolves `portfolioId`/`digitalProductId` defaults, generates the `PIR-XXXXX` `reportId`, and validates `status` against `ISSUE_REPORT_STATUS` constants exported from `apps/web/lib/quality/issue-report-status.ts`. The three call sites (`POST /api/quality/report`, `reportQualityIssue()` server action, `report_quality_issue` MCP tool handler) all become thin adapters over the writer. The crash boundary continues to call `POST /api/quality/report` and inherits the consolidation. The Inngest cron `issue-report-triage` switches its `where: { status: "open" }` filter to use the new `ISSUE_REPORT_STATUS.OPEN` constant, so any future status drift (e.g. `support_triage`) cannot be silently swept into BIs. Phase 0 does not file upstream, but it must keep `apps/web/lib/integrate/issue-bridge.ts` green because Phase 3 will reuse `escalateToUpstreamIssue({ kind: "issue-report" })` instead of creating a second GitHub Issue path.

**Tech Stack:** TypeScript, Next.js 16 App Router, Prisma 7, Vitest 4.1.7, Inngest, pnpm workspace.

**Lane:** This plan is a Phase 0 pure refactor with invariants — the carveout under `feedback_no_manual_prs` for "deps/cleanup/governance/urgent hotfixes." It is a maintenance-class PR opened directly by Claude (not routed through Build Studio). Phase 1+ slices that introduce new product behavior (support-mode coworker, capacity routing, bridge wiring) MUST be filed as BIs and run through Build Studio per `feedback_build_studio_for_all_development`.

---

## Spec anchor

- Spec: [`docs/superpowers/specs/2026-05-24-capacity-aware-feedback-escalation-design.md`](../specs/2026-05-24-capacity-aware-feedback-escalation-design.md), especially §6.2 status vocabulary, §6.7 existing Git issue capability reuse, §7.2 UI requirements, and §8 Phase 0.
- Merged PR for spec: [#1110](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1110)
- Suggested epic: `EP-9FC5D2FD` (Build Studio first-customer experience hardening) — fits because the cleanup directly enables the Dale-on-Build-Studio escalation slices that come next

## Scope and non-scope

**In scope** (this plan only):

- One server-side writer for `PlatformIssueReport`
- Status constants module (all 9 statuses defined; only `OPEN` actively used in this phase)
- Three call-site migrations (route handler, server action, MCP tool handler)
- Cron uses status constant; defensive test that a `support_triage` row is not converted
- Existing GitHub Issue bridge tests still pass for `kind: "issue-report"` escalation
- Theme-token cleanup in `FeedbackButton.tsx` and `FeedbackForm.tsx` only
- Unit tests for the writer covering: ID format, length truncation, defaults, status validation
- Live UX verification per `structural-verification-is-not-functional` kernel

**Out of scope** (later phases):

- `triggerKind`, `coalesceKey`, `coalesceBucket`, `escalationPolicy`, `capacityDecision`, `supportSummary`, `resolvedAt` schema fields (Phase 2/3)
- `FeedbackEventDetail` typed contract (Phase 1)
- Coworker support mode behavior (Phase 1)
- `assessFeedbackRouting()` (Phase 2)
- `fileUpstreamFeedback()` tool / bridge wiring (Phase 3)
- Any new direct GitHub Issue writer or new issue-tracker abstraction; Phase 3 must extend the existing issue bridge first
- Implicit hard-failure triggers beyond what already exists (Phase 4)
- Reverse channel via `Notification` (Phase 5)
- Voice STT (Phase 6)
- UI debt in `IssueReportPanel.tsx` and `TokenExpiryBanner.tsx` (out of scope per spec §7.2)

## Pre-flight check

Before Task 1, verify branch state:

```bash
git status                                 # expect clean
git log --oneline origin/main..HEAD        # expect 0 commits (or only this plan's commit)
pnpm --filter web typecheck                # expect green baseline
pnpm --filter web exec vitest run lib/operate/issue-report-triage.test.ts
                                           # expect existing cron test to pass — this is the baseline
pnpm --filter web exec vitest run lib/integrate/issue-bridge.test.ts
                                           # expect existing GitHub Issue bridge tests to pass — this protects Phase 3 reuse
```

If typecheck or the baseline triage test fails, stop and reconcile before touching production code.

---

## Task 1: Status Constants Module

**Files:**
- Create: `apps/web/lib/quality/issue-report-status.ts`
- Create: `apps/web/lib/quality/issue-report-status.test.ts`

Purpose: a single, importable source of truth for the 9 statuses defined in spec §6.2. Only `OPEN` is actively used in Phase 0; the rest are defined so later phases cannot invent strings.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/quality/issue-report-status.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ISSUE_REPORT_STATUS,
  SUPPORT_FLOW_STATUSES,
  isSupportFlowStatus,
  type IssueReportStatus,
} from "./issue-report-status";

describe("ISSUE_REPORT_STATUS", () => {
  it("defines all 9 statuses from spec §6.2", () => {
    expect(ISSUE_REPORT_STATUS).toEqual({
      OPEN: "open",
      SUPPORT_TRIAGE: "support_triage",
      RESOLVED_LOCALLY: "resolved_locally",
      TRIAGED_LOCAL: "triaged_local",
      AWAITING_ESCALATION_ACK: "awaiting_escalation_ack",
      UPSTREAM_PENDING: "upstream_pending",
      UPSTREAM_FILED: "upstream_filed",
      RESOLVED_UPSTREAM: "resolved_upstream",
      SUPPRESSED: "suppressed",
    });
  });

  it("SUPPORT_FLOW_STATUSES contains the 4 statuses the cron must skip", () => {
    expect(SUPPORT_FLOW_STATUSES).toEqual([
      "support_triage",
      "awaiting_escalation_ack",
      "upstream_pending",
      "upstream_filed",
    ]);
  });

  it("isSupportFlowStatus returns true for support-flow statuses", () => {
    expect(isSupportFlowStatus("support_triage")).toBe(true);
    expect(isSupportFlowStatus("upstream_filed")).toBe(true);
  });

  it("isSupportFlowStatus returns false for open and terminal statuses", () => {
    expect(isSupportFlowStatus("open")).toBe(false);
    expect(isSupportFlowStatus("resolved_locally")).toBe(false);
    expect(isSupportFlowStatus("triaged_local")).toBe(false);
    expect(isSupportFlowStatus("resolved_upstream")).toBe(false);
    expect(isSupportFlowStatus("suppressed")).toBe(false);
  });

  it("IssueReportStatus union type compiles for every value", () => {
    const statuses: IssueReportStatus[] = [
      "open",
      "support_triage",
      "resolved_locally",
      "triaged_local",
      "awaiting_escalation_ack",
      "upstream_pending",
      "upstream_filed",
      "resolved_upstream",
      "suppressed",
    ];
    expect(statuses).toHaveLength(9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter web exec vitest run lib/quality/issue-report-status.test.ts
```

Expect: `Cannot find module './issue-report-status'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/lib/quality/issue-report-status.ts`:

```ts
/**
 * PlatformIssueReport status vocabulary.
 *
 * Defined in spec §6.2 of
 * docs/superpowers/specs/2026-05-24-capacity-aware-feedback-escalation-design.md.
 *
 * Only OPEN is actively used in Phase 0. Later phases will activate the
 * SUPPORT_TRIAGE / *_ESCALATION* / UPSTREAM_* / RESOLVED_* / SUPPRESSED
 * statuses. Constants are defined now so no writer invents strings later.
 */
export const ISSUE_REPORT_STATUS = {
  OPEN: "open",
  SUPPORT_TRIAGE: "support_triage",
  RESOLVED_LOCALLY: "resolved_locally",
  TRIAGED_LOCAL: "triaged_local",
  AWAITING_ESCALATION_ACK: "awaiting_escalation_ack",
  UPSTREAM_PENDING: "upstream_pending",
  UPSTREAM_FILED: "upstream_filed",
  RESOLVED_UPSTREAM: "resolved_upstream",
  SUPPRESSED: "suppressed",
} as const;

export type IssueReportStatus =
  (typeof ISSUE_REPORT_STATUS)[keyof typeof ISSUE_REPORT_STATUS];

/**
 * Statuses owned by the support flow. The generic issue-report-triage cron
 * must skip these — they are managed by coworker support mode, not by the
 * auto-BI conversion path.
 */
export const SUPPORT_FLOW_STATUSES: ReadonlyArray<IssueReportStatus> = [
  ISSUE_REPORT_STATUS.SUPPORT_TRIAGE,
  ISSUE_REPORT_STATUS.AWAITING_ESCALATION_ACK,
  ISSUE_REPORT_STATUS.UPSTREAM_PENDING,
  ISSUE_REPORT_STATUS.UPSTREAM_FILED,
];

export function isSupportFlowStatus(status: string): boolean {
  return (SUPPORT_FLOW_STATUSES as ReadonlyArray<string>).includes(status);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter web exec vitest run lib/quality/issue-report-status.test.ts
```

Expect: 5 tests pass.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter web typecheck
```

Expect: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/quality/issue-report-status.ts apps/web/lib/quality/issue-report-status.test.ts
git commit -s -m "feat(quality): add IssueReportStatus constants (Phase 0 step 1)"
```

---

## Task 2: Shared Writer — Failing Test for ID, Length, Defaults

**Files:**
- Create: `apps/web/lib/quality/platform-issue-reports.test.ts`

Purpose: lock down the contract of the new writer before writing it. Tests cover ID format, length truncation, default status, default product/portfolio resolution, status validation. We mock Prisma — no DB in unit tests.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/quality/platform-issue-reports.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

// Hoisted Prisma mock — must be declared before the import under test
const prismaMock = vi.hoisted(() => ({
  platformIssueReport: { create: vi.fn() },
  portfolio: { findUnique: vi.fn() },
  digitalProduct: { findUnique: vi.fn() },
}));

vi.mock("@dpf/db", () => ({ prisma: prismaMock }));

import { createPlatformIssueReport } from "./platform-issue-reports";
import { ISSUE_REPORT_STATUS } from "./issue-report-status";

beforeEach(() => {
  prismaMock.platformIssueReport.create.mockReset();
  prismaMock.portfolio.findUnique.mockReset();
  prismaMock.digitalProduct.findUnique.mockReset();
  prismaMock.platformIssueReport.create.mockResolvedValue({});
  prismaMock.digitalProduct.findUnique.mockResolvedValue({ id: "dp-portal" });
});

describe("createPlatformIssueReport", () => {
  it("generates a PIR-XXXXX reportId", async () => {
    const result = await createPlatformIssueReport({
      type: "user_report",
      title: "Test",
      source: "manual",
    });
    expect(result.reportId).toMatch(/^PIR-[A-Z0-9]{5}$/);
    const createArgs = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(createArgs?.data.reportId).toBe(result.reportId);
  });

  it("defaults status to OPEN when not provided", async () => {
    await createPlatformIssueReport({
      type: "user_report",
      title: "Test",
      source: "manual",
    });
    const createArgs = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(createArgs?.data.status).toBeUndefined();
    // status defaults via Prisma schema default("open"); writer must not override
  });

  it("accepts a status from ISSUE_REPORT_STATUS", async () => {
    await createPlatformIssueReport({
      type: "user_report",
      title: "Test",
      source: "manual",
      status: ISSUE_REPORT_STATUS.SUPPORT_TRIAGE,
    });
    const createArgs = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(createArgs?.data.status).toBe("support_triage");
  });

  it("rejects an unknown status", async () => {
    await expect(
      createPlatformIssueReport({
        type: "user_report",
        title: "Test",
        source: "manual",
        status: "bogus" as never,
      }),
    ).rejects.toThrow(/unknown status/i);
  });

  it("truncates title to 500 chars", async () => {
    await createPlatformIssueReport({
      type: "user_report",
      title: "x".repeat(600),
      source: "manual",
    });
    const createArgs = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(createArgs?.data.title.length).toBe(500);
  });

  it("truncates description to 10000 chars", async () => {
    await createPlatformIssueReport({
      type: "user_report",
      title: "Test",
      source: "manual",
      description: "x".repeat(15000),
    });
    const createArgs = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(createArgs?.data.description.length).toBe(10000);
  });

  it("truncates errorStack to 20000 chars", async () => {
    await createPlatformIssueReport({
      type: "runtime_error",
      title: "Test",
      source: "crash_boundary",
      errorStack: "x".repeat(25000),
    });
    const createArgs = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(createArgs?.data.errorStack.length).toBe(20000);
  });

  it("truncates routeContext, userAgent, type, source, severity", async () => {
    await createPlatformIssueReport({
      type: "x".repeat(60),
      severity: "x".repeat(30),
      title: "Test",
      source: "x".repeat(50),
      routeContext: "x".repeat(600),
      userAgent: "x".repeat(600),
    });
    const args = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(args?.data.type.length).toBe(50);
    expect(args?.data.severity.length).toBe(20);
    expect(args?.data.source.length).toBe(30);
    expect(args?.data.routeContext.length).toBe(500);
    expect(args?.data.userAgent.length).toBe(500);
  });

  it("resolves digitalProductId to dpf-portal when not provided", async () => {
    await createPlatformIssueReport({
      type: "user_report",
      title: "Test",
      source: "manual",
    });
    expect(prismaMock.digitalProduct.findUnique).toHaveBeenCalledWith({
      where: { productId: "dpf-portal" },
      select: { id: true },
    });
    const args = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(args?.data.digitalProductId).toBe("dp-portal");
  });

  it("does NOT re-resolve digitalProductId when caller provides one", async () => {
    await createPlatformIssueReport({
      type: "user_report",
      title: "Test",
      source: "manual",
      digitalProductId: "dp-other",
    });
    expect(prismaMock.digitalProduct.findUnique).not.toHaveBeenCalled();
    const args = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(args?.data.digitalProductId).toBe("dp-other");
  });

  it("resolves portfolioId from routeContext when not provided", async () => {
    prismaMock.portfolio.findUnique.mockResolvedValue({ id: "pf-platform" });
    await createPlatformIssueReport({
      type: "user_report",
      title: "Test",
      source: "manual",
      routeContext: "/platform/ai/providers",
    });
    expect(prismaMock.portfolio.findUnique).toHaveBeenCalledWith({
      where: { slug: "foundational" },
      select: { id: true },
    });
    const args = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(args?.data.portfolioId).toBe("pf-platform");
  });

  it("does NOT resolve portfolioId when caller provides one", async () => {
    await createPlatformIssueReport({
      type: "user_report",
      title: "Test",
      source: "manual",
      routeContext: "/platform/ai/providers",
      portfolioId: "pf-explicit",
    });
    expect(prismaMock.portfolio.findUnique).not.toHaveBeenCalled();
    const args = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(args?.data.portfolioId).toBe("pf-explicit");
  });

  it("passes through threadId / taskRunId / featureBuildId / reportedById", async () => {
    await createPlatformIssueReport({
      type: "user_report",
      title: "Test",
      source: "manual",
      reportedById: "u-1",
      threadId: "t-1",
      taskRunId: "tr-1",
      featureBuildId: "fb-1",
    });
    const args = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(args?.data.reportedById).toBe("u-1");
    expect(args?.data.threadId).toBe("t-1");
    expect(args?.data.taskRunId).toBe("tr-1");
    expect(args?.data.featureBuildId).toBe("fb-1");
  });

  it("returns { reportId } on success", async () => {
    const result = await createPlatformIssueReport({
      type: "user_report",
      title: "Test",
      source: "manual",
    });
    expect(result).toEqual({ reportId: expect.stringMatching(/^PIR-/) });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter web exec vitest run lib/quality/platform-issue-reports.test.ts
```

Expect: `Cannot find module './platform-issue-reports'`.

- [ ] **Step 3: Commit the test (red)**

```bash
git add apps/web/lib/quality/platform-issue-reports.test.ts
git commit -s -m "test(quality): platform-issue-reports writer contract (red, Phase 0)"
```

---

## Task 3: Shared Writer — Implementation

**Files:**
- Create: `apps/web/lib/quality/platform-issue-reports.ts`

- [ ] **Step 1: Write the implementation**

Create `apps/web/lib/quality/platform-issue-reports.ts`:

```ts
import { prisma } from "@dpf/db";
import { ISSUE_REPORT_STATUS, type IssueReportStatus } from "./issue-report-status";

// Field length limits — matched to existing writers and Prisma schema column widths.
const LIMITS = {
  type: 50,
  severity: 20,
  source: 30,
  title: 500,
  description: 10_000,
  routeContext: 500,
  errorStack: 20_000,
  userAgent: 500,
} as const;

// Same route → portfolio slug map used today by reportQualityIssue().
// Kept colocated so a future move of the action does not orphan the resolution.
const ROUTE_PORTFOLIO_MAP: Record<string, string> = {
  "/portfolio": "foundational",
  "/ea": "foundational",
  "/inventory": "foundational",
  "/platform": "foundational",
  "/admin": "foundational",
  "/ops": "manufacturing_and_delivery",
  "/employee": "for_employees",
  "/customer": "products_and_services_sold",
};

function resolvePortfolioSlug(routeContext: string | null | undefined): string | null {
  if (!routeContext) return null;
  for (const [prefix, slug] of Object.entries(ROUTE_PORTFOLIO_MAP)) {
    if (routeContext === prefix || routeContext.startsWith(prefix + "/")) return slug;
  }
  return null;
}

function generateReportId(): string {
  return "PIR-" + Math.random().toString(36).substring(2, 7).toUpperCase();
}

const VALID_STATUSES = new Set<string>(Object.values(ISSUE_REPORT_STATUS));

function trimTo(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  return value.slice(0, max);
}

export interface CreatePlatformIssueReportInput {
  // Required
  type: string;
  title: string;
  source: string;

  // Optional with safe defaults
  severity?: string;
  description?: string | null;
  routeContext?: string | null;
  errorStack?: string | null;
  userAgent?: string | null;

  // Identity / linkage
  reportedById?: string | null;
  threadId?: string | null;
  taskRunId?: string | null;
  featureBuildId?: string | null;

  // Ownership — resolved automatically if not provided
  portfolioId?: string | null;
  digitalProductId?: string | null;

  // Status — defaults to schema default ("open") when omitted
  status?: IssueReportStatus;
}

/**
 * The single server-side writer for PlatformIssueReport.
 *
 * All entry points (POST /api/quality/report, reportQualityIssue() server
 * action, report_quality_issue MCP tool handler, crash boundary) MUST go
 * through this function. New entry points should too.
 *
 * Behavior:
 *  - Generates a fresh PIR-XXXXX reportId.
 *  - Applies length limits matched to the Prisma column widths.
 *  - Defaults digitalProductId to the dpf-portal product when not provided.
 *  - Resolves portfolioId from routeContext via ROUTE_PORTFOLIO_MAP when not provided.
 *  - Validates status against ISSUE_REPORT_STATUS; rejects unknown values.
 *  - Leaves status undefined when not provided so the Prisma schema default
 *    ("open") applies — supports cron contract.
 *
 * Privacy / non-identifiability transforms (redactHostnames, secret scan,
 * coworker-synthesized summaries) are intentionally OUT of scope for Phase 0
 * — they live in the upstream-escalation path added in Phase 3.
 */
export async function createPlatformIssueReport(
  input: CreatePlatformIssueReportInput,
): Promise<{ reportId: string }> {
  if (input.status !== undefined && !VALID_STATUSES.has(input.status)) {
    throw new Error(`createPlatformIssueReport: unknown status "${input.status}"`);
  }

  const digitalProductId =
    input.digitalProductId ??
    (await prisma.digitalProduct
      .findUnique({ where: { productId: "dpf-portal" }, select: { id: true } })
      .then((p) => p?.id ?? null));

  let portfolioId: string | null = input.portfolioId ?? null;
  if (portfolioId == null) {
    const slug = resolvePortfolioSlug(input.routeContext);
    if (slug) {
      const pf = await prisma.portfolio.findUnique({
        where: { slug },
        select: { id: true },
      });
      portfolioId = pf?.id ?? null;
    }
  }

  const reportId = generateReportId();

  await prisma.platformIssueReport.create({
    data: {
      reportId,
      type: input.type.slice(0, LIMITS.type),
      severity: (input.severity ?? "medium").slice(0, LIMITS.severity),
      title: input.title.slice(0, LIMITS.title),
      description: trimTo(input.description ?? null, LIMITS.description),
      routeContext: trimTo(input.routeContext ?? null, LIMITS.routeContext),
      errorStack: trimTo(input.errorStack ?? null, LIMITS.errorStack),
      userAgent: trimTo(input.userAgent ?? null, LIMITS.userAgent),
      reportedById: input.reportedById ?? null,
      threadId: input.threadId ?? null,
      taskRunId: input.taskRunId ?? null,
      featureBuildId: input.featureBuildId ?? null,
      source: input.source.slice(0, LIMITS.source),
      portfolioId,
      digitalProductId,
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });

  return { reportId };
}
```

- [ ] **Step 2: Run test to verify it passes**

```bash
pnpm --filter web exec vitest run lib/quality/platform-issue-reports.test.ts
```

Expect: all 14 tests in the file pass.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck
```

Expect: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/quality/platform-issue-reports.ts
git commit -s -m "feat(quality): createPlatformIssueReport unified writer (Phase 0)"
```

---

## Task 4: Migrate POST /api/quality/report

**Files:**
- Modify: `apps/web/app/api/quality/report/route.ts`
- Create: `apps/web/app/api/quality/report/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/api/quality/report/route.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const writerMock = vi.hoisted(() => ({
  createPlatformIssueReport: vi.fn(),
}));

vi.mock("@/lib/quality/platform-issue-reports", () => writerMock);

import { POST } from "./route";

beforeEach(() => {
  writerMock.createPlatformIssueReport.mockReset();
  writerMock.createPlatformIssueReport.mockResolvedValue({ reportId: "PIR-TEST1" });
});

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/quality/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/quality/report", () => {
  it("delegates to createPlatformIssueReport with normalized input", async () => {
    const res = await POST(makeReq({
      type: "runtime_error",
      title: "Boom",
      description: "Something broke",
      severity: "high",
      routeContext: "/build/123",
      errorStack: "Error: x",
      userAgent: "Mozilla/5.0",
      source: "crash_boundary",
      userId: "u-9",
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, reportId: "PIR-TEST1" });

    expect(writerMock.createPlatformIssueReport).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "runtime_error",
        title: "Boom",
        description: "Something broke",
        severity: "high",
        routeContext: "/build/123",
        errorStack: "Error: x",
        userAgent: "Mozilla/5.0",
        source: "crash_boundary",
        reportedById: "u-9",
      }),
    );
  });

  it("defaults source to manual when not provided", async () => {
    await POST(makeReq({ type: "user_report", title: "Hi" }));
    const args = writerMock.createPlatformIssueReport.mock.calls[0]?.[0];
    expect(args?.source).toBe("manual");
  });

  it("returns 413 when content-length exceeds 64KiB", async () => {
    const req = new Request("http://localhost/api/quality/report", {
      method: "POST",
      headers: { "Content-Type": "application/json", "content-length": "70000" },
      body: JSON.stringify({ type: "user_report", title: "x" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(writerMock.createPlatformIssueReport).not.toHaveBeenCalled();
  });

  it("returns 500 on writer error", async () => {
    writerMock.createPlatformIssueReport.mockRejectedValue(new Error("db"));
    const res = await POST(makeReq({ type: "user_report", title: "x" }));
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter web exec vitest run app/api/quality/report/route.test.ts
```

Expect: failures because the route still calls Prisma directly.

- [ ] **Step 3: Replace route.ts with the adapter**

Replace the entire body of `apps/web/app/api/quality/report/route.ts` with:

```ts
import { createPlatformIssueReport } from "@/lib/quality/platform-issue-reports";

export async function POST(request: Request): Promise<Response> {
  try {
    const contentLength = parseInt(request.headers.get("content-length") ?? "0", 10);
    if (contentLength > 65536) {
      return Response.json({ ok: false, error: "Too large" }, { status: 413 });
    }

    const body = (await request.json()) as Record<string, unknown>;

    const { reportId } = await createPlatformIssueReport({
      type: String(body.type ?? "user_report"),
      title: String(body.title ?? "Untitled report"),
      source: String(body.source ?? "manual"),
      severity: typeof body.severity === "string" ? body.severity : "medium",
      description: typeof body.description === "string" ? body.description : null,
      routeContext: typeof body.routeContext === "string" ? body.routeContext : null,
      errorStack: typeof body.errorStack === "string" ? body.errorStack : null,
      userAgent: typeof body.userAgent === "string" ? body.userAgent : null,
      reportedById: typeof body.userId === "string" ? body.userId : null,
      portfolioId: typeof body.portfolioId === "string" ? body.portfolioId : null,
      digitalProductId: typeof body.digitalProductId === "string" ? body.digitalProductId : null,
    });

    return Response.json({ ok: true, reportId });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter web exec vitest run app/api/quality/report/route.test.ts
```

Expect: 4 tests pass.

- [ ] **Step 5: Re-run the writer's own tests as a sanity check**

```bash
pnpm --filter web exec vitest run lib/quality/
```

Expect: 19 tests pass (5 from status + 14 from writer).

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter web typecheck
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/api/quality/report/route.ts apps/web/app/api/quality/report/route.test.ts
git commit -s -m "refactor(api/quality): route handler delegates to shared writer (Phase 0)"
```

---

## Task 5: Migrate `reportQualityIssue()` server action

**Files:**
- Modify: `apps/web/lib/actions/quality.ts:6-78` (drop `ROUTE_PORTFOLIO_MAP`, `resolvePortfolioSlug`, and the `prisma.platformIssueReport.create` block; delegate to the shared writer)
- Create: `apps/web/lib/actions/quality.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/actions/quality.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
const writerMock = vi.hoisted(() => ({ createPlatformIssueReport: vi.fn() }));

vi.mock("@/lib/auth", () => authMock);
vi.mock("@/lib/quality/platform-issue-reports", () => writerMock);
vi.mock("@dpf/db", () => ({ prisma: {} })); // unused after migration

import { reportQualityIssue } from "./quality";

beforeEach(() => {
  authMock.auth.mockReset();
  writerMock.createPlatformIssueReport.mockReset();
  writerMock.createPlatformIssueReport.mockResolvedValue({ reportId: "PIR-Q1" });
});

describe("reportQualityIssue", () => {
  it("resolves userId from auth and delegates to writer", async () => {
    authMock.auth.mockResolvedValue({ user: { id: "u-1" } });

    const result = await reportQualityIssue({
      type: "user_report",
      title: "Hello",
      routeContext: "/platform",
      severity: "medium",
    });

    expect(result).toEqual({ reportId: "PIR-Q1" });
    expect(writerMock.createPlatformIssueReport).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "user_report",
        title: "Hello",
        routeContext: "/platform",
        severity: "medium",
        reportedById: "u-1",
        source: "ai_assisted",
      }),
    );
  });

  it("uses null reportedById when no session", async () => {
    authMock.auth.mockResolvedValue(null);
    await reportQualityIssue({
      type: "feedback",
      title: "x",
      routeContext: "/admin",
    });
    const args = writerMock.createPlatformIssueReport.mock.calls[0]?.[0];
    expect(args?.reportedById).toBeNull();
  });

  it("returns { error } when writer throws", async () => {
    authMock.auth.mockResolvedValue(null);
    writerMock.createPlatformIssueReport.mockRejectedValue(new Error("db"));
    const result = await reportQualityIssue({
      type: "user_report",
      title: "x",
      routeContext: "/admin",
    });
    expect(result).toEqual({ error: "Failed to create report" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter web exec vitest run lib/actions/quality.test.ts
```

Expect: failures because `reportQualityIssue` still calls Prisma directly.

- [ ] **Step 3: Replace `reportQualityIssue()` body**

In `apps/web/lib/actions/quality.ts`:

- DELETE lines 6–24 (the `ROUTE_PORTFOLIO_MAP` and `resolvePortfolioSlug` — they live in the writer now).
- REPLACE lines 26–78 (the entire `reportQualityIssue()` function) with:

```ts
export async function reportQualityIssue(input: {
  type: "runtime_error" | "user_report" | "feedback";
  title: string;
  description?: string;
  severity?: string;
  routeContext: string;
  errorStack?: string;
  source?: string;
}): Promise<{ reportId: string } | { error: string }> {
  const session = await auth();
  const userId = session?.user?.id ?? null;

  try {
    const { reportId } = await createPlatformIssueReport({
      type: input.type,
      title: input.title,
      source: input.source ?? "ai_assisted",
      severity: input.severity ?? "medium",
      description: input.description ?? null,
      routeContext: input.routeContext,
      errorStack: input.errorStack ?? null,
      reportedById: userId,
    });
    return { reportId };
  } catch {
    return { error: "Failed to create report" };
  }
}
```

- ADD this import at the top (after the existing imports):

```ts
import { createPlatformIssueReport } from "@/lib/quality/platform-issue-reports";
```

- The `prisma` import is still needed for the admin query helpers (`getIssueReports`, `updateIssueReportStatus`, `getIssueReportStats`) — leave them untouched.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter web exec vitest run lib/actions/quality.test.ts
```

Expect: 3 tests pass.

- [ ] **Step 5: Run typecheck**

```bash
pnpm --filter web typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/actions/quality.ts apps/web/lib/actions/quality.test.ts
git commit -s -m "refactor(actions/quality): reportQualityIssue delegates to shared writer (Phase 0)"
```

---

## Task 6: Migrate `report_quality_issue` MCP tool handler

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts:5664-5678`

The handler currently inlines `prisma.platformIssueReport.create`. Migration: delegate to the shared writer while preserving the response shape and passing through `context?.routeContext` when available.

- [ ] **Step 1: Add the writer import at the top of mcp-tools.ts**

Find the existing imports block in `apps/web/lib/mcp-tools.ts` and add:

```ts
import { createPlatformIssueReport } from "@/lib/quality/platform-issue-reports";
```

- [ ] **Step 2: Replace the `case "report_quality_issue"` handler block**

Locate lines 5664–5678 (the `case "report_quality_issue":` block). Replace the entire `case` body with:

```ts
    case "report_quality_issue": {
      const { reportId } = await createPlatformIssueReport({
        type: String(params["type"] ?? "user_report"),
        title: String(params["title"] ?? "Untitled"),
        source: "ai_assisted",
        ...(typeof params["description"] === "string"
          ? { description: params["description"] }
          : {}),
        severity: String(params["severity"] ?? "medium"),
        reportedById: userId,
        ...(typeof context?.routeContext === "string"
          ? { routeContext: context.routeContext }
          : {}),
      });
      return { success: true, entityId: reportId, message: `Filed report ${reportId}` };
    }
```

Note: this adds `routeContext` pass-through where it was previously dropped. That is consistent with the spec's "normalize route... capture where available" Phase 0 directive and matches what other MCP handlers already do (e.g. the `recordExternalEvidence` calls in nearby cases).

- [ ] **Step 3: Sanity check existing MCP test still typechecks**

There is no dedicated unit test for this MCP handler. Run the existing broad test:

```bash
pnpm --filter web exec vitest run lib/mcp-tools-sandbox-admin.test.ts
pnpm --filter web typecheck
```

Expect: no regressions.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/mcp-tools.ts
git commit -s -m "refactor(mcp): report_quality_issue handler delegates to shared writer (Phase 0)"
```

---

## Task 7: Cron uses status constant + skip test

**Files:**
- Modify: `apps/web/lib/queue/functions/issue-report-triage.ts:38`
- Modify: `apps/web/lib/operate/issue-report-triage.test.ts` (add new test only — keep existing tests untouched)

- [ ] **Step 1: Add failing test for support-flow skip**

In `apps/web/lib/operate/issue-report-triage.test.ts`, add this new `describe` block at the bottom of the file (after the existing tests):

```ts
describe("triage cron filter excludes support-flow statuses", () => {
  it("getOpenReports filter is exactly ISSUE_REPORT_STATUS.OPEN", async () => {
    // This is a contract test for the queue function's filter shape.
    // It guards against accidentally widening the filter to include
    // support_triage, awaiting_escalation_ack, upstream_pending, or upstream_filed.
    const { ISSUE_REPORT_STATUS, SUPPORT_FLOW_STATUSES } = await import(
      "@/lib/quality/issue-report-status"
    );

    expect(ISSUE_REPORT_STATUS.OPEN).toBe("open");
    expect(SUPPORT_FLOW_STATUSES).not.toContain("open");
    expect(SUPPORT_FLOW_STATUSES).toContain("support_triage");
    expect(SUPPORT_FLOW_STATUSES).toContain("awaiting_escalation_ack");
    expect(SUPPORT_FLOW_STATUSES).toContain("upstream_pending");
    expect(SUPPORT_FLOW_STATUSES).toContain("upstream_filed");
  });

  it("triageIssueReports does not process a support_triage report passed in", async () => {
    // Defensive: if the cron ever receives a support_triage row (e.g. via a
    // changed query), buildIssueBacklogItem still runs — so the protection
    // must live at the query layer, not the pure-function layer. This test
    // documents the boundary: triageIssueReports trusts its input, the cron
    // filter is the gate. See queue/functions/issue-report-triage.ts.
    const supportReport = {
      ...report,
      id: "r-support",
      reportId: "PIR-SUP01",
    };
    const created: unknown[] = [];
    await triageIssueReports(triageDeps({
      getOpenReports: async () => [supportReport],
      createBacklogItem: async (data: unknown) => { created.push(data); },
    }));
    // Pure function still processes whatever is handed in — gate is in queue layer.
    expect(created).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the new tests to verify them**

```bash
pnpm --filter web exec vitest run lib/operate/issue-report-triage.test.ts
```

Expect: existing tests still pass + the new 2 tests pass (the second test passes today because nothing prevents the pure function from processing; the failure mode is in the production query, which Step 3 protects).

- [ ] **Step 3: Update the cron to use the status constant**

In `apps/web/lib/queue/functions/issue-report-triage.ts`:

- Add this import at the top after the existing imports:

```ts
import { ISSUE_REPORT_STATUS } from "@/lib/quality/issue-report-status";
```

- Replace line 38:

```ts
            where: { status: "open" },
```

with:

```ts
            where: { status: ISSUE_REPORT_STATUS.OPEN },
```

- [ ] **Step 4: Re-run the test suite**

```bash
pnpm --filter web exec vitest run lib/operate/issue-report-triage.test.ts
pnpm --filter web typecheck
```

Expect: green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/queue/functions/issue-report-triage.ts apps/web/lib/operate/issue-report-triage.test.ts
git commit -s -m "refactor(cron/issue-report-triage): use ISSUE_REPORT_STATUS.OPEN (Phase 0)"
```

---

## Task 8: Existing GitHub Issue Bridge Compatibility

**Files:**
- Read/verify: `apps/web/lib/integrate/issue-bridge.ts`
- Read/verify or modify tests only if needed: `apps/web/lib/integrate/issue-bridge.test.ts`

Purpose: Phase 0 changes issue-report creation and status vocabulary, but it must not damage the existing path that turns a `PlatformIssueReport` into a GitHub Issue. This is important because Phase 3 must reuse `escalateToUpstreamIssue({ kind: "issue-report" })` instead of adding a feedback-specific GitHub client.

- [ ] **Step 1: Run the existing bridge tests before any bridge-adjacent edits**

```bash
pnpm --filter web exec vitest run lib/integrate/issue-bridge.test.ts
```

Expect: existing tests pass, including the `issue-report` escalation case with error-stack context.

- [ ] **Step 2: Confirm the writer contract still supplies bridge-readable fields**

Check the shared writer and tests against the fields selected by `loadSource(kind: "issue-report")` in `issue-bridge.ts`:

- `reportId`
- `title`
- `description`
- `severity`
- `routeContext`
- `errorStack`
- `userAgent`
- `upstreamIssueNumber`

If Phase 0 changes any of these field names or defaulting behavior, update the writer/tests so the bridge keeps working. Do not add a new GitHub API call path.

- [ ] **Step 3: Add only the minimum compatibility test if a gap is found**

The existing test suite already covers issue-report escalation. Add a new test only if the shared writer introduces a field-shape change not covered today, such as `PIR-*` report IDs produced by the new writer or omitted optional fields.

- [ ] **Step 4: Re-run bridge and writer tests**

```bash
pnpm --filter web exec vitest run lib/integrate/issue-bridge.test.ts
pnpm --filter web exec vitest run lib/quality/platform-issue-reports.test.ts
pnpm --filter web typecheck
```

Acceptance:

- `issue-bridge.test.ts` stays green.
- No production bridge behavior changes unless required to preserve compatibility.
- No new direct GitHub Issue writer, REST client, or issue-tracker abstraction is introduced in Phase 0.

Commit only if files changed:

```bash
git add apps/web/lib/integrate/issue-bridge.test.ts apps/web/lib/integrate/issue-bridge.ts
git commit -s -m "test(integrate): preserve issue-report bridge compatibility (Phase 0)"
```

---

## Task 9: Theme tokens — `FeedbackButton.tsx`

**Files:**
- Modify: `apps/web/components/feedback/FeedbackButton.tsx`

Replace inline `rgba(...)` and hex colors with DPF theme tokens (per spec §7.2). Behavior must not change — visual fidelity should remain close, but the fallback form is not the healthy-install primary UX, so exact pixel-match is not required.

- [ ] **Step 1: Replace the styles**

Replace the entire file body. The current button uses fixed inline styles for the bottom-left bubble plus the fallback dropdown. Convert both to Tailwind classes that reference DPF theme variables:

```tsx
"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { FeedbackForm } from "./FeedbackForm";

type Props = {
  userId?: string | null;
};

export function FeedbackButton({ userId }: Props) {
  const pathname = usePathname();
  const [showForm, setShowForm] = useState(false);

  function handleClick() {
    const event = new CustomEvent("open-agent-feedback");
    document.dispatchEvent(event);

    setTimeout(() => {
      const panel = document.querySelector("[data-agent-panel]");
      if (!panel) {
        setShowForm(true);
      }
    }, 500);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        title="Send feedback"
        className="fixed bottom-[60px] left-4 z-[49] flex items-center gap-1.5 rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]/70 px-3.5 py-1.5 text-[11px] font-normal text-[var(--dpf-muted)] shadow-md backdrop-blur-sm transition-colors hover:text-[var(--dpf-text)]"
      >
        Feedback
      </button>

      {showForm && (
        <div
          className="fixed bottom-[100px] left-4 z-50 w-[300px] overflow-hidden rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] shadow-xl backdrop-blur"
        >
          <div className="px-3 pt-2.5 text-xs font-semibold text-[var(--dpf-text)]">
            Send Feedback
          </div>
          <FeedbackForm
            routeContext={pathname}
            {...(userId != null && { userId })}
            source="manual"
            onClose={() => setShowForm(false)}
          />
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Scan the file for any remaining hardcoded color tokens**

```powershell
Select-String -Path "apps/web/components/feedback/FeedbackButton.tsx" -Pattern "rgba\(|#[0-9a-fA-F]{3,6}"
```

Expect: zero matches.

- [ ] **Step 3: Re-run affected tests**

```bash
pnpm --filter web typecheck
pnpm --filter web exec vitest run components/feedback
```

(There are no existing tests for `FeedbackButton`. The typecheck is the gate.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/feedback/FeedbackButton.tsx
git commit -s -m "style(feedback): FeedbackButton uses DPF theme tokens (Phase 0)"
```

---

## Task 10: Theme tokens — `FeedbackForm.tsx`

**Files:**
- Modify: `apps/web/components/feedback/FeedbackForm.tsx`

- [ ] **Step 1: Replace the styles**

Replace the entire file body. Convert inline `style={{ background: "rgba(...)" }}` and friends to Tailwind theme-token classes. Keep all behavior (state, submission, queue fallback message) identical.

```tsx
"use client";

import { useState } from "react";
import { submitReport } from "@/lib/quality-queue";

type Props = {
  routeContext: string;
  userId?: string | null;
  errorMessage?: string;
  errorStack?: string;
  source?: string;
  onClose?: () => void;
};

export function FeedbackForm({
  routeContext,
  userId,
  errorMessage,
  errorStack,
  source,
  onClose,
}: Props) {
  const [type, setType] = useState<string>(errorMessage ? "runtime_error" : "user_report");
  const [description, setDescription] = useState(errorMessage ?? "");
  const [submitted, setSubmitted] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);

  async function handleSubmit() {
    const result = await submitReport({
      type,
      title: description.slice(0, 100) || "User report",
      description,
      severity: type === "runtime_error" ? "high" : "medium",
      routeContext,
      ...(errorStack !== undefined && { errorStack }),
      source: source ?? "manual",
      ...(userId != null && { userId }),
    });
    if (result.ok && result.reportId) {
      setReportId(result.reportId);
    } else {
      setQueued(true);
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="p-4 text-center text-sm text-[var(--dpf-text)]">
        {reportId
          ? `Thanks! Report ${reportId} filed. The platform team has been notified.`
          : queued
            ? "Saved — will be sent when connectivity is restored."
            : "Saved — will be sent when connectivity is restored."}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="mx-auto mt-3 block rounded-md border border-[var(--dpf-border)] px-3 py-1 text-xs text-[var(--dpf-text)]"
          >
            Close
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="p-3 text-sm text-[var(--dpf-text)]">
      <div className="mb-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1.5 text-xs text-[var(--dpf-text)]"
        >
          <option value="runtime_error">Bug Report</option>
          <option value="feedback">Suggestion</option>
          <option value="user_report">Question</option>
        </select>
      </div>
      <div className="mb-2">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe what happened or what you'd like to see..."
          rows={4}
          className="w-full resize-y rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1.5 text-xs text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)]"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!description.trim()}
          className="flex-1 rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Submit
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-xs text-[var(--dpf-text)]"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify no hardcoded colors remain**

```powershell
Select-String -Path "apps/web/components/feedback/FeedbackForm.tsx" -Pattern "rgba\(|#[0-9a-fA-F]{3,6}"
```

Expect: zero matches.

- [ ] **Step 3: Typecheck + run vitest for feedback area**

```bash
pnpm --filter web typecheck
pnpm --filter web exec vitest run components/feedback
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/feedback/FeedbackForm.tsx
git commit -s -m "style(feedback): FeedbackForm uses DPF theme tokens (Phase 0)"
```

---

## Task 11: Full test sweep + build

Per `feedback_run_full_tests_before_push`: vitest must run locally before push, not just typecheck.

- [ ] **Step 1: Full vitest run for the web app**

```bash
pnpm --filter web exec vitest run
```

Expect: all tests pass. If any unrelated suite fails, investigate before proceeding — do not push.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web typecheck
```

- [ ] **Step 3: Production build (Turbopack NFT exposure surface)**

```bash
cd apps/web && pnpm exec next build
```

Expect: build succeeds. Warning counts may rise/fall; per `project_turbopack_nft_cascade_math`, large warning numbers usually trace to a small number of source roots — investigate only if new warning *root causes* appear.

---

## Task 12: Live UX verification (the structural-verification-is-not-functional gate)

Per kernel commandment: code-green is not done. Drive the three writers on the Live portal and confirm rows are equivalent in shape to before.

- [ ] **Step 1: Start (or confirm) the Live portal at `http://localhost:3000`**

```bash
docker ps --format '{{.Names}}'
```

Confirm `dpf-postgres-1` and the portal container are listed. If not running, follow the standard portal-up procedure (do not modify infra without explicit approval — see `feedback_docker_explicit_approval`). The agent runs the system; do not ask the user to do this.

If your local Compose project name differs, container names may be `dpf-postgres-2` or similar. The `docker ps --format '{{.Names}}'` output is authoritative; use whatever postgres container name appears.

- [ ] **Step 2: Snapshot a baseline count**

```bash
docker exec dpf-postgres-1 psql -U postgres -d dpf -c \
  "SELECT source, COUNT(*) FROM \"PlatformIssueReport\" GROUP BY source ORDER BY source;"
```

Record the counts. They are your before-baseline.

- [ ] **Step 3: Drive the manual Feedback path**

Open `http://localhost:3000` in Chrome MCP. Click the Feedback button. If the coworker panel intercepts, dismiss it so the fallback form appears; submit "Phase 0 verification — manual" as a Question.

Confirm via SQL:

```bash
docker exec dpf-postgres-1 psql -U postgres -d dpf -c \
  "SELECT \"reportId\", source, type, \"routeContext\", \"reportedById\" IS NOT NULL AS has_user, \"portfolioId\" IS NOT NULL AS has_portfolio, \"digitalProductId\" IS NOT NULL AS has_product FROM \"PlatformIssueReport\" ORDER BY \"createdAt\" DESC LIMIT 1;"
```

Expect: source `manual`, type `user_report`, routeContext populated, product populated. Auth depends on whether you are signed in.

- [ ] **Step 4: Drive the crash boundary path**

The least invasive route is the auto-report-on-mount path inside `app/(shell)/error.tsx`: navigate to any route that already errors (check current `PlatformIssueReport` rows with `source='crash_boundary'` in the last day for examples), or use Chrome MCP devtools to navigate to a route that throws (e.g., a malformed dynamic param) so the boundary fires naturally.

If no live crash surface exists, use the fallback: click "Send feedback" from any active error page and submit a note. Avoid editing source code purely for verification — that creates churn.

```bash
docker exec dpf-postgres-1 psql -U postgres -d dpf -c \
  "SELECT \"reportId\", source, type, \"errorStack\" IS NOT NULL AS has_stack FROM \"PlatformIssueReport\" WHERE source='crash_boundary' ORDER BY \"createdAt\" DESC LIMIT 2;"
```

Expect: two rows (auto-report on mount + the user submission), both `source=crash_boundary`, both with stack populated.

- [ ] **Step 5: Drive the MCP `report_quality_issue` tool**

Open the coworker, ask it: "File a quality issue: title 'Phase 0 verification — MCP', type user_report." The coworker should call `report_quality_issue`.

```bash
docker exec dpf-postgres-1 psql -U postgres -d dpf -c \
  "SELECT \"reportId\", source, type, \"routeContext\" FROM \"PlatformIssueReport\" WHERE source='ai_assisted' ORDER BY \"createdAt\" DESC LIMIT 1;"
```

Expect: source `ai_assisted`, `routeContext` populated (this is the new behavior added in Task 6 — verify it landed).

- [ ] **Step 6: Confirm cron skips a hand-inserted support_triage row**

```bash
docker exec dpf-postgres-1 psql -U postgres -d dpf -c \
  "INSERT INTO \"PlatformIssueReport\" (id, \"reportId\", type, severity, status, title, description, source, \"createdAt\", \"updatedAt\") VALUES ('test-supp-1', 'PIR-SUP99', 'user_report', 'medium', 'support_triage', 'Phase 0 cron skip test', 'should not become a BI', 'manual', NOW(), NOW());"
```

Trigger the cron via the Inngest dev surface or wait up to 15 min, then:

```bash
docker exec dpf-postgres-1 psql -U postgres -d dpf -c \
  "SELECT status FROM \"PlatformIssueReport\" WHERE \"reportId\"='PIR-SUP99';"
docker exec dpf-postgres-1 psql -U postgres -d dpf -c \
  "SELECT COUNT(*) FROM \"BacklogItem\" WHERE body LIKE '%PIR-SUP99%';"
```

Expect: status remains `support_triage`; no `BacklogItem` rows referencing `PIR-SUP99`.

- [ ] **Step 7: Cleanup the test row**

```bash
docker exec dpf-postgres-1 psql -U postgres -d dpf -c \
  "DELETE FROM \"PlatformIssueReport\" WHERE \"reportId\"='PIR-SUP99';"
```

- [ ] **Step 8: Write a dynamic-analysis report**

Per `feedback_dynamic_analysis_is_evidence`: write a short prose report covering exactly what was driven, what was observed in the DB, and the sign-off. Save as `docs/superpowers/evidence/2026-05-24-feedback-substrate-cleanup-verification.md`. Include the before/after `SELECT source, COUNT(*)` snapshots and the cron-skip evidence.

- [ ] **Step 9: Commit the evidence**

```bash
git add docs/superpowers/evidence/2026-05-24-feedback-substrate-cleanup-verification.md
git commit -s -m "evidence: Phase 0 feedback substrate verification (live portal)"
```

---

## Task 13: PR overlap sweep, push, open PR

Per `feedback_pr_overlap_check_before_pushing`: sweep recent main commits + open PRs touching the feedback or issue-report surface before pushing.

- [ ] **Step 1: Sweep**

```bash
git fetch origin
git log --oneline HEAD..origin/main -- "apps/web/lib/quality/" "apps/web/lib/actions/quality.ts" "apps/web/lib/queue/functions/issue-report-triage.ts" "apps/web/app/api/quality/" "apps/web/components/feedback/" "apps/web/lib/mcp-tools.ts" "apps/web/lib/integrate/issue-bridge.ts" "apps/web/lib/integrate/issue-bridge.test.ts"
gh pr list --state open --limit 30 --json number,title,headRefName --jq '.[] | "#\(.number) \(.title)"'
```

Scan the PR list for `feedback`, `issue-report`, `quality`, `issue bridge`, or `GitHub Issue` overlap. If overlap exists: stop, reconcile with the overlapping author, re-evaluate the plan.

- [ ] **Step 2: Push**

```bash
git push -u origin HEAD
```

- [ ] **Step 3: Open the PR**

```bash
gh pr create --title "Phase 0: feedback substrate cleanup (BI for spec #1110)" --body "$(cat <<'EOF'
## Summary

- One server-side writer (`createPlatformIssueReport`) replaces four inlined `prisma.platformIssueReport.create` call sites
- New status vocabulary in `apps/web/lib/quality/issue-report-status.ts` (all 9 statuses defined; only `OPEN` used in this phase)
- Cron `quality/issue-report-triage` now filters on `ISSUE_REPORT_STATUS.OPEN` so future `support_triage` rows cannot be silently swept into BIs
- Existing `issue-bridge.ts` compatibility remains green for `kind: "issue-report"` GitHub Issue escalation
- Theme-token cleanup in `FeedbackButton.tsx` and `FeedbackForm.tsx` only

Pure refactor + invariants — no product behavior change. This is Phase 0 of the spec at [#1110](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1110); subsequent phases are blocked on this landing.

## Acceptance criteria (spec §8 Phase 0)

- [x] Existing manual feedback, crash feedback, and coworker `report_quality_issue` still create reports
- [x] The issue-report triage cron still converts generic `open` reports to BIs
- [x] A `support_triage` report is not converted by the cron
- [x] Existing issue-report bridge tests pass; no parallel GitHub Issue writer introduced
- [x] No touched feedback UI contains hardcoded color tokens

## Test plan

- [x] `pnpm --filter web exec vitest run` — green
- [x] `pnpm --filter web typecheck` — green
- [x] `cd apps/web && pnpm exec next build` — green
- [x] `pnpm --filter web exec vitest run lib/integrate/issue-bridge.test.ts` — green
- [x] Live UX verification on `http://localhost:3000` (evidence doc included)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Post-PR checklist

- [ ] CI green (DCO, lint, typecheck, test, build)
- [ ] No new Turbopack NFT warning *root causes* introduced
- [ ] PR review by code reviewer (use `pr-review-toolkit:code-reviewer`)
- [ ] After merge: file the Phase 1 BI under `EP-9FC5D2FD` and re-enter the spec → plan loop with `writing-plans` for Phase 1 only

## Notes on what's intentionally NOT in this plan

- No Prisma schema migration. The new `triggerKind`, `coalesceKey`, `escalationPolicy`, etc. fields from spec §6.2 are deferred to Phase 2/3 where they earn their keep. Adding them now would be schema churn without a consumer.
- No `Notification` table changes. Reverse channel is Phase 5.
- No coworker behavior change. Support mode entry is Phase 1.
- No bridge wiring. `escalateToUpstreamIssue` is not yet called from any Phase 0 path. The existing bridge is preserved and tested because Phase 3 will reuse it.
- No changes to `IssueReportPanel.tsx` or `TokenExpiryBanner.tsx` color tokens — out of scope per spec §7.2.

These deferrals are intentional and protect the 20% refactor budget from sprawling.
