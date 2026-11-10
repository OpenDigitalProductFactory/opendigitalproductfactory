import { describe, expect, it } from "vitest";
import { NATIVE_INTEGRATIONS } from "./native-integration-catalog";
import {
  EMPLOYEE_WORK_ROLE_LABELS,
  INTEGRATION_COVERAGE_MATRIX,
  getBenchmarkCoverageRows,
  getCoverageRowsByNativeIntegrationId,
} from "./integration-coverage-matrix";

describe("integration coverage matrix", () => {
  it("maps every native integration to employee work, taxonomy, posture, and next backlog evidence", () => {
    for (const integration of NATIVE_INTEGRATIONS) {
      const rows = getCoverageRowsByNativeIntegrationId(integration.id);

      expect(rows, `expected coverage row for ${integration.id}`).not.toHaveLength(0);

      for (const row of rows) {
        expect(row.kind).toBe("native");
        expect(row.employeeRoles.length).toBeGreaterThan(0);
        expect(row.employeeRoles.every((role) => EMPLOYEE_WORK_ROLE_LABELS[role])).toBe(true);
        expect(row.taxonomyNodeIds.length).toBeGreaterThan(0);
        expect(row.taxonomyNodeIds.every((nodeId) => nodeId.startsWith("for_employees/"))).toBe(true);
        expect(row.dpfSurfaces.length).toBeGreaterThan(0);
        expect(row.coworkerIds.length).toBeGreaterThan(0);
        expect(row.posture).toMatch(/^(native-dpf|integration-led|hybrid|provider-led|replacement-candidate)$/);
        expect(row.maturity).toMatch(/^(observe|read|stage|operate|write-back)$/);
        expect(row.csdmDomain).toMatch(
          /^(business-capability|business-service|application-service|technical-service|service-offering)$/,
        );
        expect(row.it4itValueStreams.length).toBeGreaterThan(0);
        // A declared next step states intent or names a filed item. It must NOT
        // be forced into id shape: the old /^BI-/ assertion is what pushed 25
        // rows into carrying identifiers nothing had filed (BI-5BF97BAA).
        expect(row.nextStep.kind).toMatch(/^(backlog-item|open)$/);
        if (row.nextStep.kind === "open") {
          expect(row.nextStep.intent.trim().length).toBeGreaterThan(0);
          expect(row.nextStep.intent).not.toMatch(/^BI-/);
        } else {
          expect(row.nextStep.itemId).toMatch(/^BI-[0-9A-F]{8}$/);
        }
      }
    }
  });

  it("keeps QuickBooks parity anchored to bookkeeper work and the long-tail backlog sequence", () => {
    const quickBooksRows = getCoverageRowsByNativeIntegrationId("quickbooks");

    expect(quickBooksRows).toHaveLength(1);
    expect(quickBooksRows[0]).toMatchObject({
      productName: "QuickBooks Online",
      maturity: "stage",
      posture: "hybrid",
    });
    expect(quickBooksRows[0]?.nextStep).toEqual({
      kind: "open",
      intent: "Entity links before write-back",
    });
    expect(quickBooksRows[0]?.employeeRoles).toContain("bookkeeper_accountant");
    expect(quickBooksRows[0]?.taxonomyNodeIds).toContain("for_employees/financial_management");
    expect(quickBooksRows[0]?.replacementCriteria).toContain("system-of-record promotion");
  });

  it("includes benchmark-only adjacent products without treating them as native connectors", () => {
    const benchmarkRows = getBenchmarkCoverageRows();
    const benchmarkProducts = benchmarkRows.map((row) => row.productName);

    expect(benchmarkProducts).toEqual(
      expect.arrayContaining([
        "Xero",
        "Gusto",
        "Salesforce",
        "Slack",
        "Zendesk",
        "Shopify",
        "ServiceNow",
        "Jira Service Management",
        "Microsoft Intune",
      ]),
    );
    expect(benchmarkRows.every((row) => row.kind === "benchmark")).toBe(true);
    expect(benchmarkRows.every((row) => row.nativeIntegrationId === undefined)).toBe(true);
  });

  it("uses CSDM and IT4IT only as structural projection fields", () => {
    expect(INTEGRATION_COVERAGE_MATRIX.length).toBeGreaterThan(NATIVE_INTEGRATIONS.length);
    expect(INTEGRATION_COVERAGE_MATRIX.some((row) => row.csdmDomain === "service-offering")).toBe(true);
    expect(
      INTEGRATION_COVERAGE_MATRIX.some((row) => row.it4itValueStreams.includes("strategy-to-portfolio")),
    ).toBe(true);
    expect(
      INTEGRATION_COVERAGE_MATRIX.some((row) => row.it4itValueStreams.includes("request-to-fulfill")),
    ).toBe(true);
  });
});
