import { describe, expect, it } from "vitest";
import { Prisma } from "../generated/client/client";

describe("discovery fingerprint Prisma models", () => {
  it("exposes fingerprint contribution pipeline models", () => {
    expect(Prisma.ModelName.DiscoveryFingerprintObservation).toBe("DiscoveryFingerprintObservation");
    expect(Prisma.ModelName.DiscoveryFingerprintReview).toBe("DiscoveryFingerprintReview");
    expect(Prisma.ModelName.DiscoveryFingerprintRule).toBe("DiscoveryFingerprintRule");
    expect(Prisma.ModelName.DiscoveryFingerprintCatalogVersion).toBe("DiscoveryFingerprintCatalogVersion");
  });
});
