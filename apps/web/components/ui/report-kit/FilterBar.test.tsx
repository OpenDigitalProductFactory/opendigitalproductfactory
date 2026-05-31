import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { FilterBar, type FacetDef } from "./FilterBar";

const FACETS: FacetDef[] = [
  { kind: "search", key: "q", placeholder: "Search invoices" },
  {
    kind: "select",
    key: "status",
    label: "Status",
    options: [
      { value: "paid", label: "Paid" },
      { value: "overdue", label: "Overdue" },
    ],
  },
  {
    kind: "pills",
    key: "direction",
    label: "Direction",
    options: [
      { value: "in", label: "Inbound" },
      { value: "out", label: "Outbound" },
    ],
  },
];

describe("FilterBar", () => {
  it("renders all facet kinds with a result count", () => {
    const html = renderToStaticMarkup(
      <FilterBar
        mode="client"
        facets={FACETS}
        value={{ direction: "in" }}
        onChange={() => {}}
        resultCount={7}
      />,
    );
    expect(html).toContain("Search invoices");
    expect(html).toContain("Status");
    expect(html).toContain("Inbound");
    expect(html).toContain("7 results");
  });

  it("marks the active pill via the accent token", () => {
    const html = renderToStaticMarkup(
      <FilterBar
        mode="client"
        facets={FACETS}
        value={{ direction: "out" }}
        onChange={() => {}}
      />,
    );
    expect(html).toMatch(/var\(--dpf-accent\)/);
  });

  it("url mode renders pills as links built from basePath + value", () => {
    const html = renderToStaticMarkup(
      <FilterBar mode="url" facets={FACETS} value={{}} basePath="/finance/payments" />,
    );
    expect(html).toContain('href="/finance/payments?direction=in"');
    expect(html).toContain('href="/finance/payments?direction=out"');
  });

  it("url mode preserves other facet values in the href and toggles active off", () => {
    const html = renderToStaticMarkup(
      <FilterBar
        mode="url"
        facets={FACETS}
        value={{ direction: "in", status: "paid" }}
        basePath="/finance/payments"
      />,
    );
    // switching direction keeps status=paid
    expect(html).toContain("direction=out");
    expect(html).toContain("status=paid");
    // the active "in" pill links back to a cleared direction (just status)
    expect(html).toContain('href="/finance/payments?status=paid"');
  });

  it("url mode renders search/select as GET forms targeting basePath", () => {
    const html = renderToStaticMarkup(
      <FilterBar mode="url" facets={FACETS} value={{}} basePath="/finance/payments" />,
    );
    expect(html).toContain('action="/finance/payments"');
    expect(html).toContain('method="get"');
  });

  it("url mode groups multiple select/search facets under a single Apply form", () => {
    const multiSelect: FacetDef[] = [
      { kind: "select", key: "type", label: "Type", options: [{ value: "a", label: "A" }] },
      { kind: "select", key: "status", label: "Status", options: [{ value: "x", label: "X" }] },
      { kind: "select", key: "eff", label: "Eff", options: [{ value: "ok", label: "OK" }] },
    ];
    const html = renderToStaticMarkup(
      <FilterBar mode="url" facets={multiSelect} value={{}} basePath="/compliance/controls" />,
    );
    // exactly one form and one Apply button for all three selects
    expect(html.match(/<form/g)).toHaveLength(1);
    expect(html.match(/Apply/g)).toHaveLength(1);
  });

  it("url mode preserves pill selections as hidden inputs in the field form", () => {
    const html = renderToStaticMarkup(
      <FilterBar
        mode="url"
        facets={FACETS}
        value={{ direction: "in" }}
        basePath="/finance/payments"
      />,
    );
    expect(html).toContain('type="hidden"');
    expect(html).toContain('name="direction"');
  });

  it("singularizes the result count", () => {
    const html = renderToStaticMarkup(
      <FilterBar
        mode="client"
        facets={[]}
        value={{}}
        onChange={() => {}}
        resultCount={1}
      />,
    );
    expect(html).toContain("1 result");
    expect(html).not.toContain("1 results");
  });
});
