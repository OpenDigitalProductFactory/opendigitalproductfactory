import { describe, expect, it, vi, beforeEach } from "vitest";

// Hoisted Prisma mock — must be declared before the import under test
const prismaMock = vi.hoisted(() => ({
  platformIssueReport: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  portfolio: { findUnique: vi.fn() },
  digitalProduct: { findUnique: vi.fn() },
}));

vi.mock("@dpf/db", () => ({ prisma: prismaMock }));

const inngestMock = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/queue/inngest-client", () => ({ inngest: inngestMock }));

import { createPlatformIssueReport } from "./platform-issue-reports";
import { ISSUE_REPORT_STATUS } from "./issue-report-status";

beforeEach(() => {
  prismaMock.platformIssueReport.create.mockReset();
  prismaMock.platformIssueReport.findFirst.mockReset();
  prismaMock.platformIssueReport.update.mockReset();
  prismaMock.portfolio.findUnique.mockReset();
  prismaMock.digitalProduct.findUnique.mockReset();
  prismaMock.platformIssueReport.create.mockResolvedValue({});
  prismaMock.platformIssueReport.update.mockResolvedValue({});
  prismaMock.digitalProduct.findUnique.mockResolvedValue({ id: "dp-portal" });
  inngestMock.send.mockReset();
  inngestMock.send.mockResolvedValue(undefined);
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

  it("persists crash-boundary diagnostics (errorDigest, deployedSha) — BI-B4F401B3", async () => {
    await createPlatformIssueReport({
      type: "runtime_error",
      title: "Test",
      source: "crash_boundary",
      errorDigest: "abc123digest",
      deployedSha: "f002cd496f1e2e696deefedb8319a1e57e12df11",
    });
    const args = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(args?.data.errorDigest).toBe("abc123digest");
    expect(args?.data.deployedSha).toBe("f002cd496f1e2e696deefedb8319a1e57e12df11");
  });

  it("defaults errorDigest / deployedSha to null when absent", async () => {
    await createPlatformIssueReport({ type: "user_report", title: "Test", source: "manual" });
    const args = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(args?.data.errorDigest).toBeNull();
    expect(args?.data.deployedSha).toBeNull();
  });

  it("truncates errorDigest (191) and deployedSha (64)", async () => {
    await createPlatformIssueReport({
      type: "runtime_error",
      title: "Test",
      source: "crash_boundary",
      errorDigest: "x".repeat(300),
      deployedSha: "y".repeat(100),
    });
    const args = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(args?.data.errorDigest.length).toBe(191);
    expect(args?.data.deployedSha.length).toBe(64);
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

  // EP-INTAKE-UNIFY Phase 4 (BI-EDFBE081): immediate projection event.
  it("emits quality/issue-report.created for an OPEN report", async () => {
    const { reportId } = await createPlatformIssueReport({
      type: "user_report",
      title: "Test",
      source: "manual",
    });
    expect(inngestMock.send).toHaveBeenCalledWith({
      name: "quality/issue-report.created",
      data: { reportId },
    });
  });

  it("does NOT emit for a support-flow report (status != open)", async () => {
    await createPlatformIssueReport({
      type: "user_report",
      title: "Test",
      source: "manual",
      supportSessionId: "sess-1",
      status: ISSUE_REPORT_STATUS.SUPPORT_TRIAGE,
    });
    expect(inngestMock.send).not.toHaveBeenCalled();
  });

  // BI-0ACD9AB2 §5.2: projection guard — a self-fix escalation is born in
  // awaiting_escalation_ack and held for the responder, never generic-projected.
  it("births a build-stall-escalation in awaiting_escalation_ack and does NOT emit", async () => {
    await createPlatformIssueReport({
      type: "build-stall-escalation",
      source: "build-studio",
      severity: "high",
      title: "Build Studio needs you",
      selfFixClass: "needs-human",
    });
    const args = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(args?.data.status).toBe("awaiting_escalation_ack");
    expect(inngestMock.send).not.toHaveBeenCalled();
  });

  it("births a selfFixClass report in awaiting_escalation_ack even without the build-stall type", async () => {
    await createPlatformIssueReport({
      type: "runtime_error",
      source: "coworker_runtime",
      title: "Coworker could not self-repair",
      selfFixClass: "needs-external-capability",
    });
    const args = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(args?.data.status).toBe("awaiting_escalation_ack");
    expect(inngestMock.send).not.toHaveBeenCalled();
  });

  it("does NOT over-trigger: a generic crash report still defaults to open and emits", async () => {
    const { reportId } = await createPlatformIssueReport({
      type: "runtime_error",
      source: "crash_boundary",
      title: "A crash",
      errorDigest: "deadbeef",
    });
    const args = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
    expect(args?.data.status).toBeUndefined(); // schema default ("open")
    expect(inngestMock.send).toHaveBeenCalledWith({
      name: "quality/issue-report.created",
      data: { reportId },
    });
  });

  // BI-PIR-76bf293c — idempotency race on the dedupeKey partial-unique.
  const p2002 = (target: unknown) =>
    Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target } });

  it("returns the surviving open report's id when a concurrent dedupeKey insert races (P2002)", async () => {
    prismaMock.platformIssueReport.create.mockRejectedValueOnce(
      p2002("PlatformIssueReport_dedupeKey_open_key"),
    );
    prismaMock.platformIssueReport.findFirst.mockResolvedValue({ id: "row-1", reportId: "PIR-EXIST" });
    const result = await createPlatformIssueReport({
      type: "runtime_error",
      title: "Recurring signature",
      source: "automated-detection",
      dedupeKey: "log-sig:portal:abc1234567",
    });
    expect(result.reportId).toBe("PIR-EXIST");
    expect(prismaMock.platformIssueReport.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          dedupeKey: "log-sig:portal:abc1234567",
          status: { notIn: ["resolved_locally", "resolved_upstream", "suppressed"] },
        }),
      }),
    );
    // The surviving report already projected when first filed — no re-projection.
    expect(inngestMock.send).not.toHaveBeenCalled();
  });

  // BI-51F6A428: the dedupeKey race is a re-occurrence — accrue onto the survivor.
  it("accrues occurrenceCount + lastSeenAt onto the surviving report on a dedupeKey race", async () => {
    const NOW = new Date("2026-07-16T12:00:00.000Z");
    prismaMock.platformIssueReport.create.mockRejectedValueOnce(
      p2002("PlatformIssueReport_dedupeKey_open_key"),
    );
    prismaMock.platformIssueReport.findFirst.mockResolvedValue({ id: "row-1", reportId: "PIR-EXIST" });
    const result = await createPlatformIssueReport(
      {
        type: "log_signature",
        title: "Recurring signature",
        source: "log-signature-scanner",
        severity: "low",
        dedupeKey: "log-sig:portal:abc1234567",
      },
      { now: () => NOW },
    );
    expect(result.reportId).toBe("PIR-EXIST");
    expect(prismaMock.platformIssueReport.update).toHaveBeenCalledWith({
      where: { id: "row-1" },
      data: { occurrenceCount: { increment: 1 }, lastSeenAt: NOW },
    });
    expect(inngestMock.send).not.toHaveBeenCalled();
  });

  it("re-throws a P2002 that is not on the dedupeKey (e.g. reportId collision)", async () => {
    prismaMock.platformIssueReport.create.mockRejectedValueOnce(p2002("PlatformIssueReport_reportId_key"));
    await expect(
      createPlatformIssueReport({
        type: "runtime_error",
        title: "x",
        source: "automated-detection",
        dedupeKey: "log-sig:portal:abc1234567",
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(prismaMock.platformIssueReport.findFirst).not.toHaveBeenCalled();
  });

  it("re-throws a dedupeKey P2002 when no surviving report can be found", async () => {
    prismaMock.platformIssueReport.create.mockRejectedValueOnce(
      p2002(["dedupeKey"]),
    );
    prismaMock.platformIssueReport.findFirst.mockResolvedValue(null);
    await expect(
      createPlatformIssueReport({
        type: "runtime_error",
        title: "x",
        source: "automated-detection",
        dedupeKey: "log-sig:portal:abc1234567",
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("is non-fatal when the projection event fails to send", async () => {
    inngestMock.send.mockRejectedValueOnce(new Error("inngest down"));
    const result = await createPlatformIssueReport({
      type: "runtime_error",
      title: "Test",
      source: "crash_boundary",
    });
    expect(result.reportId).toMatch(/^PIR-/);
  });

  // BI-51F6A428: reach-threshold + staging gate at the front door.
  describe("reach-threshold + staging gate (BI-51F6A428)", () => {
    const NOW = new Date("2026-07-16T12:00:00.000Z");

    it("births a low-severity log signature staged and does NOT emit (reach-gated)", async () => {
      const { reportId } = await createPlatformIssueReport(
        {
          type: "log_signature",
          source: "log-signature-scanner",
          severity: "low",
          title: "New error signature in portal: something",
          dedupeKey: "log-sig:portal:abc1234567",
        },
        { now: () => NOW },
      );
      const args = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
      expect(args?.data.stagedUntilPromoted).toBe(true);
      expect(args?.data.firstSeenAt).toEqual(NOW);
      expect(args?.data.lastSeenAt).toEqual(NOW);
      expect(args?.data.status).toBeUndefined(); // still OPEN (schema default)
      // Held in staging — no immediate projection.
      expect(inngestMock.send).not.toHaveBeenCalled();
      expect(reportId).toMatch(/^PIR-/);
    });

    it("projects a HIGH-severity log signature immediately (loud incident bypasses the bar)", async () => {
      const { reportId } = await createPlatformIssueReport(
        {
          type: "log_signature",
          source: "log-signature-scanner",
          severity: "high",
          title: "New error signature in portal: loud",
          dedupeKey: "log-sig:portal:def",
        },
        { now: () => NOW },
      );
      const args = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
      expect(args?.data.stagedUntilPromoted).toBe(false);
      expect(inngestMock.send).toHaveBeenCalledWith({
        name: "quality/issue-report.created",
        data: { reportId },
      });
    });

    it("does NOT stage a human/manual report — it projects on first occurrence", async () => {
      const { reportId } = await createPlatformIssueReport(
        { type: "user_report", source: "manual", severity: "low", title: "Human report" },
        { now: () => NOW },
      );
      const args = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
      expect(args?.data.stagedUntilPromoted).toBe(false);
      expect(inngestMock.send).toHaveBeenCalledWith({
        name: "quality/issue-report.created",
        data: { reportId },
      });
    });

    it("seeds firstSeenAt/lastSeenAt on every created report", async () => {
      await createPlatformIssueReport(
        { type: "user_report", source: "manual", title: "Test" },
        { now: () => NOW },
      );
      const args = prismaMock.platformIssueReport.create.mock.calls[0]?.[0];
      expect(args?.data.firstSeenAt).toEqual(NOW);
      expect(args?.data.lastSeenAt).toEqual(NOW);
    });
  });
});
