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

  it("marks core accounting families as import-ready when connected and staging is defined", () => {
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
        .filter((capability) => capability.state === "import-ready")
        .map((capability) => capability.key),
    ).toEqual([
      "company",
      "customers",
      "invoices",
      "vendors",
      "bills",
      "expenses",
      "payments",
      "accounts",
      "reports",
    ]);
    expect(descriptor.importStaging?.readOnly).toBe(true);
    expect(descriptor.importStaging?.families.map((family) => family.key)).toEqual([
      "company",
      "customers",
      "invoices",
      "vendors",
      "bills",
      "expenses",
      "payments",
      "accounts",
      "reports",
    ]);
    expect(
      descriptor.importStaging?.families.every((family) => family.ownerSide === "external"),
    ).toBe(true);
    expect(descriptor.importReview).toMatchObject({
      status: "ready-to-review",
      nextStep: { kind: "open", intent: "Entity links and review queue" },
      readOnly: true,
      sourceProvider: "quickbooks",
    });
    expect(descriptor.importReview?.families).toEqual([
      "company",
      "customers",
      "invoices",
      "vendors",
      "bills",
      "expenses",
      "payments",
      "accounts",
      "reports",
    ]);
    expect(
      descriptor.capabilities.find((capability) => capability.key === "expenses")?.apiCoverageNote,
    ).toContain("Purchase");
    expect(
      descriptor.capabilities.find((capability) => capability.key === "bank_transactions")?.state,
    ).toBe("not-mapped");
    expect(descriptor.capabilities.find((capability) => capability.key === "tax")?.state).toBe(
      "not-mapped",
    );
    expect(descriptor.nextSafeActions).toContain(
      "Use expanded QuickBooks read coverage to plan source-attributed staging before imports or writes",
    );
    expect(descriptor.nextSafeActions).toContain(
      "Review non-editable import staging fields before creating local accounting links",
    );
    expect(descriptor.nextSafeActions).toContain(
      "Persist reviewed import candidates before reconciliation",
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
