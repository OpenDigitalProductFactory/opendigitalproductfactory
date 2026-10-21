// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  DataTable,
  pageCount,
  paginateRows,
  sortRows,
  type Column,
} from "./DataTable";

type Row = { id: string; name: string; amount: number };

const ROWS: Row[] = [
  { id: "C-3", name: "Charlie", amount: 30 },
  { id: "C-1", name: "Alice", amount: 10 },
  { id: "C-2", name: "Bob", amount: 20 },
];

const COLUMNS: Column<Row>[] = [
  { key: "id", header: "ID", cell: (r) => r.id, mono: true },
  { key: "name", header: "Name", cell: (r) => r.name, sortAccessor: (r) => r.name },
  {
    key: "amount",
    header: "Amount",
    cell: (r) => r.amount,
    align: "right",
    sortAccessor: (r) => r.amount,
  },
];

describe("responsive DataTable semantics", () => {
  afterEach(cleanup);
  it("sorts reflowed rows through a focusable native control", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} getRowKey={row => row.id} responsive />);
    const control = screen.getByRole("button", { name: "Name" });
    control.focus();
    expect(document.activeElement).toBe(control);
    fireEvent.click(control);
    expect(within(screen.getAllByRole("row")[1]).getByText("Alice")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Name" }).getAttribute("aria-sort")).toBe("ascending");
    fireEvent.click(control);
    expect(within(screen.getAllByRole("row")[1]).getByText("Charlie")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Name" }).getAttribute("aria-sort")).toBe("descending");
  });
  it("retains one table, every field and native sorting controls when rows reflow", () => {
    const html = renderToStaticMarkup(<DataTable columns={COLUMNS} rows={ROWS}
      getRowKey={row => row.id} ariaLabel="Accounts" responsive />);
    expect(html.match(/<table\b/g)).toHaveLength(1);
    expect(html).toContain('role="table"');
    expect(html.match(/<td\b/g)).toHaveLength(9);
    expect(html.match(/<button\b/g)).toHaveLength(2);
    for (const row of ROWS) expect(html).toContain(row.name);
    for (const column of COLUMNS) expect(html).toContain(String(column.header));
  });
});

describe("DataTable pure helpers", () => {
  it("sorts numerically ascending and descending", () => {
    const asc = sortRows(ROWS, (r) => r.amount, "asc").map((r) => r.amount);
    expect(asc).toEqual([10, 20, 30]);
    const desc = sortRows(ROWS, (r) => r.amount, "desc").map((r) => r.amount);
    expect(desc).toEqual([30, 20, 10]);
  });

  it("sorts strings locale-aware", () => {
    const names = sortRows(ROWS, (r) => r.name, "asc").map((r) => r.name);
    expect(names).toEqual(["Alice", "Bob", "Charlie"]);
  });

  it("is a stable sort on ties", () => {
    const tied = [
      { id: "a", name: "x", amount: 1 },
      { id: "b", name: "x", amount: 1 },
      { id: "c", name: "x", amount: 1 },
    ];
    const out = sortRows(tied, (r) => r.amount, "asc").map((r) => r.id);
    expect(out).toEqual(["a", "b", "c"]);
  });

  it("paginates by 0-based page index", () => {
    expect(paginateRows([1, 2, 3, 4, 5], 0, 2)).toEqual([1, 2]);
    expect(paginateRows([1, 2, 3, 4, 5], 2, 2)).toEqual([5]);
  });

  it("computes page count with a floor of 1", () => {
    expect(pageCount(0, 10)).toBe(1);
    expect(pageCount(21, 10)).toBe(3);
  });
});

describe("DataTable render", () => {
  it("renders headers and rows", () => {
    const html = renderToStaticMarkup(
      <DataTable columns={COLUMNS} rows={ROWS} getRowKey={(r) => r.id} />,
    );
    expect(html).toContain("Name");
    expect(html).toContain("Charlie");
    expect(html).toContain("font-mono"); // mono ID column
    expect(html.match(/scope="col"/g)).toHaveLength(COLUMNS.length);
  });

  it("renders the empty state when there are no rows", () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={COLUMNS}
        rows={[]}
        getRowKey={(r) => r.id}
        empty="Nothing here"
      />,
    );
    expect(html).toContain("Nothing here");
  });

  it("renders skeleton rows while loading", () => {
    const html = renderToStaticMarkup(
      <DataTable columns={COLUMNS} rows={ROWS} getRowKey={(r) => r.id} loading />,
    );
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain("Charlie");
  });

  it("wraps cells in a drill-down link when rowHref is provided", () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={(r) => r.id}
        rowHref={(r) => `/x/${r.id}`}
      />,
    );
    expect(html).toContain('href="/x/C-1"');
  });
});
