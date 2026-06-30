import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    providerCapacityStatus: {
      upsert: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import {
  clearProviderCapacityStatus,
  recordProviderCapacityStatus,
} from "./store";

const mockUpsert = prisma.providerCapacityStatus.upsert as ReturnType<typeof vi.fn>;
const NOW = new Date("2026-06-29T20:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("provider capacity store", () => {
  it("upserts the current provider capacity classification", async () => {
    await recordProviderCapacityStatus({
      providerId: "zai-coding",
      source: "opencode",
      observedAt: NOW,
      classification: {
        state: "billing_action_required",
        action: "add_credits_or_plan",
        providerCode: "1113",
        safeSummary: "Z.ai needs coding credits.",
        confidence: "exact",
        isHumanActionRequired: true,
      },
      rawSnippet: "Insufficient balance",
    });

    expect(mockUpsert).toHaveBeenCalledWith({
      where: { providerId: "zai-coding" },
      create: expect.objectContaining({
        providerId: "zai-coding",
        state: "billing_action_required",
        action: "add_credits_or_plan",
        providerCode: "1113",
        source: "opencode",
        rawSnippet: "Insufficient balance",
        isHumanActionRequired: true,
      }),
      update: expect.objectContaining({
        state: "billing_action_required",
        action: "add_credits_or_plan",
        providerCode: "1113",
        source: "opencode",
        rawSnippet: "Insufficient balance",
        isHumanActionRequired: true,
      }),
    });
  });

  it("marks a provider available after a successful call", async () => {
    await clearProviderCapacityStatus({
      providerId: "zai-coding",
      source: "api",
      observedAt: NOW,
    });

    expect(mockUpsert).toHaveBeenCalledWith({
      where: { providerId: "zai-coding" },
      create: expect.objectContaining({
        providerId: "zai-coding",
        state: "available",
        action: "none",
        lastSuccessAt: NOW,
        isHumanActionRequired: false,
      }),
      update: expect.objectContaining({
        state: "available",
        action: "none",
        retryAt: null,
        providerCode: null,
        lastSuccessAt: NOW,
        isHumanActionRequired: false,
      }),
    });
  });
});
