import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FeedbackEventDetail } from "@/lib/feedback/feedback-event";

const { mockAuth, mockCreatePlatformIssueReport, mockPrisma } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCreatePlatformIssueReport: vi.fn(),
  mockPrisma: {
    featureBuild: {
      findUnique: vi.fn(),
    },
    platformIssueReport: {
      count: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

vi.mock("@/lib/quality/platform-issue-reports", () => ({
  createPlatformIssueReport: mockCreatePlatformIssueReport,
}));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
}));

type StartFeedbackSupportInput = {
  detail: FeedbackEventDetail;
  featureBuildId?: string | null;
  threadId?: string | null;
  text?: string | null;
};

type ReconcileFeedbackSupportFallbackInput = {
  detail: FeedbackEventDetail;
  threadId: string;
};

type FeedbackSupportActions = {
  startFeedbackSupport: (input: StartFeedbackSupportInput) => Promise<unknown>;
  reconcileFeedbackSupportFallback: (
    input: ReconcileFeedbackSupportFallbackInput,
  ) => Promise<unknown>;
};

async function loadActions(): Promise<FeedbackSupportActions> {
  return import("./feedback-support") as Promise<FeedbackSupportActions>;
}

const userSession = {
  user: {
    id: "user-1",
    platformRole: "HR-300",
    isSuperuser: false,
  },
};

function supportDetail(
  overrides: Partial<FeedbackEventDetail> = {},
): FeedbackEventDetail {
  return {
    routeContext: "/build",
    triggerKind: "manual",
    supportSessionId: "dpf_support_1234567890abcdef1234567890abcdef",
    autoFilePolicy: "ask",
    ...overrides,
  };
}

