import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    tokenUsage: { aggregate: vi.fn() },
    agentBudgetEvent: { create: vi.fn() },
    modelProfile: { findUnique: vi.fn() },
    modelProvider: { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
    aiProviderFinanceProfile: { findUnique: vi.fn() },
    platformDevConfig: { findUnique: vi.fn(async () => null) },
  },
}));

import {
  AgentAllowanceExhaustedError, checkAgentBudget, checkAgentBudgetFromRegistry,
  classifyProviderSpend, isZeroMarginalPricing, nextAllowanceReset, providerSpendClass, writeBudgetEvent,
} from "./budget-gate";
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

  it("enforces the real registered Critic daily limit instead of silently treating a missing runtime module as unlimited", async () => {
    mockTokenUsage(200001, 0);
    expect(await checkAgentBudgetFromRegistry("ux-design-critic")).toMatchObject({
      status: "rejected", actualTokens: 200001, limitTokens: 200000,
    });
    expect(prisma.tokenUsage.aggregate).toHaveBeenCalledOnce();
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

// BI-F3B6713F: on 2026-11-03 change-reviewer hit its 200k cap on 178k local
// tokens ($0.02) plus 28k subscription tokens ($0.00), and every PR stalled.
describe("only real spend counts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("treats compute-priced (local) and zero-token-priced (subscription) providers as free, and an unpriced one as paid", () => {
    expect(isZeroMarginalPricing({ costModel: "compute", inputPricePerMToken: null, outputPricePerMToken: null })).toBe(true);
    expect(isZeroMarginalPricing({ costModel: "token", inputPricePerMToken: 0, outputPricePerMToken: 0 })).toBe(true);
    expect(isZeroMarginalPricing({ costModel: "token", inputPricePerMToken: 3, outputPricePerMToken: 15 })).toBe(false);
    expect(isZeroMarginalPricing({ costModel: "token", inputPricePerMToken: null, outputPricePerMToken: null })).toBe(false);
    expect(isZeroMarginalPricing(null)).toBe(false);
  });

  it("decides by the recorded price, never by the provider's name", async () => {
    vi.mocked(prisma.modelProvider.findUnique).mockResolvedValueOnce({ costModel: "token", inputPricePerMToken: 0, outputPricePerMToken: 0 } as never);
    expect(await classifyProviderSpend("anthropic-sub")).toBe("free");
    vi.mocked(prisma.modelProvider.findUnique).mockResolvedValueOnce({ costModel: "token", inputPricePerMToken: 3, outputPricePerMToken: 15 } as never);
    expect(await classifyProviderSpend("anthropic")).toBe("priced");
    vi.mocked(prisma.modelProvider.findUnique).mockResolvedValueOnce({ costModel: "token", inputPricePerMToken: null, outputPricePerMToken: null } as never);
    expect(await classifyProviderSpend("openrouter")).toBe("unpriced");
    vi.mocked(prisma.modelProvider.findUnique).mockResolvedValueOnce(null);
    expect(await classifyProviderSpend("unregistered")).toBe("unpriced");
    expect(providerSpendClass({ costModel: "compute", inputPricePerMToken: null, outputPricePerMToken: null })).toBe("free");
  });

  it("excludes free providers' usage from the agent's daily cap", async () => {
    vi.mocked(prisma.modelProvider.findMany).mockResolvedValueOnce([{ providerId: "local" }, { providerId: "anthropic-sub" }] as never);
    mockTokenUsage(0, 0);
    const result = await checkAgentBudgetFromRegistry("change-reviewer");
    expect(result).toMatchObject({ status: "ok", governedBy: "agent-cap", limitTokens: 200_000 });
    expect(prisma.tokenUsage.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ agentId: "change-reviewer", providerId: { notIn: ["local", "anthropic-sub"] } }),
    }));
  });
});

describe("the owner-set paid AI allowance governs instead of per-agent caps", () => {
  beforeEach(() => vi.clearAllMocks());

  function mockSpend(costUsd: number) {
    vi.mocked(prisma.tokenUsage.aggregate).mockResolvedValue({
      _sum: { inputTokens: 900_000, outputTokens: 100_000, costUsd },
    } as Awaited<ReturnType<typeof prisma.tokenUsage.aggregate>>);
  }

  it("ignores the agent's token cap once the owner records an allowance", async () => {
    vi.mocked(prisma.platformDevConfig.findUnique).mockResolvedValueOnce({ paidInferenceDailyUsdAllowance: 25 } as never);
    mockSpend(5);
    // 1M paid tokens would be 5x the registry cap; the owner's $25 decides.
    expect(await checkAgentBudgetFromRegistry("change-reviewer")).toMatchObject({
      status: "ok", governedBy: "owner-allowance", spentUsd: 5, allowanceUsd: 25, ratioPercent: 20,
    });
    const where = vi.mocked(prisma.tokenUsage.aggregate).mock.calls[0]![0]!.where as Record<string, unknown>;
    expect(where.agentId).toBeUndefined();
  });

  it("refuses once the installation's paid spend reaches the allowance", async () => {
    vi.mocked(prisma.platformDevConfig.findUnique).mockResolvedValueOnce({ paidInferenceDailyUsdAllowance: 25 } as never);
    mockSpend(25.01);
    expect((await checkAgentBudgetFromRegistry("change-reviewer")).status).toBe("rejected");
  });

  it("an allowance of zero permits no paid calls", async () => {
    vi.mocked(prisma.platformDevConfig.findUnique).mockResolvedValueOnce({ paidInferenceDailyUsdAllowance: 0 } as never);
    mockSpend(0);
    expect((await checkAgentBudgetFromRegistry("change-reviewer")).status).toBe("rejected");
  });

  it("falls back to the agent cap when the allowance cannot be read", async () => {
    vi.mocked(prisma.platformDevConfig.findUnique).mockRejectedValueOnce(new Error("db down"));
    mockTokenUsage(200_001, 0);
    expect(await checkAgentBudgetFromRegistry("change-reviewer")).toMatchObject({ status: "rejected", governedBy: "agent-cap" });
  });

  it("names the reset time and how to raise it when refusing", () => {
    const now = new Date("2026-11-03T18:40:00.000Z");
    expect(nextAllowanceReset(now).toISOString()).toBe("2026-11-04T00:00:00.000Z");
    const error = new AgentAllowanceExhaustedError({ agentId: "change-reviewer", now,
      budget: { status: "rejected", actualTokens: 0, limitTokens: 0, ratioPercent: 100, governedBy: "owner-allowance", spentUsd: 25.5, allowanceUsd: 25 } });
    expect(error.name).toBe("AgentAllowanceExhaustedError");
    expect(error.resetAt).toBe("2026-11-04T00:00:00.000Z");
    expect(error.message).toMatch(/^Daily allowance used: \$25\.50 of the \$25\.00 installation allowance/);
    expect(error.message).toMatch(/Admin > Platform Development > Paid AI allowance/);
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
