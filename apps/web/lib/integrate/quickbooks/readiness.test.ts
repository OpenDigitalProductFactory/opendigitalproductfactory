import { describe, expect, it } from "vitest";
import { buildQuickBooksReadinessDescriptor } from "./readiness";

describe("buildQuickBooksReadinessDescriptor", () => {
  it("marks all capabilities not connected when no credential exists", () => {
    const descriptor = buildQuickBooksReadinessDescriptor({ connection: null });

    expect(descriptor.schemaVersion).toBe("1.0");
    expect(descriptor.health.credentialStatus).toBe("not-connected");
    expect(descriptor.capabilities.every((capability) => capability.state === "not-connected")).toBe(
      true,
    );
    expect(descriptor.nextSafeActions).toContain("Connect QuickBooks credentials");
  });

  it("marks company customers and invoices as read when connected", () => {
    const descriptor = buildQuickBooksReadinessDescriptor({
      connection: {
        status: "connected",
        companyName: "Acme Services LLC",
        realmId: "9130355377388383",
        lastErrorMsg: null,
        lastTestedAt: "2026-04-24T05:00:00.000Z",
        environment: "sandbox",
      },
    });

    expect(descriptor.health.credentialStatus).toBe("connected");
    expect(descriptor.entityContext.companyName).toBe("Acme Services LLC");
    expect(
      descriptor.capabilities
        .filter((capability) => capability.state === "read")
        .map((capability) => capability.key),
    ).toEqual(["company", "customers", "invoices"]);
    expect(descriptor.capabilities.find((capability) => capability.key === "vendors")?.state).toBe(
      "not-mapped",
    );
  });

  it("surfaces credential errors without exposing secrets", () => {
    const descriptor = buildQuickBooksReadinessDescriptor({
      connection: {
        status: "error",
        companyName: null,
        realmId: "9130355377388383",
        lastErrorMsg: "invalid QuickBooks credentials",
        lastTestedAt: "2026-04-24T05:00:00.000Z",
        environment: "production",
      },
    });

    expect(descriptor.health.credentialStatus).toBe("error");
    expect(descriptor.health.lastProbeErrorCategory).toBe("invalid QuickBooks credentials");
    expect(JSON.stringify(descriptor)).not.toContain("clientSecret");
    expect(JSON.stringify(descriptor)).not.toContain("refreshToken");
  });
});
