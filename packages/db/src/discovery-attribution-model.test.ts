import { describe, expect, it } from "vitest";
import { prisma } from "./client";

describe("discovery attribution Prisma client", () => {
  it("exposes discovery model delegates", () => {
    expect(prisma.discoveredModel).toBeDefined();
    expect(prisma.discoveredItem).toBeDefined();
    expect(prisma.discoveredRelationship).toBeDefined();
  });
});
