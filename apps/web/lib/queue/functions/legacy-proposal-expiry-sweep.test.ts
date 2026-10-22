import { describe, expect, it, vi } from "vitest";

const { mockExpire, mockGate } = vi.hoisted(() => ({
  mockExpire: vi.fn(),
  mockGate: vi.fn(async () => ({ proceed: true }) as { proceed: boolean; reason?: string }),
}));

vi.mock("@dpf/db", () => ({ prisma: { agentActionProposal: {}, $transaction: vi.fn() } }));
vi.mock("@/lib/coworker/legacy-proposal-expiry", () => ({ expireLapsedLegacyProposals: mockExpire }));
vi.mock("../quiescence-gates", () => ({ gateAtEntry: mockGate }));
vi.mock("@/lib/jobs", () => ({
  jobs: { createFunction: vi.fn((config: unknown, handler: unknown) => ({ config, handler })) },
}));

import { legacyProposalExpirySweep } from "./legacy-proposal-expiry-sweep";
import { getCatalogEntryByInngestId } from "@/lib/operate/scheduled-jobs/catalog";

type Fn = {
  config: { id: string; triggers: Array<{ cron?: string }> };
  handler: (ctx: { step: { run: (name: string, f: () => Promise<unknown>) => Promise<unknown> } }) => Promise<unknown>;
};
const fn = legacyProposalExpirySweep as unknown as Fn;

describe("legacyProposalExpirySweep (BI-753D69A9)", () => {
  it("is a daily cron registered in the scheduled-job catalog behind the kill switch", () => {
    expect(fn.config.id).toBe("ops/legacy-proposal-expiry-sweep");
    expect(JSON.stringify(fn.config.triggers)).toContain("17 4 * * *");
    const entry = getCatalogEntryByInngestId("ops/legacy-proposal-expiry-sweep");
    expect(entry?.honorsEnabledGate).toBe(true);
    expect(entry?.cron).toBe("17 4 * * *");
  });

  it("runs the expiry as one step after the entry gate", async () => {
    mockExpire.mockResolvedValue({ expired: 3, alreadySettled: 0, failed: 0, truncated: false, errors: [] });
    const run = vi.fn(async (_name: string, f: () => Promise<unknown>) => f());
    const result = await fn.handler({ step: { run } });
    expect(mockGate).toHaveBeenCalledWith(expect.anything(), "ops/legacy-proposal-expiry-sweep");
    expect(run).toHaveBeenCalledWith("expire-lapsed-legacy-proposals", expect.any(Function));
    expect(result).toMatchObject({ expired: 3 });
  });

  it("does nothing when the gate refuses entry", async () => {
    mockExpire.mockClear();
    mockGate.mockResolvedValueOnce({ proceed: false, reason: "disabled-by-operator" });
    const run = vi.fn();
    const result = await fn.handler({ step: { run } });
    expect(result).toEqual({ skipped: true, reason: "disabled-by-operator" });
    expect(mockExpire).not.toHaveBeenCalled();
  });
});
