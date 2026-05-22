import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queue/inngest-client", () => ({
  inngest: { send: vi.fn() },
}));

import { inngest } from "@/lib/queue/inngest-client";
import { queueBuildBomGeneration } from "./bom-trigger";

describe("queueBuildBomGeneration", () => {
  it("queues the assurance BOM generation event", async () => {
    vi.mocked(inngest.send).mockResolvedValue({ ids: ["evt-1"] } as never);

    await queueBuildBomGeneration({ buildId: "BUILD-1", requestedByUserId: "user-1" });

    expect(inngest.send).toHaveBeenCalledWith({
      name: "assurance/bom.generate",
      data: { buildId: "BUILD-1", requestedByUserId: "user-1" },
    });
  });
});
