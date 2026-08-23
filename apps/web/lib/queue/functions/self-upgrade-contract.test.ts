import { describe, expect, it } from "vitest";
import {
  SELF_UPGRADE_CRON,
  SELF_UPGRADE_EVENT,
  SELF_UPGRADE_FUNCTION_ID_MANUAL,
  SELF_UPGRADE_FUNCTION_ID_SCHEDULED,
  type SelfUpgradeRunEventData,
} from "./self-upgrade-contract";

describe("self-upgrade event contract", () => {
  it("keeps stable function, event, and cron identifiers", () => {
    expect(SELF_UPGRADE_FUNCTION_ID_SCHEDULED).toBe("ops/self-upgrade-scheduled");
    expect(SELF_UPGRADE_FUNCTION_ID_MANUAL).toBe("ops/self-upgrade-manual");
    expect(SELF_UPGRADE_EVENT).toBe("ops/self-upgrade.run");
    expect(SELF_UPGRADE_CRON).toBe("0 * * * *");
  });

  it("accepts the optional manual and routine fields", () => {
    const payload: SelfUpgradeRunEventData = {
      triggeredBy: "user-abc",
      dryRun: true,
      buildId: "FB-TESTBUILD",
      force: true,
      budgetMs: 600_000,
      routine: true,
    };
    expect(payload).toMatchObject({ triggeredBy: "user-abc", routine: true });
    expect({} satisfies SelfUpgradeRunEventData).toEqual({});
  });
});
