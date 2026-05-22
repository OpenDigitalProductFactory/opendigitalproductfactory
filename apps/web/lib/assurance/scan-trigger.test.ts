import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queue/inngest-client", () => ({
  inngest: { send: vi.fn() },
}));

import { inngest } from "@/lib/queue/inngest-client";
import { queueBuildAssuranceScan } from "./scan-trigger";

describe("queueBuildAssuranceScan", () => {
  it("queues the assurance scan event", async () => {
    vi.mocked(inngest.send).mockResolvedValue({ ids: ["evt-1"] } as never);

    await queueBuildAssuranceScan({ buildId: "BUILD-1", requestedByUserId: "user-1" });

    expect(inngest.send).toHaveBeenCalledWith({
      name: "assurance/scan.run",
      data: { buildId: "BUILD-1", requestedByUserId: "user-1" },
    });
  });
});
