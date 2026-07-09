import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: { platformConfig: { findUnique: vi.fn() } },
}));

import { prisma } from "@dpf/db";

import { isStallWatchdogEnabled, isUnifiedCoworkerEnabled } from "./feature-flags";

const findUnique = prisma.platformConfig.findUnique as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isUnifiedCoworkerEnabled (BI-45514C4E: unified is the default)", () => {
  it("defaults to unified when there is no PlatformConfig row", async () => {
    findUnique.mockResolvedValueOnce(null);
    expect(await isUnifiedCoworkerEnabled()).toBe(true);
  });

  it("defaults to unified when the row has no enabled field", async () => {
    findUnique.mockResolvedValueOnce({ value: {} });
    expect(await isUnifiedCoworkerEnabled()).toBe(true);
  });

  it("stays unified when explicitly enabled", async () => {
    findUnique.mockResolvedValueOnce({ value: { enabled: true } });
    expect(await isUnifiedCoworkerEnabled()).toBe(true);
  });

  it("falls back to legacy ONLY when an operator explicitly disables it", async () => {
    findUnique.mockResolvedValueOnce({ value: { enabled: false } });
    expect(await isUnifiedCoworkerEnabled()).toBe(false);
  });
});

describe("isStallWatchdogEnabled (unchanged: opt-in, defaults off)", () => {
  it("defaults off with no row", async () => {
    findUnique.mockResolvedValueOnce(null);
    expect(await isStallWatchdogEnabled()).toBe(false);
  });

  it("is on only when explicitly enabled", async () => {
    findUnique.mockResolvedValueOnce({ value: { enabled: true } });
    expect(await isStallWatchdogEnabled()).toBe(true);
  });
});
