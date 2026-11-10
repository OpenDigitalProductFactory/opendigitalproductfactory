import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  modelProvider: { findUnique: vi.fn() },
  modelProfile: { findUnique: vi.fn() },
  tokenUsage: { create: vi.fn(async () => ({})) },
}));
vi.mock("@dpf/db", () => ({ prisma: db }));

import { logTokenUsage } from "./ai-inference";

const recordedCost = () => (db.tokenUsage.create.mock.calls.at(-1) as unknown as [{ data: { costUsd: number } }])[0].data.costUsd;
const usage = { agentId: "change-reviewer", providerId: "openrouter", contextKey: "review", inputTokens: 600_000, outputTokens: 400_000 };

// BI-F3B6713F: a paid provider with no recorded price recorded $0, so the
// owner's paid AI allowance could not see its spend (independent review).
describe("logTokenUsage cost for a provider with no recorded price", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the model's profiled price when the provider has none", async () => {
    db.modelProvider.findUnique.mockResolvedValue({ costModel: "token", inputPricePerMToken: null, outputPricePerMToken: null });
    db.modelProfile.findUnique.mockResolvedValue({ inputPricePerMToken: 1, outputPricePerMToken: 5 });
    await logTokenUsage({ ...usage, modelId: "some/model" });
    expect(recordedCost()).toBeCloseTo(0.6 + 2, 6);
    expect(db.tokenUsage.create.mock.calls.at(-1)).not.toEqual([expect.objectContaining({ data: expect.objectContaining({ modelId: expect.anything() }) })]);
  });

  it("falls back to the conservative $3 per million tokens, never $0", async () => {
    db.modelProvider.findUnique.mockResolvedValue({ costModel: "token", inputPricePerMToken: null, outputPricePerMToken: null });
    db.modelProfile.findUnique.mockResolvedValue(null);
    await logTokenUsage(usage);
    expect(recordedCost()).toBeCloseTo(3, 6);
  });

  it("keeps an explicitly zero-priced subscription at $0 and a priced provider at its price", async () => {
    db.modelProvider.findUnique.mockResolvedValue({ costModel: "token", inputPricePerMToken: 0, outputPricePerMToken: 0 });
    await logTokenUsage({ ...usage, providerId: "anthropic-sub" });
    expect(recordedCost()).toBe(0);
    db.modelProvider.findUnique.mockResolvedValue({ costModel: "token", inputPricePerMToken: 3, outputPricePerMToken: 15 });
    await logTokenUsage({ ...usage, providerId: "anthropic" });
    expect(recordedCost()).toBeCloseTo(1.8 + 6, 6);
    expect(db.modelProfile.findUnique).not.toHaveBeenCalled();
  });

  // A cost model other than "compute" is classified as paid by the budget
  // gate, so it must never record $0 either (TR-GATE-73918D25 review).
  it("estimates a provider whose cost model is neither token nor compute", async () => {
    db.modelProvider.findUnique.mockResolvedValue({ costModel: "subscription", inputPricePerMToken: null, outputPricePerMToken: null });
    db.modelProfile.findUnique.mockResolvedValue(null);
    await logTokenUsage(usage);
    expect(recordedCost()).toBeCloseTo(3, 6);
  });
});
