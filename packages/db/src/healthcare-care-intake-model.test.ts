import { describe, expect, it } from "vitest";

import { Prisma } from "../generated/client/client";
import { prisma } from "./client";

describe("healthcare care intake Prisma substrate", () => {
  it("exposes tenant-safe intake authority and evidence streams", () => {
    expect(Prisma.ModelName.CareIntakePacket).toBe("CareIntakePacket");
    expect(Prisma.ModelName.CareIntakeResponse).toBe("CareIntakeResponse");
    expect(Prisma.ModelName.CareIntakeAccessGrant).toBe(
      "CareIntakeAccessGrant",
    );
    expect(Prisma.ModelName.CareConsentAttestation).toBe(
      "CareConsentAttestation",
    );
    expect(Prisma.ModelName.CareCoverageEvidence).toBe(
      "CareCoverageEvidence",
    );
    expect(Prisma.ModelName.CareIntakeException).toBe("CareIntakeException");
    expect(Prisma.ModelName.CareIntakeStatusEvent).toBe(
      "CareIntakeStatusEvent",
    );
    expect(prisma.careIntakePacket).toBeDefined();
    expect(prisma.careIntakeStatusEvent).toBeDefined();
  });
});
