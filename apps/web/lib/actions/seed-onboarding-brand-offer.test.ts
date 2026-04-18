import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  threadFindUnique: vi.fn(),
  threadCreate: vi.fn(),
  messageCreate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));

vi.mock("@dpf/db", () => ({
  prisma: {
    agentThread: {
      findUnique: mocks.threadFindUnique,
      create: mocks.threadCreate,
    },
    agentMessage: {
      create: mocks.messageCreate,
    },
  },
}));

import { seedOnboardingBrandOffer } from "./seed-onboarding-brand-offer";

describe("seedOnboardingBrandOffer", () => {
  beforeEach(() => {
    mocks.auth.mockReset();
    mocks.threadFindUnique.mockReset();
    mocks.threadCreate.mockReset();
    mocks.messageCreate.mockReset();
  });

  it("creates the onboarding-coo thread AND seeds the offer when neither exists", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.threadFindUnique.mockResolvedValue(null);
    mocks.threadCreate.mockResolvedValue({ id: "thread-1" });
    mocks.messageCreate.mockResolvedValue({});

    const result = await seedOnboardingBrandOffer();

    expect(result.success).toBe(true);
    expect(mocks.threadCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          contextKey: "coworker:/setup",
        }),
      }),
    );
    expect(mocks.messageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          threadId: "thread-1",
          role: "assistant",
        }),
      }),
    );
  });

  it("does NOT re-seed the offer if the thread already exists (idempotent)", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.threadFindUnique.mockResolvedValue({ id: "thread-existing" });

    const result = await seedOnboardingBrandOffer();

    expect(result.success).toBe(true);
    expect(mocks.threadCreate).not.toHaveBeenCalled();
    expect(mocks.messageCreate).not.toHaveBeenCalled();
  });

  it("returns an error when the user is not authenticated", async () => {
    mocks.auth.mockResolvedValue(null);

    const result = await seedOnboardingBrandOffer();

    expect(result.success).toBe(false);
    expect(mocks.threadCreate).not.toHaveBeenCalled();
  });

  it("survives message insert errors (thread creation is still considered success)", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.threadFindUnique.mockResolvedValue(null);
    mocks.threadCreate.mockResolvedValue({ id: "thread-2" });
    mocks.messageCreate.mockRejectedValue(new Error("transient DB error"));

    const result = await seedOnboardingBrandOffer();

    expect(result.success).toBe(true);
  });
});
