import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/routing/local-provider-capacity", () => ({
  assertLocalProviderCapacityAvailable: vi.fn(),
}));

import { assertLocalProviderCapacityAvailable } from "@/lib/routing/local-provider-capacity";
import { generateEmbedding } from "./embedding";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertLocalProviderCapacityAvailable).mockResolvedValue(undefined);
});

describe("generateEmbedding local-CI arbitration", () => {
  it("does not contact the local embedding provider while local CI owns capacity", async () => {
    vi.mocked(assertLocalProviderCapacityAvailable).mockRejectedValue(
      new Error("local-ci-active-capacity-reservation"),
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(generateEmbedding("durable knowledge")).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("dispatches normally when local capacity is available", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(generateEmbedding("durable knowledge")).resolves.toEqual([0.1, 0.2]);
    expect(assertLocalProviderCapacityAvailable).toHaveBeenCalledOnce();
  });
});
