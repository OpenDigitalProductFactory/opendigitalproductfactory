import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    platformConfig: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import { getBuiltInToolsOverview } from "./built-in-tools";

describe("getBuiltInToolsOverview", () => {
  it("marks Brave Search as configured when the existing key is present", async () => {
    vi.mocked(prisma.platformConfig.findMany).mockResolvedValue([
      { key: "brave_search_api_key", value: "BSA-secret" },
    ] as never);

    const result = await getBuiltInToolsOverview();
    const braveSearch = result.tools.find((tool) => tool.id === "brave-search");

    expect(braveSearch?.configured).toBe(true);
    expect(result.keyData.brave_search_api_key.configured).toBe(true);
  });

  it("includes the built-in tool descriptors even when no key is configured", async () => {
    vi.mocked(prisma.platformConfig.findMany).mockResolvedValue([] as never);

    const result = await getBuiltInToolsOverview();

    expect(result.tools.map((tool) => tool.id)).toEqual([
      "brave-search",
      "public-web-fetch",
      "branding-analyzer",
    ]);
    expect(result.keyData.brave_search_api_key.configured).toBe(false);
  });
});
