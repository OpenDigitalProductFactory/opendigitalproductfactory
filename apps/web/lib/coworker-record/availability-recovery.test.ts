import { describe, expect, it } from "vitest";

import type {
  CoworkerAvailabilityProjection,
  CoworkerAvailabilityRecovery,
} from "@/lib/coworker-service-catalog/availability-projection";
import { availabilityRecoveryTarget } from "./availability-recovery";

function blockedAvailability(
  recovery: CoworkerAvailabilityRecovery,
): CoworkerAvailabilityProjection {
  return {
    state: "needs-attention",
    label: "Needs attention",
    reason: "The coworker cannot start this work yet.",
    matchLevel: "category",
    evidence: [],
    recovery,
  };
}

describe("availabilityRecoveryTarget", () => {
  it("lands lifecycle recovery on the runnable certification job", () => {
    expect(
      availabilityRecoveryTarget(
        blockedAvailability({
          kind: "lifecycle",
          label: "Review certification",
        }),
        "/platform/ai/agent/marketing-specialist",
      ),
    ).toEqual({
      href: "/admin/scheduled-jobs#scheduled-job-coworker-certification",
      label: "Review certification",
    });
  });

  it("does not offer a misleading action for platform-managed catalog defects", () => {
    expect(
      availabilityRecoveryTarget(
        blockedAvailability({
          kind: "catalog",
          label: "Platform update required",
        }),
        "/platform/ai/agent/marketing-specialist",
      ),
    ).toBeNull();
  });
});
