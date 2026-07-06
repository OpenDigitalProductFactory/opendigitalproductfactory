import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@dpf/db", () => ({
  prisma: {
    opportunity: { update: vi.fn() },
    activity: { create: vi.fn().mockResolvedValue({}) },
  },
}));

import { prisma } from "@dpf/db";
import { setOpportunityNextStep } from "./opportunity-next-step";

const p = prisma as unknown as {
  opportunity: { update: ReturnType<typeof vi.fn> };
  activity: { create: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  p.opportunity.update.mockResolvedValue({ id: "o1", accountId: "a1", title: "Deal" });
  p.activity.create.mockResolvedValue({});
});

describe("setOpportunityNextStep", () => {
  it("sets nextActivityAt, clears dormancy, and logs a scheduled task on the timeline", async () => {
    const res = await setOpportunityNextStep({ opportunityId: "o1", scheduledAt: "2026-08-01", note: "Call Ian" });
    const upd = p.opportunity.update.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "o1" });
    expect(upd.data.nextActivityAt).toBeInstanceOf(Date);
    expect(upd.data.isDormant).toBe(false);
    const act = p.activity.create.mock.calls[0][0].data;
    expect(act.type).toBe("task");
    expect(act.subject).toBe("Call Ian");
    expect(act.opportunityId).toBe("o1");
    expect(act.scheduledAt).toBeInstanceOf(Date);
    expect(res.ok).toBe(true);
  });

  it("rejects an unparseable date", async () => {
    await expect(setOpportunityNextStep({ opportunityId: "o1", scheduledAt: "not-a-date" })).rejects.toThrow(/valid date/i);
    expect(p.opportunity.update).not.toHaveBeenCalled();
  });
});
