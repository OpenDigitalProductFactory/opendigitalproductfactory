import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    platformDevConfig: { findUnique: vi.fn(), update: vi.fn() },
    platformIssueReport: { findUnique: vi.fn(), updateMany: vi.fn() },
    hiveContributionLedger: { count: vi.fn(), create: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "u1", platformRole: "admin", isSuperuser: true } })),
}));

vi.mock("@/lib/permissions", () => ({ can: vi.fn(() => true) }));

vi.mock("@/lib/build/identity-privacy", async () => {
  const actual = await vi.importActual<typeof import("@/lib/build/identity-privacy")>(
    "@/lib/build/identity-privacy",
  );
  return {
    ...actual,
    getDisplayPseudonym: vi.fn(async () => "dpf-agent-a1b2c3d4"),
    resolveHiveToken: vi.fn(async () => null),
  };
});

vi.mock("@/lib/build/issue-bridge", async () => {
  const actual = await vi.importActual<typeof import("@/lib/build/issue-bridge")>(
    "@/lib/build/issue-bridge",
  );
  return {
    ...actual,
    loadSource: vi.fn(async () => ({
      title: "Crash on dashboard",
      body: "boom",
      severity: "high",
      routeContext: "/build",
      errorStack: null,
      userAgent: null,
      humanId: "PIR-AB12C",
      upstreamIssueNumber: null,
    })),
  };
});

vi.mock("@/lib/build/feedback-transport", async () => {
  const actual = await vi.importActual<typeof import("@/lib/build/feedback-transport")>(
    "@/lib/build/feedback-transport",
  );
  return { ...actual, selectTransport: vi.fn() };
});

import { prisma } from "@dpf/db";
import { selectTransport, type FeedbackTransportResult } from "@/lib/build/feedback-transport";
import { fileUpstreamFeedback, setUpstreamFeedbackOptIn } from "./feedback-escalation";

const mockConfigFind = vi.mocked(prisma.platformDevConfig.findUnique);
const mockConfigUpdate = vi.mocked(prisma.platformDevConfig.update);
const mockReportFind = vi.mocked(prisma.platformIssueReport.findUnique);
const mockReportUpdateMany = vi.mocked(prisma.platformIssueReport.updateMany);
const mockLedgerCount = vi.mocked(prisma.hiveContributionLedger.count);
const mockLedgerCreate = vi.mocked(prisma.hiveContributionLedger.create);
const mockSelectTransport = vi.mocked(selectTransport);

function config(overrides: Record<string, unknown> = {}) {
  return {
    upstreamFeedbackOptIn: true,
    hiveContributionsPaused: false,
    contributionMode: "selective",
    upstreamRelayUrl: "https://relay.dpf/intake",
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLedgerCount.mockResolvedValue(0);
  mockReportFind.mockResolvedValue({ id: "row1", upstreamIssueNumber: null, upstreamIssueUrl: null } as never);
});

describe("fileUpstreamFeedback gating", () => {
  it("blocks when not opted in", async () => {
    mockConfigFind.mockResolvedValue(config({ upstreamFeedbackOptIn: false }));
    const r = await fileUpstreamFeedback({ reportId: "PIR-AB12C" });
    expect(r).toMatchObject({ ok: false, status: "blocked" });
  });

  it("blocks when contributions paused", async () => {
    mockConfigFind.mockResolvedValue(config({ hiveContributionsPaused: true }));
    const r = await fileUpstreamFeedback({ reportId: "PIR-AB12C" });
    expect(r).toMatchObject({ ok: false, status: "blocked" });
  });

  it("blocks when contribution mode is fork_only", async () => {
    mockConfigFind.mockResolvedValue(config({ contributionMode: "fork_only" }));
    const r = await fileUpstreamFeedback({ reportId: "PIR-AB12C" });
    expect(r).toMatchObject({ ok: false, status: "blocked" });
  });
});

