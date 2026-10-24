import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    tokenUsage: { aggregate: vi.fn() },
    agentBudgetEvent: { create: vi.fn() },
    modelProfile: { findUnique: vi.fn() },
    modelProvider: { findUnique: vi.fn() },
    aiProviderFinanceProfile: { findUnique: vi.fn() },
  },
}));

import { checkAgentBudget, writeBudgetEvent } from "./budget-gate";
import { prisma } from "@dpf/db";

function mockTokenUsage(input: number, output: number) {
  vi.mocked(prisma.tokenUsage.aggregate).mockResolvedValue({
    _sum: { inputTokens: input, outputTokens: output },
  } as Awaited<ReturnType<typeof prisma.tokenUsage.aggregate>>);
}

describe("checkAgentBudget", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns ok when usage is below 80% of daily limit", async () => {
    mockTokenUsage(30_000, 10_000); // 40 000 / 100 000 = 40%
    const result = await checkAgentBudget("build-architect", 100_000);
    expect(result.status).toBe("ok");
    expect(result.actualTokens).toBe(40_000);
    expect(result.ratioPercent).toBe(40);
  });

  it("returns warning_80 when usage is 80–95% of daily limit", async () => {
    mockTokenUsage(70_000, 15_000); // 85 000 / 100 000 = 85%
    const result = await checkAgentBudget("build-architect", 100_000);
    expect(result.status).toBe("warning_80");
    expect(result.ratioPercent).toBe(85);
  });

  it("returns warning_95 when usage is 95–100% of daily limit", async () => {
    mockTokenUsage(90_000, 7_000); // 97 000 / 100 000 = 97%
    const result = await checkAgentBudget("build-architect", 100_000);
    expect(result.status).toBe("warning_95");
    expect(result.ratioPercent).toBe(97);
  });

  it("returns rejected when usage exceeds daily limit", async () => {
    mockTokenUsage(95_000, 10_000); // 105 000 / 100 000 = 105%
    const result = await checkAgentBudget("build-architect", 100_000);
    expect(result.status).toBe("rejected");
    expect(result.actualTokens).toBe(105_000);
  });

  it("returns ok immediately when dailyLimit is 0 (unlimited)", async () => {
    const result = await checkAgentBudget("build-architect", 0);
    expect(result.status).toBe("ok");
    expect(prisma.tokenUsage.aggregate).not.toHaveBeenCalled();
  });

  it("handles null _sum fields (no usage yet today)", async () => {
    vi.mocked(prisma.tokenUsage.aggregate).mockResolvedValue({
      _sum: { inputTokens: null, outputTokens: null },
    } as Awaited<ReturnType<typeof prisma.tokenUsage.aggregate>>);
    const result = await checkAgentBudget("build-architect", 100_000);
    expect(result.status).toBe("ok");
    expect(result.actualTokens).toBe(0);
  });
});

describe("writeBudgetEvent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates an AgentBudgetEvent row", async () => {
    vi.mocked(prisma.agentBudgetEvent.create).mockResolvedValue({} as never);
    await writeBudgetEvent({
      agentId: "build-architect",
      eventKind: "rejected",
      actualTokens: 105_000,
      limitTokens: 100_000,
      modelId: "claude-sonnet-4-6",
      providerId: "anthropic-sub",
    });
    expect(prisma.agentBudgetEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          agentId: "build-architect",
          eventKind: "rejected",
          tokensTotal: 105_000,
        }),
      }),
    );
  });

  it("swallows DB errors without throwing", async () => {
    vi.mocked(prisma.agentBudgetEvent.create).mockRejectedValue(new Error("DB down"));
    // Should not throw
    await expect(
      writeBudgetEvent({ agentId: "build-architect", eventKind: "warning_80", actualTokens: 85_000, limitTokens: 100_000 })
    ).resolves.toBeUndefined();
  });
});

describe("amountUsd reflects cash, not the published rate", () => {
  beforeEach(() => vi.clearAllMocks());

  function amountUsdFromLastEvent(): number {
    const call = vi.mocked(prisma.agentBudgetEvent.create).mock.calls[0]?.[0] as
      | { data: { amountUsd: number } }
      | undefined;
    if (!call) throw new Error("no AgentBudgetEvent was written");
    return call.data.amountUsd;
  }

  async function writeOne(valuationMethod: string | null) {
    mockTokenUsage(0, 0);
    vi.mocked(prisma.aiProviderFinanceProfile.findUnique).mockResolvedValue(
      valuationMethod === null
        ? null
        : ({ valuationMethod } as never),
    );
    vi.mocked(prisma.modelProfile.findUnique).mockResolvedValue({
      inputPricePerMToken: 5,
      outputPricePerMToken: 25,
    } as never);
    vi.mocked(prisma.agentBudgetEvent.create).mockResolvedValue({} as never);
    await writeBudgetEvent({
      agentId: "build-architect",
      eventKind: "warning_80",
      actualTokens: 1_000_000,
      limitTokens: 2_000_000,
      providerId: "anthropic-sub",
      modelId: "claude-opus-5",
    });
  }

  it("charges nothing extra for a provider funded by a commitment", async () => {
    // The Max subscription already bought these tokens. Billing them at the
    // list rate would invent spend that no invoice will ever show.
    await writeOne("commitment_first");
    expect(amountUsdFromLastEvent()).toBe(0);
  });

  it("charges the published rate when the provider bills per token", async () => {
    // Blended 60/40 of $5 in and $25 out = $13/MTok over 1M tokens.
    await writeOne("metered");
    expect(amountUsdFromLastEvent()).toBeCloseTo(13, 6);
  });

  it("treats a provider with no finance profile as metered", async () => {
    // Failing open to $0 would hide real spend behind missing config; a
    // provider we know nothing about must still be assumed to cost money.
    await writeOne(null);
    expect(amountUsdFromLastEvent()).toBeCloseTo(13, 6);
  });
});
