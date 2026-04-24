import { describe, expect, it } from "vitest";

import { prisma } from "./client";
import { Prisma } from "../generated/client/client";

describe("principal spine Prisma client", () => {
  it("exposes principal delegates and model names", () => {
    expect(Prisma.ModelName.Principal).toBe("Principal");
    expect(Prisma.ModelName.PrincipalAlias).toBe("PrincipalAlias");
    expect(prisma.principal).toBeDefined();
    expect(prisma.principalAlias).toBeDefined();
  });
});
