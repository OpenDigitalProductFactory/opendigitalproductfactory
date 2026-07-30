import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB + the canonical issue-report writer so we can assert orchestration
// without a database. The handler's side effects are the contract here.
vi.mock("@dpf/db", () => ({
  prisma: {
    featureBuild: { update: vi.fn().mockResolvedValue({}) },
    backlogItem: { update: vi.fn().mockResolvedValue({}) },
    buildActivity: { create: vi.fn().mockResolvedValue({}) },
  },
}));
vi.mock("@/lib/quality/platform-issue-reports", () => ({
  createPlatformIssueReport: vi.fn().mockResolvedValue({ reportId: "PIR-TEST1" }),
}));

import {
  buildEscalationDedupeKey,
  formatEscalationReport,
  escalateBuildToHuman,
  SELF_FIX_CLASS,
} from "./escalate-build-to-human";
import { prisma } from "@dpf/db";
import { createPlatformIssueReport } from "@/lib/quality/platform-issue-reports";

const NOW = new Date("2026-06-19T18:00:00.000Z");

const ISSUES = [
  { severity: "critical", description: "Task 3 combines two unrelated file edits" },
  { severity: "important", description: "No test-first step for the migration" },
];

function args(overrides: Partial<Parameters<typeof escalateBuildToHuman>[0]> = {}) {
  return {
    buildPk: "ckbuildpk123",
    buildId: "FB-ABC123",
    featureTitle: "Add a thing",
    biTitle: "BI: Add a thing properly",
    originatingBacklogItemId: "bi-1",
    phase: "plan",
    rounds: 2,
    issues: ISSUES,
    log: vi.fn().mockResolvedValue(undefined),
    now: NOW,
    ...overrides,
  };
}

describe("buildEscalationDedupeKey", () => {
  it("is stable + namespaced per build (one open escalation per build)", () => {
    expect(buildEscalationDedupeKey("FB-ABC123")).toBe("build-escalation:FB-ABC123");
  });
});

describe("formatEscalationReport (pure)", () => {
  const base = {
    buildId: "FB-ABC123",
    featureTitle: "Add a thing",
    biTitle: "BI: Add a thing properly",
    phase: "plan",
    rounds: 2,
    issues: ISSUES,
    selfFixClass: SELF_FIX_CLASS.NEEDS_HUMAN,
  };

  it("titles for humans, naming the subject + phase", () => {
    const { title } = formatEscalationReport(base);
    expect(title).toMatch(/needs you/i);
    expect(title).toContain("BI: Add a thing properly");
    expect(title).toContain("plan");
  });

  it("describes root cause, attempts, feasibility class, and the WIP/requeue outcome", () => {
    const { description } = formatEscalationReport(base);
    expect(description).toContain("needs-human");
    expect(description).toMatch(/2 automated plan revision round/);
    expect(description).toContain("[critical] Task 3 combines two unrelated file edits");
    expect(description).toContain("[important] No test-first step for the migration");
    expect(description).toMatch(/deferred/);
    expect(description).toContain("BI-3E0EE3BA");
  });

  it("falls back to the feature title, then buildId, when no BI title", () => {
    expect(formatEscalationReport({ ...base, biTitle: null }).title).toContain("Add a thing");
    expect(
      formatEscalationReport({ ...base, biTitle: null, featureTitle: "" }).title,
    ).toContain("FB-ABC123");
  });

  it("handles no structured issues without crashing", () => {
    const { description } = formatEscalationReport({ ...base, issues: [] });
    expect(description).toMatch(/no structured blocking issues/i);
  });

  it("caps the issue list at 15 and notes the overflow", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ severity: "minor", description: `issue ${i}` }));
    const { description } = formatEscalationReport({ ...base, issues: many });
    expect(description).toContain("issue 14");
    expect(description).not.toContain("issue 15]"); // 16th (index 15) not listed
    expect(description).toMatch(/and 5 more/);
  });

  it("exposes the three self-fix classes", () => {
    expect(SELF_FIX_CLASS.AUTO_RECOVERABLE).toBe("auto-recoverable");
    expect(SELF_FIX_CLASS.NEEDS_HUMAN).toBe("needs-human");
    expect(SELF_FIX_CLASS.NEEDS_EXTERNAL_CAPABILITY).toBe("needs-external-capability");
  });
});

describe("escalateBuildToHuman (orchestration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (createPlatformIssueReport as ReturnType<typeof vi.fn>).mockResolvedValue({ reportId: "PIR-TEST1" });
    (prisma.featureBuild.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.backlogItem.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.buildActivity.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  it("captures a durable, build-linked, deduped escalation report", async () => {
    await escalateBuildToHuman(args());
    expect(createPlatformIssueReport).toHaveBeenCalledTimes(1);
    const input = (createPlatformIssueReport as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(input.type).toBe("build-stall-escalation");
    expect(input.source).toBe("build-studio");
    expect(input.featureBuildId).toBe("ckbuildpk123"); // the cuid PK, not FB-*
    expect(input.dedupeKey).toBe("build-escalation:FB-ABC123");
    expect(input.selfFixClass).toBe("needs-human");
    expect(input.triggerKind).toBe("plan-review-exhausted");
  });

  it("frees the WIP slot by abandoning the build (by FB-* buildId)", async () => {
    const res = await escalateBuildToHuman(args());
    const call = (prisma.featureBuild.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.where).toEqual({ buildId: "FB-ABC123" });
    expect(call.data.phase).toBe("abandoned");
    expect(call.data.abandonedAt).toBe(NOW);
    expect(call.data.abandonReason).toContain("PIR-TEST1");
    expect(res.wipFreed).toBe(true);
  });

  it("parks the originating backlog item as deferred and detaches the build", async () => {
    const res = await escalateBuildToHuman(args());
    const call = (prisma.backlogItem.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.where).toEqual({ id: "bi-1" });
    expect(call.data.status).toBe("deferred");
    expect(call.data.activeBuildId).toBeNull();
    expect(res.backlogItemDeferred).toBe(true);
  });

  it("writes a discriminated audit activity (by FB-* buildId)", async () => {
    await escalateBuildToHuman(args());
    const call = (prisma.buildActivity.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data.buildId).toBe("FB-ABC123");
    expect(call.data.tool).toBe("build:escalate-human");
  });

  it("skips backlog parking when there is no originating item", async () => {
    const res = await escalateBuildToHuman(args({ originatingBacklogItemId: null }));
    expect(prisma.backlogItem.update).not.toHaveBeenCalled();
    expect(res.backlogItemDeferred).toBe(false);
  });

  it("still frees WIP even if the escalation report fails to file (priority = clear the jam)", async () => {
    (createPlatformIssueReport as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("dupe"));
    const res = await escalateBuildToHuman(args());
    expect(res.reportId).toBeNull();
    expect(prisma.featureBuild.update).toHaveBeenCalledTimes(1); // WIP freed anyway
    expect(res.wipFreed).toBe(true);
  });
});
