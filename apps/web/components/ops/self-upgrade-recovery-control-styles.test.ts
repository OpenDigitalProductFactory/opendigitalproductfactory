import { describe, expect, it } from "vitest";

import {
  RECOVERY_ACTION_CLASS,
  RECOVERY_CONFIRMATION_CLASS,
} from "./self-upgrade-recovery-control-styles";

describe("Self-Upgrade recovery control styles", () => {
  it.each([
    ["confirmation input", RECOVERY_CONFIRMATION_CLASS],
    ["recovery action", RECOVERY_ACTION_CLASS],
  ])("keeps the %s at the 44px touch-target floor", (_label, className) => {
    expect(className.split(/\s+/)).toContain("min-h-11");
  });
});
