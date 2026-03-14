import { describe, expect, it } from "vitest";
import { Prisma } from "../generated/client";

describe("bootstrap discovery Prisma model names", () => {
  it("exposes the new discovery model delegates", () => {
    expect(Prisma.ModelName.DiscoveryRun).toBe("DiscoveryRun");
    expect(Prisma.ModelName.InventoryEntity).toBe("InventoryEntity");
    expect(Prisma.ModelName.PortfolioQualityIssue).toBe("PortfolioQualityIssue");
  });
});
