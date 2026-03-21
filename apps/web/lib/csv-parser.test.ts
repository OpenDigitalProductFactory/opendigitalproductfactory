import { describe, expect, it } from "vitest";
import { parseCSV } from "./csv-parser";

describe("parseCSV", () => {
  it("parses simple date/description/amount CSV", () => {
    const csv = "Date,Description,Amount\n20/03/2026,Coffee shop,-4.50\n21/03/2026,Client payment,1500.00";
    const result = parseCSV(csv);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].amount).toBe(-4.50);
    expect(result.transactions[1].amount).toBe(1500);
    expect(result.errors).toHaveLength(0);
  });

  it("handles debit/credit columns (Barclays format)", () => {
    const csv = "Date,Description,Money In,Money Out,Balance\n20/03/2026,Salary,3000.00,,5000.00\n21/03/2026,Rent,,1200.00,3800.00";
    const result = parseCSV(csv);
    expect(result.transactions[0].amount).toBe(3000);
    expect(result.transactions[1].amount).toBe(-1200);
    expect(result.format).toBe("barclays");
  });

  it("handles UK date format DD/MM/YYYY", () => {
    const csv = "Date,Description,Amount\n25/12/2026,Christmas,-50.00";
    const result = parseCSV(csv);
    expect(result.transactions[0].date.getMonth()).toBe(11); // December = 11
    expect(result.transactions[0].date.getDate()).toBe(25);
  });

  it("handles ISO date format", () => {
    const csv = "Date,Description,Amount\n2026-03-20,Transfer,100.00";
    const result = parseCSV(csv);
    expect(result.transactions[0].date.getFullYear()).toBe(2026);
  });

  it("skips blank rows without failing", () => {
    const csv = "Date,Description,Amount\n20/03/2026,Test,10.00\n\n21/03/2026,Test2,20.00";
    const result = parseCSV(csv);
    expect(result.transactions).toHaveLength(2);
  });

  it("reports bad rows without failing entire import", () => {
    const csv = "Date,Description,Amount\n20/03/2026,Good,10.00\nbad-date,Bad,notanumber\n21/03/2026,Good2,20.00";
    const result = parseCSV(csv);
    expect(result.transactions).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(2);
  });

  it("returns total row count", () => {
    const csv = "Date,Description,Amount\n20/03/2026,A,1\n21/03/2026,B,2";
    const result = parseCSV(csv);
    expect(result.totalRows).toBe(2);
  });

  it("handles Lloyds debit/credit columns", () => {
    const csv = "Date,Description,Debit Amount,Credit Amount,Balance\n20/03/2026,Salary,,2500.00,5000.00\n21/03/2026,Bills,500.00,,4500.00";
    const result = parseCSV(csv);
    expect(result.transactions[0].amount).toBe(2500);
    expect(result.transactions[1].amount).toBe(-500);
    expect(result.format).toBe("lloyds");
  });

  it("captures balance when present", () => {
    const csv = "Date,Description,Money In,Money Out,Balance\n20/03/2026,Salary,3000.00,,5000.00";
    const result = parseCSV(csv);
    expect(result.transactions[0].balance).toBe(5000);
  });

  it("detects generic format for simple amount column", () => {
    const csv = "Date,Description,Amount\n20/03/2026,Test,10.00";
    const result = parseCSV(csv);
    expect(result.format).toBe("generic");
  });
});
