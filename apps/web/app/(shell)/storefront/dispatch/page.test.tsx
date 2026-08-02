import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { mockConfigFindFirst, mockGetDispatchBoard } = vi.hoisted(() => ({
  mockConfigFindFirst: vi.fn(),
  mockGetDispatchBoard: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    storefrontConfig: { findFirst: mockConfigFindFirst },
  },
}));

vi.mock("@/lib/storefront/dispatch-board-data", () => ({
  getDispatchBoard: mockGetDispatchBoard,
}));

const baseJob = {
  itemId: "WI-1",
  title: "AC Repair - Dana",
  status: "scheduled",
  statusLabel: "Scheduled",
  urgency: "urgent",
  dueAt: "2026-07-08T14:00:00.000Z",
  createdAt: "2026-07-06T12:00:00.000Z",
  assigned: false,
  assignmentLabel: "Needs assignment",
  partsUsed: 2,
  attentionReasons: ["Scheduled but not confirmed", "Needs assignment"],
};

function board(overrides: Record<string, unknown> = {}) {
  const activeJob = {
    ...baseJob,
    itemId: "WI-2",
    title: "Water heater install - Jules",
    status: "en-route",
    statusLabel: "En route",
    urgency: "routine",
    dueAt: "2026-07-08T16:00:00.000Z",
    assigned: true,
    assignmentLabel: "Assigned",
    attentionReasons: [],
  };

  return {
    total: 2,
    summary: {
      needsAttention: 1,
      unassigned: 1,
      active: 1,
      readyToInvoice: 0,
      partsUsed: 2,
    },
    nextJob: baseJob,
    routeStops: [baseJob, activeJob],
    columns: [
      { key: "needs-dispatch", label: "Needs dispatch", jobs: [baseJob] },
      { key: "ready", label: "Ready", jobs: [] },
      { key: "active", label: "En route / on site", jobs: [activeJob] },
      { key: "complete", label: "Work done", jobs: [] },
      { key: "settled", label: "Billed / paid", jobs: [] },
    ],
    ...overrides,
  };
}

describe("DispatchBoardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigFindFirst.mockResolvedValue({
      id: "sf-1",
      archetype: { category: "trades-maintenance", customVocabulary: null },
    });
    mockGetDispatchBoard.mockResolvedValue(board());
  });

  it("renders a scan-first operational surface for field-service dispatch", async () => {
    const { default: DispatchBoardPage } = await import("./page");
    const html = renderToStaticMarkup(await DispatchBoardPage());

    expect(html).toContain("Dispatch");
    expect(html).toContain("Alerts");
    expect(html).toContain("Unassigned");
    expect(html).toContain("Active");
    expect(html).toContain("Billing");
    expect(html).toContain("Route");
    expect(html).toContain("Schedule");
    expect(html).toContain("Support");
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-labelledby="dispatch-lanes-heading"');
    expect(html).not.toContain('tabindex="0"');
    expect(html).toContain('aria-label="Route order"');
    expect(html).toContain('aria-label="Upcoming dispatch schedule"');
    expect(html).toContain('aria-label="Attention reasons for AC Repair - Dana"');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('aria-posinset="1"');
    expect(html).toContain('aria-setsize="2"');
    expect(html).toContain('aria-label="Next stop; stop 1 of 2: AC Repair - Dana, 2026-07-08 14:00 UTC"');
    expect(html).toContain('aria-label="Schedule item 1 of 2: 2026-07-08 14:00 UTC; AC Repair - Dana; Needs assignment"');
    expect(html).toContain('aria-labelledby="dispatch-job-WI-1-title"');
    expect(html).toContain('aria-describedby="dispatch-job-WI-1-detail"');
    expect(html).toContain("AC Repair - Dana");
    expect(html).toContain("Next stop");
    expect(html).toContain("Needs assignment");
    expect(html).toContain("Scheduled but not confirmed");
  });

  it("does not query the board outside field-service archetypes", async () => {
    mockConfigFindFirst.mockResolvedValue({
      id: "sf-1",
      archetype: { category: "beauty-personal-care", customVocabulary: null },
    });

    const { default: DispatchBoardPage } = await import("./page");
    const html = renderToStaticMarkup(await DispatchBoardPage());

    expect(html).toContain("Field-service required.");
    expect(mockGetDispatchBoard).not.toHaveBeenCalled();
  });
});
