import { describe, expect, it } from "vitest";

import { prisma } from "./client";
import { Prisma } from "../generated/client/client";

describe("authority binding Prisma client", () => {
  it("exposes authority binding delegates and model names", () => {
    expect(Prisma.ModelName.AuthorityBinding).toBe("AuthorityBinding");
    expect(Prisma.ModelName.AuthorityBindingSubject).toBe("AuthorityBindingSubject");
    expect(Prisma.ModelName.AuthorityBindingGrant).toBe("AuthorityBindingGrant");
    expect(prisma.authorityBinding).toBeDefined();
    expect(prisma.authorityBindingSubject).toBeDefined();
    expect(prisma.authorityBindingGrant).toBeDefined();
  });

  it("extends authorization decision log shape with authorityBindingId", () => {
    const where: Prisma.AuthorizationDecisionLogWhereInput = {
      authorityBindingId: "cuid_binding",
    };

    expect(where.authorityBindingId).toBe("cuid_binding");
  });
});
