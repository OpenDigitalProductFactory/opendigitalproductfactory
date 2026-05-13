import { describe, expect, it } from "vitest";
import { Prisma } from "../generated/client/client";

describe("document management Prisma models", () => {
  it("exposes the managed document store models", () => {
    expect(Prisma.ModelName.Document).toBe("Document");
    expect(Prisma.ModelName.DocumentVersion).toBe("DocumentVersion");
    expect(Prisma.ModelName.DocumentBlob).toBe("DocumentBlob");
    expect(Prisma.ModelName.DocumentReference).toBe("DocumentReference");
    expect(Prisma.ModelName.DocumentTag).toBe("DocumentTag");
    expect(Prisma.ModelName.DocumentAccessGrant).toBe("DocumentAccessGrant");
    expect(Prisma.ModelName.DocumentLifecycleEvent).toBe("DocumentLifecycleEvent");
    expect(Prisma.ModelName.DocumentRendition).toBe("DocumentRendition");
  });
});
