import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/jobs", () => ({
  jobs: { send: vi.fn() },
}));

import { jobs } from "@/lib/jobs";
import { queueBuildAssuranceScan } from "./scan-trigger";

describe("queueBuildAssuranceScan", () => {
  it("queues the assurance scan event", async () => {
    vi.mocked(jobs.send).mockResolvedValue({ ids: ["evt-1"] } as never);

    await queueBuildAssuranceScan({ buildId: "BUILD-1", requestedByUserId: "user-1" });

    expect(jobs.send).toHaveBeenCalledWith({
      name: "assurance/scan.run",
      data: { buildId: "BUILD-1", requestedByUserId: "user-1" },
    });
  });
});
