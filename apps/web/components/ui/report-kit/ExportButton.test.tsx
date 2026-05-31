import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ExportButton, toCsv } from "./ExportButton";

const ROWS = [
  { id: "C-1", name: "Alice", amount: 10 },
  { id: "C-2", name: "Bob", amount: 20 },
];

// papaparse emits CRLF line endings; split tolerantly.
const lines = (csv: string) => csv.trim().split(/\r\n|\n/);

describe("toCsv", () => {
  it("serializes all keys when no columns given", () => {
    const [header, ...rows] = lines(toCsv(ROWS));
    expect(header).toBe("id,name,amount");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("Alice");
  });

  it("projects + reorders + renames via columns", () => {
    const csv = toCsv(ROWS, [
      { key: "name", header: "Customer" },
      { key: "amount", header: "Total" },
    ]);
    expect(lines(csv)[0]).toBe("Customer,Total");
    expect(csv).not.toContain("C-1"); // id projected out
  });

  it("emits empty cells for missing keys", () => {
    const csv = toCsv([{ name: "X" }], [{ key: "name" }, { key: "missing" }]);
    expect(lines(csv)[1]).toBe("X,");
  });
});

describe("ExportButton", () => {
  it("renders an enabled button with the given label", () => {
    const html = renderToStaticMarkup(<ExportButton rows={ROWS} label="Download" />);
    expect(html).toContain("Download");
    // the disabled *attribute* must be absent (the class has "disabled:" utilities)
    expect(html).not.toContain('disabled=""');
  });

  it("is disabled when there are no rows", () => {
    const html = renderToStaticMarkup(<ExportButton rows={[]} />);
    expect(html).toContain('disabled=""');
  });
});
