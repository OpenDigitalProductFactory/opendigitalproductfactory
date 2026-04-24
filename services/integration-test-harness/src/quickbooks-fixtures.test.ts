import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { requiredScenarios, routes } from "../vendors/quickbooks/routes.js";

const vendorDir = join(import.meta.dirname, "..", "vendors", "quickbooks");

describe("quickbooks vendor fixtures", () => {
  it("includes the required scenario files", () => {
    for (const scenario of requiredScenarios) {
      const scenarioPath = join(vendorDir, "scenarios", `${scenario}.json`);
      expect(() => JSON.parse(readFileSync(scenarioPath, "utf8"))).not.toThrow();
    }
  });

  it("ships an authored parseable QuickBooks harness contract", () => {
    const openapiText = readFileSync(join(vendorDir, "openapi.yaml"), "utf8");

    expect(openapiText).toContain("openapi: 3.0.3");
    expect(openapiText).toContain("/oauth2/v1/tokens/bearer");
    expect(openapiText).toContain("/v3/company/{realmId}/companyinfo/{realmId}");
    expect(openapiText).toContain("/v3/company/{realmId}/customer/{customerId}");
    expect(openapiText).toContain("/v3/company/{realmId}/invoice/{invoiceId}");
  });

  it("maps route definitions for the OAuth and read-first accounting endpoints", () => {
    expect(routes).toEqual([
      { key: "token", method: "POST", path: "/oauth2/v1/tokens/bearer" },
      {
        key: "companyInfo",
        method: "GET",
        path: "/v3/company/{realmId}/companyinfo/{realmId}",
      },
      {
        key: "customer",
        method: "GET",
        path: "/v3/company/{realmId}/customer/{customerId}",
      },
      {
        key: "invoice",
        method: "GET",
        path: "/v3/company/{realmId}/invoice/{invoiceId}",
      },
    ]);
  });

  it("includes explicit jailbreak content in the adversarial scenario", () => {
    const scenario = JSON.parse(
      readFileSync(join(vendorDir, "scenarios", "jailbreak-content.json"), "utf8"),
    ) as {
      invoice: { body: { Invoice: { PrivateNote?: string } } };
    };

    expect((scenario.invoice.body.Invoice.PrivateNote ?? "").toLowerCase()).toContain(
      "ignore previous instructions",
    );
  });
});
