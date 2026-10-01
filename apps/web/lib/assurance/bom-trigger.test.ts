import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/jobs", () => ({
  jobs: { send: vi.fn() },
}));

import { jobs } from "@/lib/jobs";
import { queueBuildBomGeneration } from "./bom-trigger";

describe("queueBuildBomGeneration", () => {
  it("queues the assurance BOM generation event", async () => {
    vi.mocked(jobs.send).mockResolvedValue({ ids: ["evt-1"] } as never);

    await queueBuildBomGeneration({ buildId: "BUILD-1", requestedByUserId: "user-1" });

    expect(jobs.send).toHaveBeenCalledWith({
      name: "assurance/bom.generate",
      data: { buildId: "BUILD-1", requestedByUserId: "user-1" },
    });
  });
});
