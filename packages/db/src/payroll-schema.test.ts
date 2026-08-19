import { describe, expect, it } from "vitest";
import { readCanonicalPrismaSchema } from "./schema-source";

const schema = readCanonicalPrismaSchema();

describe("payroll persistence schema", () => {
  it("keeps PayRun and Payslip lifecycle fields database-enforced enums", () => {
    expect(schema).toMatch(
      /enum PayRunStatus \{\s+draft\s+approved\s+paid\s+cancelled\s+\}/,
    );
    expect(schema).toMatch(
      /enum PayslipDisbursementStatus \{\s+pending\s+paid\s+failed\s+\}/,
    );
    expect(schema).toMatch(/status\s+PayRunStatus\s+@default\(draft\)/);
    expect(schema).toMatch(
      /disbursementStatus\s+PayslipDisbursementStatus\s+@default\(pending\)/,
    );
  });
});
