import { describe, expect, it, vi } from "vitest";

import { runIndexIntegritySweep } from "./index-integrity-sweep";

function deps(overrides: Record<string, unknown> = {}) {
  return {
    connect: vi.fn(),
    end: vi.fn(),
    checkCollationStability: vi.fn().mockResolvedValue({ findings: [] }),
    checkIndexIntegrity: vi.fn().mockResolvedValue({ indexesChecked: 12, corrupted: [], failed: false }),
    createPlatformIssueReport: vi.fn(),
    ...overrides,
  };
}

describe("runIndexIntegritySweep", () => {
  it("checks the live client and stays quiet when indexes are healthy", async () => {
    const d = deps();
    await expect(runIndexIntegritySweep(d as never)).resolves.toMatchObject({ failed: false, indexesChecked: 12 });
    expect(d.checkIndexIntegrity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ amcheckMode: "provision" }));
    expect(d.createPlatformIssueReport).not.toHaveBeenCalled();
    expect(d.end).toHaveBeenCalled();
  });

  it("raises one deduplicated platform issue for corruption", async () => {
    const d = deps({
      checkIndexIntegrity: vi.fn().mockResolvedValue({
        indexesChecked: 12,
        failed: true,
        corrupted: [{ table: "Agent", index: "Agent_agentId_key", isUnique: true, error: "heap tuple missing" }],
      }),
    });

    await expect(runIndexIntegritySweep(d as never)).resolves.toMatchObject({ failed: true, issueRaised: true });
    expect(d.createPlatformIssueReport).toHaveBeenCalledWith(expect.objectContaining({
      type: "index-integrity-drift",
      dedupeKey: "index-integrity-sweep:live-database",
      severity: "critical",
    }));
  });
});
