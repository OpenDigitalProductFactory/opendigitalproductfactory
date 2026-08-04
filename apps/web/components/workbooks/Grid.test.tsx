// @vitest-environment jsdom
//
// Component coverage for WorkbookGrid — the wiring around react-data-grid: the
// toolbar, the Find & Replace bar, and the CSV/Excel export buttons. These are the
// surfaces added in the S3–S5 cell-interaction work + native .xlsx export, and the
// coverage a future `useCellRange` extraction (BI-D5D71CBA) leans on to refactor
// safely. react-data-grid virtualizes on layout jsdom doesn't provide, so we
// polyfill ResizeObserver, element geometry, and CSS.escape (which it calls while
// measuring column widths on mount).

import type { ComponentProps } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ColumnDefinition, GridRow, GridCapabilities } from "@/lib/workbooks/types";

vi.mock("@/lib/actions/workbooks", () => ({
  createRowAction: vi.fn(async () => ({ ok: true, data: { rowId: "r-new" } })),
  updateCellsAction: vi.fn(async () => ({ ok: true, data: {} })),
  deleteRowAction: vi.fn(async () => ({ ok: true, data: {} })),
  reorderRowsAction: vi.fn(async () => ({ ok: true, data: {} })),
  listViewsAction: vi.fn(async () => ({ ok: true, data: [] })),
  saveViewAction: vi.fn(async () => ({ ok: true, data: {} })),
  deleteViewAction: vi.fn(async () => ({ ok: true, data: {} })),
  setDefaultViewAction: vi.fn(async () => ({ ok: true, data: {} })),
  createColumnAction: vi.fn(async () => ({ ok: true, data: {} })),
  updateColumnAction: vi.fn(async () => ({ ok: true, data: {} })),
  deleteColumnAction: vi.fn(async () => ({ ok: true, data: {} })),
  importSheetAction: vi.fn(async () => ({ ok: true, data: {} })),
}));
vi.mock("@/lib/actions/platform-grid", () => ({
  updatePlatformCellsAction: vi.fn(async () => ({ ok: true, data: {} })),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { WorkbookGrid } from "./Grid";
import { updateCellsAction } from "@/lib/actions/workbooks";

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  // jsdom does not define global CSS; react-data-grid calls CSS.escape while
  // measuring column widths on mount.
  (globalThis as unknown as { CSS: { escape: (v: string) => string } }).CSS = {
    escape: (v: string) => String(v),
  };
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400, x: 0, y: 0, toJSON() {} }),
  });
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const columns: ColumnDefinition[] = [
  { columnId: "name", name: "Name", fieldType: "text", position: 0, required: false, editable: true },
  { columnId: "qty", name: "Qty", fieldType: "number", position: 1, required: false, editable: true },
];
const rows: GridRow[] = [
  { rowId: "r1", cells: { name: "Alice", qty: 3 } },
  { rowId: "r2", cells: { name: "Bob", qty: 5 } },
  { rowId: "r3", cells: { name: "alice", qty: 7 } },
];
const capabilities: GridCapabilities = {
  canAddRow: true,
  canAddColumn: true,
  canEditCell: true,
  canDeleteRow: true,
};

function renderGrid(props: Partial<ComponentProps<typeof WorkbookGrid>> = {}) {
  return render(
    <WorkbookGrid
      tableId="TBL-test"
      columns={columns}
      rows={rows}
      capabilities={capabilities}
      source="custom"
      {...props}
    />,
  );
}

function openFind() {
  fireEvent.click(screen.getByText("Find"));
  return screen.getByPlaceholderText(/Find in grid/i) as HTMLInputElement;
}
function findBar() {
  return screen.getByRole("search", { name: /find and replace/i });
}

describe("WorkbookGrid — toolbar", () => {
  it("renders the CSV, Excel, and Find controls", () => {
    renderGrid();
    expect(screen.getByText("Export CSV")).toBeTruthy();
    expect(screen.getByText("Export Excel")).toBeTruthy();
    expect(screen.getByText("Find")).toBeTruthy();
    expect(screen.getByText("+ Add row")).toBeTruthy();
  });

  it("does not offer edit-only controls in a read-only grid", () => {
    renderGrid({ capabilities: { canAddRow: false, canAddColumn: false, canEditCell: false, canDeleteRow: false } });
    expect(screen.queryByText("+ Add row")).toBeNull();
    expect(screen.queryByText("Undo")).toBeNull();
  });
});

describe("WorkbookGrid — Find bar", () => {
  it("opens on the Find button and closes on the ✕", () => {
    renderGrid();
    expect(screen.queryByPlaceholderText(/Find in grid/i)).toBeNull();
    openFind();
    expect(screen.getByPlaceholderText(/Find in grid/i)).toBeTruthy();
    fireEvent.click(within(findBar()).getByLabelText(/close find/i));
    expect(screen.queryByPlaceholderText(/Find in grid/i)).toBeNull();
  });

  it("counts matches case-insensitively by default (Alice + alice = 2)", () => {
    renderGrid();
    const input = openFind();
    fireEvent.change(input, { target: { value: "alice" } });
    expect(within(findBar()).getByText(/1 \/ 2/)).toBeTruthy();
  });

  it("respects the Match-case toggle (only lowercase alice = 1)", () => {
    renderGrid();
    const input = openFind();
    fireEvent.change(input, { target: { value: "alice" } });
    fireEvent.click(within(findBar()).getByTitle(/match case/i));
    expect(within(findBar()).getByText(/1 \/ 1/)).toBeTruthy();
  });

  it("shows a zero count for a query that matches nothing", () => {
    renderGrid();
    const input = openFind();
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(within(findBar()).getByText(/0 \/ 0/)).toBeTruthy();
  });

  it("advances the active match with the next button (wraps 2→1)", () => {
    renderGrid();
    const input = openFind();
    fireEvent.change(input, { target: { value: "alice" } });
    expect(within(findBar()).getByText(/1 \/ 2/)).toBeTruthy();
    fireEvent.click(within(findBar()).getByLabelText(/next match/i));
    expect(within(findBar()).getByText(/2 \/ 2/)).toBeTruthy();
    fireEvent.click(within(findBar()).getByLabelText(/next match/i));
    expect(within(findBar()).getByText(/1 \/ 2/)).toBeTruthy();
  });
});

describe("WorkbookGrid — Replace routes through the persist action", () => {
  it("Replace all rewrites matching string cells via updateCellsAction", async () => {
    renderGrid();
    const input = openFind();
    fireEvent.change(input, { target: { value: "Bob" } });
    fireEvent.click(within(findBar()).getByText(/Replace…/));
    const repl = screen.getByPlaceholderText(/Replace with/i);
    fireEvent.change(repl, { target: { value: "Bobby" } });
    fireEvent.click(screen.getByText("Replace all"));
    // persistCell(rowId, columnId, value, prev) → updateCellsAction(tableId, rowId, { col: value })
    expect(updateCellsAction).toHaveBeenCalledWith("TBL-test", "r2", { name: "Bobby" });
  });
});
