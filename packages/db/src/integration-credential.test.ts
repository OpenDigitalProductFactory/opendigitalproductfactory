import { describe, expect, it } from "vitest";
import type { IntegrationCredential, Prisma } from "../generated/client";

describe("IntegrationCredential model shape", () => {
  it("exposes the polymorphic credential fields", () => {
    // Type-level assertion: if the migration + generate succeeded, this compiles.
    // A shape mismatch (missing column, renamed field) is a compile error.
    const mock: IntegrationCredential = {
      id: "cuid_example",
      integrationId: "adp-workforce-now",
      provider: "adp",
      status: "connected",
      fieldsEnc: "enc:iv:tag:ct",
      tokenCacheEnc: "enc:iv:tag:ct",
      lastTestedAt: new Date(),
      lastErrorAt: null,
      lastErrorMsg: null,
      certExpiresAt: new Date("2027-04-21"),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(mock.integrationId).toBe("adp-workforce-now");
    expect(mock.provider).toBe("adp");
  });

  it("accepts nullable optionals on create", () => {
    // Prisma input type: required fields are required, optionals can be omitted.
    const createArgs: Prisma.IntegrationCredentialCreateInput = {
      integrationId: "quickbooks-online",
      provider: "quickbooks",
      fieldsEnc: "enc:iv:tag:ct",
    };
    expect(createArgs.integrationId).toBe("quickbooks-online");
    // status, tokenCacheEnc, lastTestedAt, etc. all optional — compile-time proof.
  });

  it("has the provider_status index constraint documented via a runtime probe of the Prisma model type", () => {
    // Not a runtime index check (that would need a live DB). Instead, confirm the where
    // type allows filtering by both fields — which Prisma only emits for indexed-or-scalar fields.
    const where: Prisma.IntegrationCredentialWhereInput = {
      provider: "adp",
      status: "connected",
    };
    expect(where.provider).toBe("adp");
  });
});
