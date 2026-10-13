import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ discovered: vi.fn(), profile: vi.fn(), update: vi.fn() }));
vi.mock("@dpf/db", () => ({ Prisma: { AnyNull: "any-null" }, prisma: {
  discoveredModel: { findMany: mocks.discovered },
  modelProfile: { findUnique: mocks.profile, updateMany: mocks.update },
} }));

import { backfillModelCards } from "./model-card-maintenance";

describe("ModelCard output capacity backfill", () => {
  beforeEach(() => {
    mocks.discovered.mockReset();
    mocks.discovered.mockResolvedValue([{ providerId: "anthropic", modelId: "claude-future", rawMetadata: { max_input_tokens: 48_000, max_tokens: 64_000 } }]);
    mocks.profile.mockReset();
    mocks.profile.mockResolvedValue({ profileSource: "seed", capabilityOverrides: null });
    mocks.update.mockReset();
    mocks.update.mockResolvedValue({ count: 1 });
  });

  it("backfills provider-reported output capacity through the real adapter", async () => {
    expect(await backfillModelCards()).toBe(1);
    expect(mocks.update.mock.calls[0][0]).toMatchObject({
      where: { providerId: "anthropic", modelId: "claude-future" },
      data: { maxOutputTokens: 64_000 },
    });
    expect(mocks.update.mock.calls[1][0].data).toMatchObject({ maxInputTokens: 48_000 });
    expect(mocks.update.mock.calls[1][0].data).not.toHaveProperty("maxOutputTokens");
  });

  it("retains existing output capacity when discovery omits the limit", async () => {
    mocks.discovered.mockResolvedValue([{ providerId: "codex", modelId: "gpt-future", rawMetadata: {} }]);
    mocks.profile.mockResolvedValue({ profileSource: "evaluated", capabilityOverrides: {}, maxOutputTokens: 32_768 });
    await backfillModelCards();
    expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty("maxOutputTokens");
  });

  it.each([
    { profileSource: "admin", capabilityOverrides: null },
    { profileSource: "seed", capabilityOverrides: { maxOutputTokens: false } },
  ])("keeps output ownership for %j", async (owner) => {
    mocks.profile.mockResolvedValue(owner);
    await backfillModelCards();
    expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty("maxOutputTokens");
  });

  it("preserves a concurrent admin output lock during backfill", async () => {
    const row = { profileSource: "admin", capabilityOverrides: { maxOutputTokens: false }, maxOutputTokens: 32_768 };
    mocks.profile.mockResolvedValue({ profileSource: "seed", capabilityOverrides: {} });
    mocks.update.mockImplementation(async ({ where, data }) => {
      if (where.profileSource === undefined || (where.profileSource === row.profileSource && JSON.stringify(where.capabilityOverrides?.equals) === JSON.stringify(row.capabilityOverrides))) Object.assign(row, data);
      return { count: 1 };
    });
    await backfillModelCards();
    expect(row.maxOutputTokens).toBe(32_768);
    expect(row.capabilityOverrides).toEqual({ maxOutputTokens: false });
  });
});
