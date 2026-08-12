import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  load: vi.fn(),
  schedule: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/performance/business-performance-provider", () => ({
  loadBusinessPerformance: mocks.load,
}));
vi.mock("@/lib/operate/scheduled-jobs/agent-task-core", () => ({
  scheduleAgentTaskFor: mocks.schedule,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

import { validateBusinessAnalysisPlan } from "@dpf/storefront-templates";
import { createBusinessAnalysisWatchAction } from "./business-analysis-watch";

function config() {
  const accepted = validateBusinessAnalysisPlan({
    schemaVersion: 1,
    question: "Did covers move enough to review?",
    intent: "change",
    metrics: [{ key: "covers" }],
    dimensions: [],
    filters: [],
    period: { start: "2026-08-11", end: "2026-08-11", timezone: "America/Chicago", grain: "day" },
    comparison: { basis: "prior-period" },
    sources: [{ owner: "restaurant-service", maximumAge: "PT2H" }],
    checks: [{ kind: "completeness" }, { kind: "comparison-baseline" }],
  });
  if (accepted.status !== "accepted") throw new Error("expected accepted plan");
  return {
    schemaVersion: 1 as const,
    plan: accepted.plan,
    fingerprint: accepted.fingerprint,
    materiality: { mode: "relative" as const, direction: "either" as const, value: 0.1 },
    baseline: { value: 90, sourceWatermark: "2026-08-12T09:00:00.000Z" },
    lastEvaluation: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "user-owner" } });
  mocks.schedule.mockResolvedValue({ success: true, taskId: "agent-task-1" });
  mocks.load.mockResolvedValue({
    status: "ready",
    organizationId: "org-current",
    metricValues: [{
      key: "covers",
      label: "Covers",
      value: 115,
      availability: "available",
      sourceWatermark: new Date("2026-08-12T11:30:00.000Z"),
    }],
  });
});

describe("createBusinessAnalysisWatchAction", () => {
  it("binds the authenticated current organization and refreshes the baseline", async () => {
    const result = await createBusinessAnalysisWatchAction({
      title: "Watch covers",
      schedule: "0 9 * * 1",
      config: config(),
    });

    expect(result).toMatchObject({ ok: true });
    expect(mocks.schedule).toHaveBeenCalledWith("user-owner", expect.objectContaining({
      organizationId: "org-current",
      taskKind: "business-analysis-watch",
      routeContext: "/performance",
      taskConfig: expect.objectContaining({
        fingerprint: config().fingerprint,
        baseline: {
          value: 115,
          sourceWatermark: "2026-08-12T11:30:00.000Z",
        },
      }),
    }));
    expect(mocks.revalidate).toHaveBeenCalledWith("/performance");
  });

  it("does not schedule without authentication or a current metric", async () => {
    mocks.auth.mockResolvedValueOnce(null);
    await expect(createBusinessAnalysisWatchAction({
      title: "Watch covers",
      schedule: "0 9 * * 1",
      config: config(),
    })).resolves.toEqual({ ok: false, error: "Not authenticated." });
    expect(mocks.schedule).not.toHaveBeenCalled();

    mocks.auth.mockResolvedValue({ user: { id: "user-owner" } });
    mocks.load.mockResolvedValueOnce({
      status: "not-configured",
      reason: "ambiguous",
      metricValues: [],
    });
    const unavailable = await createBusinessAnalysisWatchAction({
      title: "Watch covers",
      schedule: "0 9 * * 1",
      config: config(),
    });
    expect(unavailable).toMatchObject({ ok: false });
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
});
