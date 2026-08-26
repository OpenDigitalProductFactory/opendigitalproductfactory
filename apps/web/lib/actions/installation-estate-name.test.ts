// BI-7626A660 — naming the estate.
//
// The value reaches an MCP handshake and an mDNS TXT record, so the grammar is
// enforced at the action, not only in the form. The clearing case matters as
// much as the saving one: "unnamed" has to stay ONE state, or the badge and the
// handshake start disagreeing about whether "" is a name.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  platformConfig: { upsert: vi.fn(), deleteMany: vi.fn() },
  requireCapability: vi.fn(),
  resolvePrincipalIdForUser: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: { platformConfig: mocks.platformConfig } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/actions/shared/guards", () => ({
  requireCapability: (capability: string) => mocks.requireCapability(capability),
}));
vi.mock("@/lib/identity/principal-linking", () => ({
  resolvePrincipalIdForUser: (userId: string) => mocks.resolvePrincipalIdForUser(userId),
}));

import { declareEstateName } from "./installation-estate-name";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireCapability.mockResolvedValue({ userId: "user-1" });
  mocks.resolvePrincipalIdForUser.mockResolvedValue("PRN-1");
  mocks.platformConfig.upsert.mockResolvedValue({});
  mocks.platformConfig.deleteMany.mockResolvedValue({ count: 1 });
});

describe("declareEstateName", () => {
  it("requires the platform-management capability before anything else", async () => {
    mocks.requireCapability.mockRejectedValue(new Error("forbidden"));
    await expect(declareEstateName("Northwind")).rejects.toThrow("forbidden");
    expect(mocks.platformConfig.upsert).not.toHaveBeenCalled();
  });

  it("stores a valid name with its source and who set it", async () => {
    const result = await declareEstateName("Northwind");

    expect(result).toEqual({ ok: true, data: { estateName: "Northwind" } });
    const written = mocks.platformConfig.upsert.mock.calls[0]?.[0]?.create?.value;
    expect(written).toMatchObject({
      schemaVersion: 1,
      estateName: "Northwind",
      source: "operator",
      declaredByPrincipalId: "PRN-1",
    });
  });

  it("normalizes sloppy whitespace rather than refusing it", async () => {
    const result = await declareEstateName("  Northwind   Group  ");
    expect(result).toEqual({ ok: true, data: { estateName: "Northwind Group" } });
  });

  it("clears the record on an empty submission, keeping unnamed a single state", async () => {
    const result = await declareEstateName("   ");

    expect(result).toEqual({ ok: true, data: { estateName: null } });
    expect(mocks.platformConfig.deleteMany).toHaveBeenCalled();
    expect(mocks.platformConfig.upsert).not.toHaveBeenCalled();
  });

  it("refuses a name that would not survive a slug or a TXT record", async () => {
    for (const bad of ["has/slash", "-leading", "emoji😀", "N".repeat(49)]) {
      const result = await declareEstateName(bad);
      expect(result.ok).toBe(false);
    }
    expect(mocks.platformConfig.upsert).not.toHaveBeenCalled();
  });

  it("explains WHY the grammar is narrow, since the reason is not obvious", async () => {
    const result = await declareEstateName("has/slash");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("published to peers");
    }
  });

  it("records a discovered-peer origin when discovery pre-filled the value", async () => {
    await declareEstateName("Northwind", "discovered-peer");
    const written = mocks.platformConfig.upsert.mock.calls[0]?.[0]?.create?.value;
    expect(written).toMatchObject({ source: "discovered-peer" });
  });

  it("falls back to operator for an unrecognised source rather than storing it", async () => {
    await declareEstateName("Northwind", "invented");
    const written = mocks.platformConfig.upsert.mock.calls[0]?.[0]?.create?.value;
    expect(written).toMatchObject({ source: "operator" });
  });

  it("revalidates the whole layout, because the badge lives in the shell header", async () => {
    await declareEstateName("Northwind");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
});
