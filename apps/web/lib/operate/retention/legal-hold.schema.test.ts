import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { LEGAL_HOLD_MODELS, LEGAL_HOLD_FIELD, legalHoldExclusion } from "./legal-hold";
import { readCanonicalPrismaSchema } from "@dpf/db/schema-source";

// Drift guard: LEGAL_HOLD_MODELS must exactly match the set of Prisma models
// that actually carry a `legalHold Boolean` column. If someone adds a legalHold
// column to a new model (or removes one) without updating the set, this fails —
// so the retention engine can never silently stop honouring a hold on a newly
// held model. Same discipline as the stewardship-scope guard (BI-C34E09B0).


/** camelCase the first character, matching the Prisma delegate accessor. */
function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/** Parse schema.prisma for every model whose body declares a `legalHold`
 *  Boolean field, returning delegate names. */
function modelsWithLegalHoldFromSchema(): Set<string> {
  const src = readCanonicalPrismaSchema();
  const out = new Set<string>();
  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = modelRe.exec(src)) !== null) {
    const [, name, body] = m;
    if (new RegExp(`^\\s*${LEGAL_HOLD_FIELD}\\s+Boolean\\b`, "m").test(body)) {
      out.add(delegateName(name));
    }
  }
  return out;
}

describe("LEGAL_HOLD_MODELS drift guard", () => {
  it("exactly matches the models carrying a legalHold Boolean column in schema.prisma", () => {
    const fromSchema = modelsWithLegalHoldFromSchema();
    expect(fromSchema.size).toBeGreaterThan(0); // the parse works / columns exist
    expect([...LEGAL_HOLD_MODELS].sort()).toEqual([...fromSchema].sort());
  });
});

describe("legalHoldExclusion", () => {
  it("excludes held rows for a model with a legalHold column", () => {
    expect(legalHoldExclusion("patientProfile")).toEqual({ legalHold: { not: true } });
  });

  it("is a no-op for a model without a legalHold column", () => {
    expect(legalHoldExclusion("toolExecution")).toEqual({});
    expect(legalHoldExclusion("agentThread")).toEqual({});
  });

  it("spares only an explicit hold — false and null stay purge-eligible", () => {
    // `{ not: true }` matches false and null; only legalHold=true is excluded.
    // This is asserted structurally here and functionally in execute.legal-hold.test.ts.
    expect(legalHoldExclusion("careIntakePacket")).toEqual({ legalHold: { not: true } });
  });
});
