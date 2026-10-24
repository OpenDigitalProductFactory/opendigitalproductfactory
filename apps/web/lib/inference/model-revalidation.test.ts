import { beforeEach, describe, expect, it, vi } from "vitest";

const findProviders = vi.hoisted(() => vi.fn());
const autoDiscover = vi.hoisted(() => vi.fn());

vi.mock("@dpf/db", () => ({ prisma: { modelProvider: { findMany: findProviders } } }));
vi.mock("./ai-provider-internals", () => ({ autoDiscoverAndProfile: autoDiscover }));
vi.mock("@/lib/routing/provider-eligibility", () => ({ canRunStartupModelDiscovery: () => true }));

import { runModelRevalidation } from "./model-revalidation";

function pool() {
  const client = {
    query: vi.fn()
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({ rows: [] }),
    release: vi.fn(),
  };
  return { connect: vi.fn().mockResolvedValue(client) } as never;
}

describe("runModelRevalidation", () => {
  beforeEach(() => {
    findProviders.mockReset();
    autoDiscover.mockReset();
    findProviders.mockResolvedValue([
      { providerId: "codex" },
      { providerId: "openai" },
    ]);
  });

  it("retains resolved provider errors instead of reporting the run as successful", async () => {
    autoDiscover
      .mockResolvedValueOnce({ discovered: 0, profiled: 0, error: "app-server unavailable" })
      .mockResolvedValueOnce({ discovered: 4, profiled: 4 });

    const result = await runModelRevalidation({ source: "scheduled" }, pool());

    expect(result).toEqual({
      acquired: true,
      outcomes: [
        { providerId: "codex", status: "failed", error: "app-server unavailable" },
        { providerId: "openai", status: "ok", discovered: 4, profiled: 4 },
      ],
    });
  });
});
