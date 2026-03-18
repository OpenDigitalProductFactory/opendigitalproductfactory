import { describe, expect, it } from "vitest";
import { prisma } from "./client";

describe("discovery attribution Prisma client", () => {
  it("exposes software normalization delegates", () => {
    expect(prisma.discoveredSoftwareEvidence).toBeDefined();
    expect(prisma.softwareIdentity).toBeDefined();
    expect(prisma.softwareNormalizationRule).toBeDefined();
  });
});
