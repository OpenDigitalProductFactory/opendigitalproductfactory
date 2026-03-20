// apps/web/lib/routing/rate-recovery.test.ts
import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { scheduleRecovery, cancelRecovery, _resetAllRecoveries } from "./rate-recovery";

// Mock prisma
vi.mock("@dpf/db", () => ({
  prisma: {
    modelProfile: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  },
}));

import { prisma } from "@dpf/db";

describe("rate-recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetAllRecoveries();
    vi.mocked(prisma.modelProfile.updateMany).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires recovery after delay", async () => {
    scheduleRecovery("openai", "gpt-4o", 60_000);
    expect(prisma.modelProfile.updateMany).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(prisma.modelProfile.updateMany).toHaveBeenCalledWith({
      where: { providerId: "openai", modelId: "gpt-4o", modelStatus: "degraded" },
      data: { modelStatus: "active" },
    });
  });

  it("replaces previous timer on duplicate schedule", async () => {
    scheduleRecovery("openai", "gpt-4o", 60_000);
    scheduleRecovery("openai", "gpt-4o", 120_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(prisma.modelProfile.updateMany).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(prisma.modelProfile.updateMany).toHaveBeenCalledTimes(1);
  });

  it("cancelRecovery prevents callback", async () => {
    scheduleRecovery("openai", "gpt-4o", 60_000);
    cancelRecovery("openai", "gpt-4o");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(prisma.modelProfile.updateMany).not.toHaveBeenCalled();
  });

  it("_resetAllRecoveries clears all timers", async () => {
    scheduleRecovery("openai", "gpt-4o", 60_000);
    scheduleRecovery("anthropic", "claude-opus-4-6", 60_000);
    _resetAllRecoveries();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(prisma.modelProfile.updateMany).not.toHaveBeenCalled();
  });

  it("only restores models that are still degraded", async () => {
    scheduleRecovery("openai", "gpt-4o", 60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(prisma.modelProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ modelStatus: "degraded" }),
      }),
    );
  });

  it("uses default delay of 60s when not specified", async () => {
    scheduleRecovery("openai", "gpt-4o");
    await vi.advanceTimersByTimeAsync(59_999);
    expect(prisma.modelProfile.updateMany).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(prisma.modelProfile.updateMany).toHaveBeenCalledTimes(1);
  });
});
