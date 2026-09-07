import { beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("@/lib/network/off-threadpool-fetch", () => ({
  createOffThreadpoolFetchTransport: transport.create,
}));

import { readRegistryReleaseCandidate } from "./registry-release";

describe("registry release transport", () => {
  beforeEach(() => {
    transport.create.mockReset();
  });

  it("uses a fresh off-threadpool transport for each bounded production attempt", async () => {
    const closes: Array<ReturnType<typeof vi.fn>> = [];
    transport.create.mockImplementation(() => {
      const close = vi.fn().mockResolvedValue(undefined);
      closes.push(close);
      return {
        fetch: vi.fn().mockRejectedValue(new Error("fetch failed")),
        close,
      };
    });

    await expect(readRegistryReleaseCandidate({
      owner: "opendigitalproductfactory",
      repository: "dpf-portal",
      channelTag: "latest",
    })).resolves.toEqual({
      ok: false,
      reason: "registry-unavailable",
    });

    expect(transport.create).toHaveBeenCalledTimes(2);
    expect(closes).toHaveLength(2);
    expect(closes.every((close) => close.mock.calls.length === 1)).toBe(true);
  });
});