describe("fileUpstreamFeedback flow", () => {
  it("returns already-filed without re-posting", async () => {
    mockConfigFind.mockResolvedValue(config());
    mockReportFind.mockResolvedValue({ id: "row1", upstreamIssueNumber: 7, upstreamIssueUrl: "u" } as never);
    const r = await fileUpstreamFeedback({ reportId: "PIR-AB12C" });
    expect(r).toEqual({ ok: true, status: "already-filed", issueNumber: 7, url: "u" });
    expect(mockSelectTransport).not.toHaveBeenCalled();
  });

  it("fails when the report is not found", async () => {
    mockConfigFind.mockResolvedValue(config());
    mockReportFind.mockResolvedValue(null as never);
    const r = await fileUpstreamFeedback({ reportId: "PIR-NONE" });
    expect(r).toMatchObject({ ok: false, status: "failed" });
  });

  it("rate-limits when the per-minute cap is hit", async () => {
    mockConfigFind.mockResolvedValue(config());
    mockLedgerCount.mockResolvedValue(99);
    const r = await fileUpstreamFeedback({ reportId: "PIR-AB12C" });
    expect(r).toMatchObject({ ok: false, status: "rate-limited" });
  });

  it("files via the transport, persists the link, and writes the ledger", async () => {
    mockConfigFind.mockResolvedValue(config());
    mockSelectTransport.mockReturnValue({
      kind: "relay",
      file: vi.fn(async (): Promise<FeedbackTransportResult> => ({ status: "filed", issueNumber: 101, url: "https://github.com/o/r/issues/101" })),
    });

    const r = await fileUpstreamFeedback({ reportId: "PIR-AB12C" });

    expect(r).toEqual({ ok: true, status: "filed", issueNumber: 101, url: "https://github.com/o/r/issues/101" });
    expect(mockReportUpdateMany).toHaveBeenCalledWith({
      where: { id: "row1", upstreamIssueNumber: null },
      data: expect.objectContaining({ upstreamIssueNumber: 101, upstreamIssueUrl: "https://github.com/o/r/issues/101" }),
    });
    expect(mockLedgerCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ contributionType: "feedback", contributor: "dpf-agent-a1b2c3d4", status: "submitted" }),
    });
  });

  it("surfaces a transport failure", async () => {
    mockConfigFind.mockResolvedValue(config());
    mockSelectTransport.mockReturnValue({
      kind: "relay",
      file: vi.fn(async (): Promise<FeedbackTransportResult> => ({ status: "failed", error: "Relay error: boom" })),
    });
    const r = await fileUpstreamFeedback({ reportId: "PIR-AB12C" });
    expect(r).toMatchObject({ ok: false, status: "failed", reason: "Relay error: boom" });
    expect(mockLedgerCreate).not.toHaveBeenCalled();
  });

  it("surfaces a skipped transport (no relay, no token)", async () => {
    mockConfigFind.mockResolvedValue(config({ upstreamRelayUrl: null }));
    mockSelectTransport.mockReturnValue({
      kind: "noop",
      file: vi.fn(async (): Promise<FeedbackTransportResult> => ({ status: "skipped", reason: "no relay" })),
    });
    const r = await fileUpstreamFeedback({ reportId: "PIR-AB12C" });
    expect(r).toMatchObject({ ok: false, status: "skipped" });
  });
});

describe("setUpstreamFeedbackOptIn", () => {
  it("records consent with actor + timestamp when enabled", async () => {
    mockConfigUpdate.mockResolvedValue({} as never);
    const r = await setUpstreamFeedbackOptIn({ enabled: true });
    expect(r).toEqual({ ok: true, optIn: true });
    expect(mockConfigUpdate).toHaveBeenCalledWith({
      where: { id: "singleton" },
      data: expect.objectContaining({ upstreamFeedbackOptIn: true, upstreamFeedbackOptInById: "u1" }),
    });
  });

  it("clears consent fields when disabled", async () => {
    mockConfigUpdate.mockResolvedValue({} as never);
    await setUpstreamFeedbackOptIn({ enabled: false });
    expect(mockConfigUpdate).toHaveBeenCalledWith({
      where: { id: "singleton" },
      data: expect.objectContaining({ upstreamFeedbackOptIn: false, upstreamFeedbackOptInAt: null, upstreamFeedbackOptInById: null }),
    });
  });
});
