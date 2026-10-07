import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ upsert: vi.fn(), findUnique: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: { platformConfig: { upsert: mocks.upsert, findUnique: mocks.findUnique } },
}));

import {
  getDeferredUpgradeRequest,
  isDeferredRequestPending,
  recordDeferredUpgradeRequest,
} from "./deferred-request";

const REQUEST = {
  requestedBy: "mcp:codex",
  requestedAt: "2026-10-07T15:20:00.000Z",
  runAt: "2026-10-07T22:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isDeferredRequestPending", () => {
  it("is pending until a check runs at or after the request", () => {
    expect(isDeferredRequestPending(REQUEST, null)).toBe(true);
    expect(isDeferredRequestPending(REQUEST, new Date("2026-10-07T10:00:00.000Z"))).toBe(true);
    expect(isDeferredRequestPending(REQUEST, new Date("2026-10-07T22:00:00.000Z"))).toBe(false);
  });

  it("is not pending with no request or a malformed timestamp", () => {
    expect(isDeferredRequestPending(null, null)).toBe(false);
    expect(isDeferredRequestPending({ ...REQUEST, requestedAt: "not-a-date" }, null)).toBe(false);
  });
});

describe("deferred request persistence", () => {
  it("records the request in PlatformConfig", async () => {
    await recordDeferredUpgradeRequest(REQUEST);
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { key: "self_upgrade.deferredRequest" },
      update: { value: REQUEST },
      create: { key: "self_upgrade.deferredRequest", value: REQUEST },
    });
  });

  it("reads it back, and fails open to null", async () => {
    mocks.findUnique.mockResolvedValueOnce({ value: REQUEST });
    expect(await getDeferredUpgradeRequest()).toEqual(REQUEST);

    mocks.findUnique.mockResolvedValueOnce({ value: { requestedBy: 7 } });
    expect(await getDeferredUpgradeRequest()).toBeNull();

    mocks.findUnique.mockRejectedValueOnce(new Error("db down"));
    expect(await getDeferredUpgradeRequest()).toBeNull();
  });
});
