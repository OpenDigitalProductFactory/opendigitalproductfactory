import { describe, expect, it } from "vitest";
import { classifyInferencePayload } from "./classify-payload";

// BI-BC04FEBF: a source diff hunk has no blank lines, so the whole hunk was one
// "paragraph" and a column named `invoice` borrowed an unrelated `total:` or
// date from dozens of lines away (#6845, a delivery-cost dashboard).
describe("an invoice in source code needs its value on a nearby line (BI-BC04FEBF)", () => {
  const classify = (content: string) => classifyInferencePayload({
    messages: [{ role: "user", content }], systemPrompt: "", taskType: "build-review",
  });
  const filler = Array.from({ length: 12 }, (_, i) => `+  const row${i} = render(cell${i});`).join("\n");
  it.each([
    [`+const columns = [\n+  { key: "invoice", header: t("outcomes.columns.invoice") },\n${filler}\n+  expect(summary).toEqual({ total: 3, rooms: 2 });\n+];`],
    [`+export function project(input: Input) {\n+  const invoiceLabel = "invoice";\n${filler}\n+  const window = { date: 2026, span: 30 };\n+  return window;\n+}`],
    [`+const cost = { invoicedUsd: null };\n+// Estimates are not invoices; see the invoice note.\n${filler}\n+const price = "$125.00";`],
  ])("does not join an invoice word in source code to an unrelated value far away: %#", (content) => {
    expect(classify(content).dataEvidencedClasses).not.toContain("payments-finance");
  });

  it.each([
    `+const fixture = {\n+  invoice: "INV-1042",\n+  amount: 125,\n+};`,
    `+export const sample = () => {\n+  const label = "Invoice";\n+  const total = "Total: $125.00";\n+  return [label, total];\n+};`,
    `+function seed() {\n+  // Invoice for Acme\n+  const due = "Due date: 2026-11-01";\n+  return due;\n+}`,
  ])("keeps an invoice record in source code restricted when its value is on a nearby line: %#", (content) => {
    const result = classify(content);
    expect(result.dataEvidencedClasses).toContain("payments-finance");
    expect(result.overallSensitivity).toBe("restricted");
  });
});
