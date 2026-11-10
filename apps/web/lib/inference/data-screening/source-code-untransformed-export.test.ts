// BI-35FAE2DB follow-up — why Build Studio design review could never complete.
//
// Two independent fences confined every code payload to the local engine:
//
//  1. The source-code pack declares `protectedExternalEffect:
//     "allow-with-obligations"`, but the generated executable policy matched
//     only `transformations: ["masked","tokenized"]`. Code is never masked, so
//     the allow could not fire and evaluation fell to `no-policy-high-risk`.
//  2. The workload binding classified source code `confidential`, which
//     auto-attaches a `mask` obligation (profile `default-confidential`), and
//     `screenInferencePayload` fences any turn carrying one.
//
// Observed live on FB-D85BEA44: design review looped 348 rounds, every attempt
// dying with `inference admission timeout on local engine after 120000ms`.
//
// Driven through the real screener so classifier, policy bundle and route
// mapping are exercised together rather than a hand-built context.
import { describe, it, expect } from "vitest";
import { screenInferencePayload } from "./screen-inference-payload";

function screen(content: string) {
  return screenInferencePayload({
    systemPrompt: "You are a design reviewer.",
    messages: [{ role: "user", content }],
    tools: [],
    routeContext: { sensitivity: "internal" },
  }).receipt;
}

const CODE =
  "export function normalizeFilePaths(paths: string[]): string[] { return paths.filter(Boolean); } "
  + "import { prisma } from '@dpf/db';";

describe("source code may leave untransformed (BI-35FAE2DB follow-up)", () => {
  it("lets an untransformed source-code payload route off-host", () => {
    const r = screen(CODE);
    expect(r.classifiedDataClasses).toEqual(["source-code"]);
    // The control for code is contractual — the pack's no-training /
    // zero-retention / repository-authorized provider evidence — not masking.
    expect(r.routeEffect).toBe("allow");
  });

  it("still confines regulated data in the same untransformed shape", () => {
    const pay = screen("Wire the vendor: routing number 021000021, account number 5512338891.");
    expect(pay.routeEffect).toBe("local-only");

    const emp = screen("Employee salary band review: base salary 92000, SSN 123-45-6789.");
    expect(emp.routeEffect).toBe("local-only");
  });

  it("does not let code launder regulated data bundled with it", () => {
    const mixed = screen(`${CODE}\nEmployee salary band review: base salary 92000, SSN 123-45-6789.`);
    expect(mixed.classifiedDataClasses).toContain("source-code");
    expect(mixed.routeEffect).toBe("local-only");
  });

  it("keeps secrets on the host even when they appear inside code", () => {
    // secrets-credentials stays `restricted` + local-only. This is the case that
    // makes the whole change safe: reclassifying code did NOT reclassify keys.
    const secret = screen(`${CODE}\nconst key = "sk-ant-api03-REDACTEDLOOKINGSECRETVALUE";`);
    expect(secret.classifiedDataClasses).toContain("secrets-credentials");
    expect(secret.routeEffect).toBe("local-only");
  });

  it("scopes the untransformed opt-in to exactly one pack", async () => {
    // A regression here would widen PHI/payroll/customer export, so assert the
    // opt-in is not spreading.
    const mod = await import("./vertical-policy-packs");
    const classes = [
      "customer-records", "employee-records", "payments-finance", "health-phi",
      "student-records", "youth-sensitive", "legal-privileged", "criminal-justice",
      "safety-sensitive", "public-sector-records", "security-logs",
      "regulated-decisioning", "source-code", "secrets-credentials",
    ] as const;
    const permitted = classes.filter((c) =>
      (mod.getVerticalSensitiveDataPolicyPack(c) as unknown as {
        untransformedExternalExport?: string;
      }).untransformedExternalExport === "permitted");
    expect(permitted).toEqual(["source-code"]);
  });
});
