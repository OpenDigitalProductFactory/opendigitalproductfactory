import { describe, it, expect } from "vitest";
import { allFunctions } from "@/lib/queue/functions";
import { runSelfUpgradeCycle } from "@/lib/self-upgrade";
import { completePendingSelfUpgradeRuns } from "@/lib/self-upgrade/completion";

describe("self-upgrade substrate audit (Phase 0 baseline)", () => {
  it("currently registers BOTH legacy and new Inngest families", () => {
    const ids = allFunctions.map((fn) => (fn as { id: () => string }).id());
    // Legacy family — will be removed in Task 4
    expect(ids).toContain("portal/self-upgrade-scheduled");
    expect(ids).toContain("portal/self-upgrade-requested");
    expect(ids).toContain("portal/self-upgrade-completion-sweep");
    // Newer family — will be the survivor
    expect(ids).toContain("ops/self-upgrade-scheduled");
    expect(ids).toContain("ops/self-upgrade-manual");
  });

  it("legacy runSelfUpgradeCycle is a no-op stub", async () => {
    const result = await runSelfUpgradeCycle({ trigger: "scheduled" });
    expect(result).toEqual({ status: "skipped", reason: "use-inngest-function" });
  });

  it("legacy completePendingSelfUpgradeRuns is a no-op stub", async () => {
    const result = await completePendingSelfUpgradeRuns();
    expect(result).toEqual({ processedRunIds: [] });
  });
});
