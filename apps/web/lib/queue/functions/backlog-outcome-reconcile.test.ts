import { describe, expect, it, vi } from "vitest";

const { mockBackfill, mockEvents, mockGate } = vi.hoisted(() => ({
  mockBackfill: vi.fn(),
  mockEvents: vi.fn(),
  mockGate: vi.fn(async () => ({ proceed: true }) as { proceed: boolean; reason?: string }),
}));

vi.mock("@dpf/db", () => ({ prisma: { backlogItem: {} } }));
vi.mock("@/lib/backlog/outcome-backfill", () => ({ backfillBacklogItemOutcomes: mockBackfill }));
vi.mock("@/lib/product-management/delivered-work-outcomes-repository", () => ({ recordItemOutcomeEvents: mockEvents }));
vi.mock("../quiescence-gates", () => ({ gateAtEntry: mockGate }));
vi.mock("@/lib/jobs", () => ({
  jobs: { createFunction: vi.fn((config: unknown, handler: unknown) => ({ config, handler })) },
}));

import { backlogOutcomeReconcile } from "./backlog-outcome-reconcile";
import { getCatalogEntryByInngestId } from "@/lib/operate/scheduled-jobs/catalog";

type Fn = {
  config: { id: string; triggers: Array<{ cron?: string }> };
  handler: (ctx: { step: { run: (name: string, f: () => Promise<unknown>) => Promise<unknown> } }) => Promise<unknown>;
};
const fn = backlogOutcomeReconcile as unknown as Fn;

describe("backlogOutcomeReconcile (BI-8DE5429B)", () => {
  it("is an hourly cron registered in the scheduled-job catalog behind the kill switch", () => {
    expect(fn.config.id).toBe("ops/backlog-outcome-reconcile");
    expect(JSON.stringify(fn.config.triggers)).toContain("41 * * * *");
    const entry = getCatalogEntryByInngestId("ops/backlog-outcome-reconcile");
    expect(entry?.honorsEnabledGate).toBe(true);
    expect(entry?.cron).toBe("41 * * * *");
  });

  it("backfills outcomes, then records item outcome events, after the entry gate", async () => {
    mockBackfill.mockResolvedValue({ filled: 2, bySource: { stated: 1, derived: 1 }, alreadyFilled: 0, remaining: 5 });
    mockEvents.mockResolvedValue({ scanned: 1, recorded: 1, byResult: { regressed: 1 }, skipped: {}, truncated: false });
    const run = vi.fn(async (_name: string, f: () => Promise<unknown>) => f());
    const result = await fn.handler({ step: { run } });
    expect(run.mock.calls.map((call) => call[0])).toEqual(["backfill-item-outcomes", "record-item-outcome-events"]);
    expect(result).toMatchObject({ backfill: { filled: 2 }, events: { recorded: 1 } });
  });

  it("does nothing when the gate refuses entry", async () => {
    mockBackfill.mockClear();
    mockGate.mockResolvedValueOnce({ proceed: false, reason: "disabled-by-operator" });
    const result = await fn.handler({ step: { run: vi.fn() } });
    expect(result).toEqual({ skipped: true, reason: "disabled-by-operator" });
    expect(mockBackfill).not.toHaveBeenCalled();
  });
});
