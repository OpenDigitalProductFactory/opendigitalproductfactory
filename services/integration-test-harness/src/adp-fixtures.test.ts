import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { requiredScenarios, routes } from "../vendors/adp/routes.js";

const vendorDir = join(import.meta.dirname, "..", "vendors", "adp");

describe("adp vendor fixtures", () => {
  it("includes the required scenario files", () => {
    for (const scenario of requiredScenarios) {
      const scenarioPath = join(vendorDir, "scenarios", `${scenario}.json`);
      expect(() => JSON.parse(readFileSync(scenarioPath, "utf8"))).not.toThrow();
    }
  });

  it("ships an initial parseable openapi contract", () => {
    const openapiText = readFileSync(join(vendorDir, "openapi.yaml"), "utf8");

    expect(openapiText).toContain("openapi: 3.0.3");
    expect(openapiText).toContain("/oauth/token");
    expect(openapiText).toContain("/hr/v2/workers");
    expect(openapiText).toContain("/payroll/v1/workers/{workerId}/pay-statements");
    expect(openapiText).toContain("/time/v2/workers/{workerId}/time-cards");
    expect(openapiText).toContain("/payroll/v1/workers/{workerId}/deductions");
  });

  it("maps route definitions for token and read endpoints", () => {
    expect(routes).toEqual([
      { key: "token", method: "POST", path: "/oauth/token" },
      { key: "workers", method: "GET", path: "/hr/v2/workers" },
      {
        key: "payStatements",
        method: "GET",
        path: "/payroll/v1/workers/{workerId}/pay-statements",
      },
      {
        key: "timeCards",
        method: "GET",
        path: "/time/v2/workers/{workerId}/time-cards",
      },
      {
        key: "deductions",
        method: "GET",
        path: "/payroll/v1/workers/{workerId}/deductions",
      },
    ]);
  });

  it("includes explicit jailbreak content in the adversarial scenario", () => {
    const scenario = JSON.parse(
      readFileSync(join(vendorDir, "scenarios", "jailbreak-content.json"), "utf8"),
    ) as {
      workers: { body: { workers: Array<{ workAssignments: Array<{ note?: string }> }> } };
    };

    expect(
      scenario.workers.body.workers.some((worker) =>
        worker.workAssignments.some((assignment) =>
          (assignment.note ?? "").toLowerCase().includes("ignore previous instructions"),
        ),
      ),
    ).toBe(true);
  });
});
