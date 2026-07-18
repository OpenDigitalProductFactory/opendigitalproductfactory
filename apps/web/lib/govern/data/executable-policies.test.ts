// apps/web/lib/govern/data/executable-policies.test.ts
import { describe, expect, it } from "vitest";
import { DATA_EXECUTABLE_POLICIES, obligationKindsInBundle } from "./executable-policies";

describe("executable policy bundle", () => {
  it("has unique policy ids", () => {
    const ids = DATA_EXECUTABLE_POLICIES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only carries obligations on allow-with-obligations effects", () => {
    for (const p of DATA_EXECUTABLE_POLICIES) {
      if ((p.obligations?.length ?? 0) > 0) {
        expect(p.effect).toBe("allow-with-obligations");
      }
    }
  });

  it("reports the obligation kinds the bundle can attach", () => {
    const kinds = obligationKindsInBundle();
    expect(kinds.has("mask")).toBe(true);
    expect(kinds.has("disposition-evidence")).toBe(true);
  });
});
