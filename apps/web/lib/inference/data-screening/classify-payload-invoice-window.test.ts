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

  // The window bounds only the bare-word path. An invoice followed by its own
  // reference is a record wherever its amount sits, and a minified record is
  // one line, so it is always inside the window.
  const fields = Array.from({ length: 12 }, (_, i) => `  "field${i}": "value${i}",`).join("\n");
  it.each([
    [`const exported = {\n  "invoice": "INV-2001",\n${fields}\n  "total": 125.5\n};`],
    [`const exported = {\n  invoice: 'A-77',\n${fields}\n  amountDue: "$125.00"\n};`],
    [`export const data={vendor:"Acme",a:1,b:2,c:3,d:4,e:5,f:6,g:7,h:8,i:9,note:"invoice",total:125.5};`],
    [`const rows = [\n  // invoice #4412 from the March export\n${fields}\n];`],
  ])("keeps a spread-out or minified invoice record in source code restricted: %#", (content) => {
    const result = classify(content);
    expect(result.dataEvidencedClasses).toContain("payments-finance");
    expect(result.overallSensitivity).toBe("restricted");
  });

  // The boundary, stated exactly. A bare `invoice` (no reference after it) whose
  // only value is more than three lines away is NOT a payment record in source
  // code. The platform owner accepted that residual risk for this change
  // (DI-3981EF989BCA); this test pins it so any widening or narrowing is visible.
  const gap = (n: number) => Array.from({ length: n }, (_, i) => `  const step${i} = run(${i});`).join("\n");
  const bareRecord = (linesBetween: number) =>
    `function seed() {\n  // invoice\n${gap(linesBetween)}\n  const total = "Total: $125.00";\n}`;
  it("treats a bare invoice word with its value three lines away as a payment record", () => {
    expect(classify(bareRecord(2)).dataEvidencedClasses).toContain("payments-finance");
  });
  it("does not treat a bare invoice word with its value four lines away as a payment record (owner-accepted gap)", () => {
    expect(classify(bareRecord(3)).dataEvidencedClasses).not.toContain("payments-finance");
  });
});
