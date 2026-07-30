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
        new Set(["view_admin"]),
      ),
    ).toEqual({
      href: "/admin/scheduled-jobs#scheduled-job-coworker-certification",
      label: "Review certification",
      requiredCapability: "view_admin",
    });
  });

  it("hides admin-owned recovery from workforce-only roles", () => {
    expect(
      availabilityRecoveryTarget(
        blockedAvailability({
          kind: "lifecycle",
          label: "Review certification",
        }),
        "/platform/ai/agent/marketing-specialist",
        new Set(["view_platform"]),
      ),
    ).toBeNull();
  });

  it("applies target capability checks generically", () => {
    const availability = blockedAvailability({
      kind: "capability-needs",
      label: "Review capability needs",
    });

    expect(
      availabilityRecoveryTarget(
        availability,
        "/platform/ai/agent/marketing-specialist",
        new Set(["view_platform"]),
      ),
    ).toBeNull();
    expect(
      availabilityRecoveryTarget(
        availability,
        "/platform/ai/agent/marketing-specialist",
        new Set(["view_operations"]),
      ),
    ).toEqual({
      href: "/ops?origin=capability-need",
      label: "Review capability needs",
      requiredCapability: "view_operations",
    });
  });

  it("requires repair authority before offering capability setup", () => {
    const availability = blockedAvailability({
      kind: "capabilities",
      label: "Review capabilities",
    });

    expect(
      availabilityRecoveryTarget(
        availability,
        "/platform/ai/agent/marketing-specialist",
        new Set(["view_platform"]),
      ),
    ).toBeNull();
    expect(
      availabilityRecoveryTarget(
        availability,
        "/platform/ai/agent/marketing-specialist",
        new Set(["view_platform", "manage_platform"]),
      ),
    ).toEqual({
      href: "/platform/ai/agent/marketing-specialist#capabilities",
      label: "Review capabilities",
      requiredCapability: "manage_platform",
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
