import { describe, expect, it, vi } from "vitest";

import { runSelfUpgradeCycle } from "./index";

describe("runSelfUpgradeCycle", () => {
  it("skips when disabled", async () => {
    const deps = {
      loadConfig: vi.fn().mockResolvedValue({ enabled: false }),
      getVersionState: vi.fn(),
      createRun: vi.fn(),
      markRunSkipped: vi.fn(),
      startPromoter: vi.fn(),
      notify: vi.fn(),
    };

    const result = await runSelfUpgradeCycle({ trigger: "scheduled" }, deps);

    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("disabled");
    expect(deps.getVersionState).not.toHaveBeenCalled();
  });

  it("starts a promoter run when the portal is behind origin/main", async () => {
    const deps = {
      loadConfig: vi.fn().mockResolvedValue({ enabled: true }),
      getVersionState: vi.fn().mockResolvedValue({
        currentSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        targetSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        comparable: true,
        upToDate: false,
        reason: "behind-target",
      }),
      createRun: vi.fn().mockResolvedValue({ runId: "SUR-123" }),
      markRunSkipped: vi.fn(),
      markRunStarted: vi.fn(),
      startPromoter: vi.fn().mockResolvedValue({ containerName: "dpf-promoter-self-upgrade-SUR-123" }),
      notify: vi.fn(),
    };

    const result = await runSelfUpgradeCycle({ trigger: "manual" }, deps);

    expect(result.status).toBe("started");
    expect(result.runId).toBe("SUR-123");
    expect(deps.startPromoter).toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({ type: "started" }));
  });
});
