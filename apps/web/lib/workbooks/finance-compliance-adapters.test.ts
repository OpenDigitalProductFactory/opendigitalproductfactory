import { describe, it, expect } from "vitest";
import { INVOICE_COLUMNS, invoiceToGridRow } from "./invoice-adapter-mapping";
import { RISK_COLUMNS, riskToGridRow, buildRiskInput } from "./risk-adapter-mapping";

describe("invoice mapping", () => {
  it("makes only the non-economic fields editable", () => {
    // Amounts, currency, refs, and issue date stay read-only in the grid: they are
    // edited on the invoice itself, where totals recompute and the change is visible.
    const editable = INVOICE_COLUMNS.filter((c) => c.editable).map((c) => c.columnId);
    expect(editable).toEqual(["status", "dueDate"]);
  });

  it("keeps every amount column read-only in the grid", () => {
    const amountColumns = ["totalAmount", "amountDue", "currency"];
    for (const id of amountColumns) {
      expect(INVOICE_COLUMNS.find((c) => c.columnId === id)?.editable, id).toBe(false);
    }
  });

  it("maps an invoice to a row keyed by column with numeric amounts", () => {
    const row = invoiceToGridRow({
      invoiceRef: "INV-2026-0001",
      status: "sent",
      accountName: "Acme",
      totalAmount: 1200.5,
      amountDue: 200.5,
      currency: "GBP",
      issueDate: new Date("2026-06-01T00:00:00.000Z"),
      dueDate: new Date("2026-06-30T00:00:00.000Z"),
      type: "standard",
    });
    expect(row.rowId).toBe("INV-2026-0001");
    expect(row.cells.status).toBe("sent");
    expect(row.cells.account).toBe("Acme");
    expect(row.cells.totalAmount).toBe(1200.5);
    expect(row.cells.dueDate).toBe("2026-06-30T00:00:00.000Z");
  });
});

describe("risk mapping", () => {
  it("marks identity/status/timestamp read-only and content editable", () => {
    const byId = new Map(RISK_COLUMNS.map((c) => [c.columnId, c]));
    expect(byId.get("assessmentId")?.editable).toBe(false);
    expect(byId.get("status")?.editable).toBe(false);
    expect(byId.get("assessedAt")?.editable).toBe(false);
    expect(byId.get("title")?.editable).toBe(true);
    expect(byId.get("severity")?.editable).toBe(true);
  });

  it("severity/likelihood/inherentRisk are selects with options", () => {
    const sev = RISK_COLUMNS.find((c) => c.columnId === "severity");
    expect(sev?.fieldType).toBe("select");
    expect(sev?.config?.options?.map((o) => o.key)).toContain("catastrophic");
  });

  it("maps a risk to a row (null next-review -> null)", () => {
    const row = riskToGridRow({
      assessmentId: "RA-abc",
      title: "Slip hazard",
      hazard: "Wet floor",
      likelihood: "possible",
      severity: "moderate",
      inherentRisk: "high",
      residualRisk: null,
      status: "active",
      scope: null,
      nextReviewDate: null,
      notes: null,
      assessedAt: new Date("2026-06-01T09:00:00.000Z"),
    });
    expect(row.rowId).toBe("RA-abc");
    expect(row.cells.inherentRisk).toBe("high");
    expect(row.cells.nextReviewDate).toBeNull();
  });
});

describe("buildRiskInput", () => {
  it("includes only the changed fields", () => {
    const input = buildRiskInput({ severity: "major" });
    expect(input).toEqual({ severity: "major" });
  });

  it("coerces an empty residualRisk/scope/notes to null", () => {
    const input = buildRiskInput({ residualRisk: "", scope: "  ", notes: "" });
    expect(input.residualRisk).toBeNull();
    expect(input.scope).toBeNull();
    expect(input.notes).toBeNull();
  });

  it("parses nextReviewDate to a Date and empty to null", () => {
    const withDate = buildRiskInput({ nextReviewDate: "2026-12-01" });
    expect(withDate.nextReviewDate).toBeInstanceOf(Date);
    const cleared = buildRiskInput({ nextReviewDate: "" });
    expect(cleared.nextReviewDate).toBeNull();
  });

  it("throws when title or hazard is cleared", () => {
    expect(() => buildRiskInput({ title: "  " })).toThrow(/title/i);
    expect(() => buildRiskInput({ hazard: "" })).toThrow(/hazard/i);
  });

  it("throws on an invalid next review date", () => {
    expect(() => buildRiskInput({ nextReviewDate: "not-a-date" })).toThrow(/date/i);
  });
});
