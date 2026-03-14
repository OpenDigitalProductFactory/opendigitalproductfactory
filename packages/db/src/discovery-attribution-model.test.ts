import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/client";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe("discovery attribution Prisma client", () => {
  it("exposes software normalization delegates", () => {
    expect(prisma.discoveredSoftwareEvidence).toBeDefined();
    expect(prisma.softwareIdentity).toBeDefined();
    expect(prisma.softwareNormalizationRule).toBeDefined();
  });
});
