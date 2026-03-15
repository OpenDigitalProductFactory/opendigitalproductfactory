import { describe, expect, it } from "vitest";
import { parseCsv, parseFileContent } from "./file-parsers";

describe("parseCsv", () => {
  it("extracts columns and sample rows", () => {
    const csv = "Name,Email,Course\nAlice,a@test.com,Math\nBob,b@test.com,Science\n";
    const result = parseCsv(Buffer.from(csv));
    expect(result.type).toBe("spreadsheet");
    expect(result.columns).toEqual(["Name", "Email", "Course"]);
    expect(result.sampleRows).toHaveLength(2);
    expect(result.rowCount).toBe(2);
    expect(result.summary).toContain("3 columns");
  });
  it("handles empty CSV", () => {
    const result = parseCsv(Buffer.from(""));
    expect(result.columns).toEqual([]);
    expect(result.rowCount).toBe(0);
  });
  it("truncates columns at 200", () => {
    const headers = Array.from({ length: 250 }, (_, i) => `col${i}`).join(",");
    const result = parseCsv(Buffer.from(headers + "\n"));
    expect(result.columns!.length).toBeLessThanOrEqual(200);
  });
  it("truncates cell values at 200 chars", () => {
    const longVal = "x".repeat(300);
    const result = parseCsv(Buffer.from(`Name\n${longVal}\n`));
    expect(result.sampleRows![0]![0]!.length).toBeLessThanOrEqual(200);
  });
});

describe("parseFileContent", () => {
  it("routes CSV by mime type", async () => {
    const result = await parseFileContent(Buffer.from("A,B\n1,2\n"), "text/csv", "test.csv");
    expect(result!.type).toBe("spreadsheet");
    expect(result!.columns).toEqual(["A", "B"]);
  });
  it("returns null for unsupported type", async () => {
    const result = await parseFileContent(Buffer.from("hello"), "text/plain", "test.txt");
    expect(result).toBeNull();
  });
});
