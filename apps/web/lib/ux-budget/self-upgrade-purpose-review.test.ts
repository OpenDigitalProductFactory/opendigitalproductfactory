import { describe, expect, it } from "vitest";

import { resolveSelfUpgradePurposeScenario } from "@/lib/self-upgrade/purpose-scenario";
import { resolveSelfUpgradePurposeOracle } from "@/lib/ux-budget/oracles/self-upgrade";
import {
  buildSelfUpgradePurposeReviewStatus,
  SELF_UPGRADE_PURPOSE_STATES,
} from "./self-upgrade-purpose-review";

describe("Self-Upgrade purpose review fixtures", () => {
  it.each(SELF_UPGRADE_PURPOSE_STATES)(
    "projects %s through both independent state resolvers",
    (state) => {
      const status = buildSelfUpgradePurposeReviewStatus(state);

      expect(resolveSelfUpgradePurposeScenario(status)).toBe(state);
      expect(resolveSelfUpgradePurposeOracle(status)).toBe(state);
    },
  );
});
