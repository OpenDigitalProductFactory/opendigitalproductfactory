import { describe, expect, it } from "vitest";

import { allFunctions } from "./index";
import {
  PORTAL_SELF_UPGRADE_COMPLETION_CRON,
  PORTAL_SELF_UPGRADE_CRON,
  PORTAL_SELF_UPGRADE_EVENT,
  portalSelfUpgradeCompletionSweep,
  portalSelfUpgradeRequested,
  portalSelfUpgradeScheduled,
} from "./portal-self-upgrade";

describe("portal self-upgrade queue functions", () => {
  it("uses stable cron and event contracts", () => {
    expect(PORTAL_SELF_UPGRADE_CRON).toBe("0 8 * * *");
    expect(PORTAL_SELF_UPGRADE_COMPLETION_CRON).toBe("*/15 * * * *");
    expect(PORTAL_SELF_UPGRADE_EVENT).toBe("portal/self-upgrade.requested");
  });

  it("registers scheduled, manual, and completion sweep functions", () => {
    expect(allFunctions).toContain(portalSelfUpgradeScheduled);
    expect(allFunctions).toContain(portalSelfUpgradeRequested);
    expect(allFunctions).toContain(portalSelfUpgradeCompletionSweep);
  });
});