describe("startFeedbackSupport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue(userSession);
    mockPrisma.featureBuild.findUnique.mockResolvedValue({ id: "feature-build-1" });
    mockPrisma.platformIssueReport.count.mockResolvedValue(0);
    mockPrisma.platformIssueReport.findUnique.mockResolvedValue(null);
    mockPrisma.platformIssueReport.findFirst.mockResolvedValue(null);
    mockPrisma.platformIssueReport.update.mockResolvedValue({ reportId: "PIR-SUPPORT" });
    mockCreatePlatformIssueReport.mockResolvedValue({ reportId: "PIR-SUPPORT" });
  });

  it("rejects unauthenticated callers", async () => {
    const { startFeedbackSupport } = await loadActions();
    mockAuth.mockResolvedValue(null);

    await expect(
      startFeedbackSupport({
        detail: supportDetail(),
        featureBuildId: "FB-9E4FA6DE",
        threadId: "thread-1",
      }),
    ).rejects.toThrow(/unauthorized/i);

    expect(mockCreatePlatformIssueReport).not.toHaveBeenCalled();
  });

  it("rejects malformed support event details", async () => {
    const { startFeedbackSupport } = await loadActions();

    await expect(
      startFeedbackSupport({
        detail: {
          ...supportDetail(),
          supportSessionId: "not-a-support-session",
        },
      }),
    ).rejects.toThrow(/invalid feedback support detail/i);

    expect(mockCreatePlatformIssueReport).not.toHaveBeenCalled();
  });

  it("resolves public FB-* build ids before writing", async () => {
    const { startFeedbackSupport } = await loadActions();

    await startFeedbackSupport({
      detail: supportDetail(),
      featureBuildId: "FB-9E4FA6DE",
      threadId: "thread-1",
    });

    expect(mockPrisma.featureBuild.findUnique).toHaveBeenCalledWith({
      where: { buildId: "FB-9E4FA6DE" },
      select: { id: true },
    });
    expect(mockCreatePlatformIssueReport).toHaveBeenCalledWith(
      expect.objectContaining({
        featureBuildId: "feature-build-1",
      }),
    );
  });

  it("tolerates missing build resolution and still creates support context", async () => {
    const { startFeedbackSupport } = await loadActions();
    mockPrisma.featureBuild.findUnique.mockResolvedValue(null);

    const result = await startFeedbackSupport({
      detail: supportDetail(),
      featureBuildId: "FB-MISSING",
      threadId: "thread-1",
    });

    expect(result).toEqual({
      ok: true,
      status: "created",
      reportId: "PIR-SUPPORT",
      supportSessionId: "dpf_support_1234567890abcdef1234567890abcdef",
    });
    expect(mockCreatePlatformIssueReport).toHaveBeenCalledWith(
      expect.objectContaining({
        featureBuildId: null,
      }),
    );
  });

  it("writes the support entry payload with user, trigger, route, thread, and supportSessionId", async () => {
    const { startFeedbackSupport } = await loadActions();

    await startFeedbackSupport({
      detail: supportDetail({
        routeContext: "/build",
        sourceId: "header-feedback",
        triggerKind: "manual",
      }),
      featureBuildId: "feature-build-direct",
      threadId: "thread-1",
    });

    expect(mockCreatePlatformIssueReport).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "user_report",
        severity: "medium",
        status: "support_triage",
        title: "Support session started",
        description: expect.stringMatching(/opened coworker support mode/i),
        routeContext: "/build",
        source: "support_mode",
        reportedById: "user-1",
        triggerKind: "manual",
        supportSessionId: "dpf_support_1234567890abcdef1234567890abcdef",
        featureBuildId: "feature-build-direct",
        threadId: "thread-1",
      }),
    );
  });

  it("dedupes repeated starts with the same supportSessionId for the user", async () => {
    const { startFeedbackSupport } = await loadActions();
    mockPrisma.platformIssueReport.findUnique.mockResolvedValue({
      reportId: "PIR-EXISTING",
      supportSessionId: "dpf_support_1234567890abcdef1234567890abcdef",
    });

    const result = await startFeedbackSupport({
      detail: supportDetail(),
      threadId: "thread-1",
    });

    expect(result).toEqual({
      ok: true,
      status: "existing",
      reportId: "PIR-EXISTING",
      supportSessionId: "dpf_support_1234567890abcdef1234567890abcdef",
    });
    expect(mockPrisma.platformIssueReport.findUnique).toHaveBeenCalledWith({
      where: {
        reportedById_supportSessionId: {
          reportedById: "user-1",
          supportSessionId: "dpf_support_1234567890abcdef1234567890abcdef",
        },
      },
      select: expect.objectContaining({
        reportId: true,
        supportSessionId: true,
      }),
    });
    expect(mockCreatePlatformIssueReport).not.toHaveBeenCalled();
  });

  it("reconciles an existing fallback row with an empty threadId instead of creating a duplicate", async () => {
    const { startFeedbackSupport } = await loadActions();
    mockPrisma.platformIssueReport.findUnique.mockResolvedValue({
      id: "issue-row-1",
      reportId: "PIR-FALLBACK",
      supportSessionId: "dpf_support_1234567890abcdef1234567890abcdef",
      threadId: null,
    });
    mockPrisma.platformIssueReport.update.mockResolvedValue({
      reportId: "PIR-FALLBACK",
      threadId: "thread-1",
    });

    const result = await startFeedbackSupport({
      detail: supportDetail(),
      threadId: "thread-1",
      text: "Fallback form details",
    });

    expect(result).toEqual({
      ok: true,
      status: "reconciled",
      reportId: "PIR-FALLBACK",
      supportSessionId: "dpf_support_1234567890abcdef1234567890abcdef",
    });
    expect(mockPrisma.platformIssueReport.update).toHaveBeenCalledWith({
      where: { id: "issue-row-1" },
      data: {
        status: "support_triage",
        threadId: "thread-1",
      },
    });
    expect(mockCreatePlatformIssueReport).not.toHaveBeenCalled();
  });

  it("logs and skips an existing support row with a conflicting threadId", async () => {
    const { startFeedbackSupport } = await loadActions();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockPrisma.platformIssueReport.findUnique.mockResolvedValue({
      id: "issue-row-1",
      reportId: "PIR-EXISTING",
      supportSessionId: "dpf_support_1234567890abcdef1234567890abcdef",
      threadId: "thread-existing",
    });

    const result = await startFeedbackSupport({
      detail: supportDetail(),
      threadId: "thread-new",
    });

    expect(result).toEqual({
      ok: true,
      status: "skipped",
      reportId: "PIR-EXISTING",
      supportSessionId: "dpf_support_1234567890abcdef1234567890abcdef",
    });
    expect(warnSpy).toHaveBeenCalledWith(
      "Feedback support session threadId conflict",
      expect.objectContaining({
        reportId: "PIR-EXISTING",
        supportSessionId: "dpf_support_1234567890abcdef1234567890abcdef",
      }),
    );
    expect(mockPrisma.platformIssueReport.update).not.toHaveBeenCalled();
    expect(mockCreatePlatformIssueReport).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("handles unique races by returning the existing user-owned support report", async () => {
    const { startFeedbackSupport } = await loadActions();
    mockPrisma.platformIssueReport.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "issue-row-1",
        reportId: "PIR-RACED",
        supportSessionId: "dpf_support_1234567890abcdef1234567890abcdef",
        threadId: "thread-1",
      });
    mockCreatePlatformIssueReport.mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));

    const result = await startFeedbackSupport({
      detail: supportDetail(),
      threadId: "thread-1",
    });

    expect(result).toEqual({
      ok: true,
      status: "existing",
      reportId: "PIR-RACED",
      supportSessionId: "dpf_support_1234567890abcdef1234567890abcdef",
    });
    expect(mockPrisma.platformIssueReport.findUnique).toHaveBeenCalledTimes(2);
  });

  it("rejects the fourth support start in one minute", async () => {
    const { startFeedbackSupport } = await loadActions();
    mockPrisma.platformIssueReport.count.mockResolvedValue(3);

    await expect(
      startFeedbackSupport({
        detail: supportDetail({
          supportSessionId: "dpf_support_fedcba0987654321fedcba0987654321",
        }),
      }),
    ).rejects.toThrow(/too many support sessions/i);

    expect(mockPrisma.platformIssueReport.count).toHaveBeenCalledWith({
      where: {
        reportedById: "user-1",
        status: "support_triage",
        createdAt: { gte: expect.any(Date) },
      },
    });
    expect(mockCreatePlatformIssueReport).not.toHaveBeenCalled();
  });

  it("rejects the eleventh support start in one hour", async () => {
    const { startFeedbackSupport } = await loadActions();
    mockPrisma.platformIssueReport.count.mockResolvedValueOnce(2).mockResolvedValueOnce(10);

    await expect(
      startFeedbackSupport({
        detail: supportDetail({
          supportSessionId: "dpf_support_fedcba0987654321fedcba0987654321",
        }),
      }),
    ).rejects.toThrow(/too many support sessions/i);

    expect(mockPrisma.platformIssueReport.count).toHaveBeenCalledWith({
      where: {
        reportedById: "user-1",
        status: "support_triage",
        createdAt: { gte: expect.any(Date) },
      },
    });
    expect(mockCreatePlatformIssueReport).not.toHaveBeenCalled();
  });
});

describe("reconcileFeedbackSupportFallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue(userSession);
    mockPrisma.platformIssueReport.findFirst.mockResolvedValue({
      id: "issue-row-1",
      reportId: "PIR-FALLBACK",
      threadId: null,
    });
    mockPrisma.platformIssueReport.update.mockResolvedValue({
      reportId: "PIR-FALLBACK",
      threadId: "thread-1",
    });
  });

  it("reconciles a fallback report with the opened support thread", async () => {
    const { reconcileFeedbackSupportFallback } = await loadActions();

    const result = await reconcileFeedbackSupportFallback({
      detail: supportDetail(),
      threadId: "thread-1",
    });

    expect(result).toEqual({
      ok: true,
      status: "reconciled",
      reportId: "PIR-FALLBACK",
      supportSessionId: "dpf_support_1234567890abcdef1234567890abcdef",
    });
    expect(mockPrisma.platformIssueReport.findFirst).toHaveBeenCalledWith({
      where: {
        reportedById: "user-1",
        supportSessionId: "dpf_support_1234567890abcdef1234567890abcdef",
      },
      select: expect.objectContaining({
        id: true,
        reportId: true,
        threadId: true,
      }),
      orderBy: { createdAt: "desc" },
    });
    expect(mockPrisma.platformIssueReport.update).toHaveBeenCalledWith({
      where: { id: "issue-row-1" },
      data: expect.objectContaining({
        status: "support_triage",
        threadId: "thread-1",
      }),
    });
  });

  it("does not overwrite an existing conflicting threadId during reconciliation", async () => {
    const { reconcileFeedbackSupportFallback } = await loadActions();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockPrisma.platformIssueReport.findFirst.mockResolvedValue({
      id: "issue-row-1",
      reportId: "PIR-FALLBACK",
      threadId: "thread-existing",
    });

    const result = await reconcileFeedbackSupportFallback({
      detail: supportDetail(),
      threadId: "thread-new",
    });

    expect(result).toEqual({
      ok: true,
      status: "skipped",
      reportId: "PIR-FALLBACK",
      supportSessionId: "dpf_support_1234567890abcdef1234567890abcdef",
    });
    expect(warnSpy).toHaveBeenCalledWith(
      "Feedback support fallback threadId conflict",
      expect.objectContaining({
        reportId: "PIR-FALLBACK",
        supportSessionId: "dpf_support_1234567890abcdef1234567890abcdef",
      }),
    );
    expect(mockPrisma.platformIssueReport.update).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
