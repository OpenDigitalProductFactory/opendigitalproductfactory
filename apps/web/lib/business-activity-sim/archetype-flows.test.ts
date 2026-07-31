// apps/web/lib/business-activity-sim/archetype-flows.test.ts
import { describe, expect, it } from "vitest";
import { ARCHETYPE_FLOWS, type ArchetypeFlow } from "./archetype-flows";
import { FINANCIAL_ORACLES } from "./oracles";
import { runArchetypeMatrix, matrixViolations } from "./matrix";

const flowById = (id: string): ArchetypeFlow => {
  const f = ARCHETYPE_FLOWS.find((x) => x.archetypeId === id);
  if (!f) throw new Error(`no flow for ${id}`);
  return f;
};

describe("archetype flows — every archetype bills through the shared spine", () => {
  it("field-service (trades) reuses the real dispatch lifecycle and settles clean", () => {
    const r = flowById("trades-maintenance").run({
      id: "t",
      customerAccountId: "c",
      subtotal: 300,
      taxAmount: 30,
    });
    expect(r.lifecycle).toContain("complete"); // real @dpf/validators status
    expect(r.finalStatus).toBe("paid");
    expect(r.revenueRecognized).toBe(300); // tax is not revenue
    expect(r.cashReceived).toBe(330);
    expect(r.receivableBalance).toBe(0);
    expect(FINANCIAL_ORACLES.every((o) => o(r).ok)).toBe(true);
  });

  it("SaaS recognises the subscription as delivered before it invoices", () => {
    const r = flowById("software-platform").run({ id: "s", customerAccountId: "c", subtotal: 99 });
    expect(r.lifecycle).toEqual(["trial", "active", "invoiced", "paid"]);
    expect(r.workCompletedBeforeInvoice).toBe(true); // "active" precedes "invoiced"
    expect(r.revenueRecognized).toBe(99);
    expect(FINANCIAL_ORACLES.every((o) => o(r).ok)).toBe(true);
  });

  it("retail fulfils at the counter then bills + settles, leaving correct AR on a partial pay", () => {
    const r = flowById("retail-goods").run({
      id: "r",
      customerAccountId: "c",
      subtotal: 200,
      taxAmount: 20,
      paymentAmount: 150,
    });
    expect(r.lifecycle).toContain("fulfilled");
    expect(r.gross).toBe(220);
    expect(r.receivableBalance).toBe(70); // 220 − 150
    expect(FINANCIAL_ORACLES.every((o) => o(r).ok)).toBe(true);
  });
});

describe("runArchetypeMatrix — cross-archetype coverage", () => {
  it("passes every oracle for every archetype in the default matrix", () => {
    const report = runArchetypeMatrix();
    expect(report.passed).toBe(true);
    expect(report.passRate).toBe(1);
    expect(matrixViolations(report)).toEqual([]);
    // one coverage row per registered archetype
    expect(report.archetypes.map((a) => a.archetypeId).sort()).toEqual(
      ["retail-goods", "software-platform", "trades-maintenance"],
    );
  });

  it("surfaces the exact archetype + scenario + invariant when a flow is broken (teeth)", () => {
    // A deliberately broken flow: it posts a payment but never delivers the service,
    // yet still marks itself paid — phantom billing the matrix must catch.
    const brokenFlow: ArchetypeFlow = {
      archetypeId: "broken-archetype",
      label: "Broken",
      run: (s) => {
        const good = flowById("software-platform").run(s);
        return { ...good, workCompletedBeforeInvoice: false };
      },
      defaultScenarios: [{ id: "x", customerAccountId: "c", subtotal: 100 }],
    };
    const report = runArchetypeMatrix([brokenFlow]);
    expect(report.passed).toBe(false);
    expect(report.passRate).toBe(0);
    const violations = matrixViolations(report);
    expect(violations.some((v) => v.includes("broken-archetype/x") && v.includes("FIN5"))).toBe(true);
  });
});
