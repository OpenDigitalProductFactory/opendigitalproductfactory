import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SurfaceViewSwitcher } from "./SurfaceViewSwitcher";

vi.mock("@/lib/workbooks/platform-tables", () => ({
  getHomeSurfaceForEntity: (entityType: string) => {
    if (entityType === "backlog_item") {
      return {
        path: "/ops",
        label: "Operations",
        board: true,
        defaultDataLens: {
          defaultLabel: "Active only",
          allLabel: "All items",
          filter: {
            conditions: [{ field: "status", operator: "in", value: ["open"] }],
            logic: "and",
          },
        },
      };
    }
    if (entityType === "supplier") {
      return { path: "/finance/suppliers", label: "Suppliers", board: true };
    }
    return undefined;
  },
}));

describe("SurfaceViewSwitcher data lens (BI-9DB20C39)", () => {
  it.each(["grid", "board"] as const)(
    "renders the domain default and explicit all-records scope for %s",
    (current) => {
      const html = renderToStaticMarkup(
        <SurfaceViewSwitcher entityType="backlog_item" current={current} />,
      );

      expect(html).toContain('aria-label="Operations data scope"');
      expect(
        html.match(new RegExp(`aria-current="page"[^>]*href="/ops\\?view=${current}"`, "g")),
      ).toHaveLength(2);
      expect(html).toContain(`href="/ops?view=${current}&amp;dataScope=all"`);
      expect(html).toContain("Active only");
      expect(html).toContain("All items");
    },
  );

  it("keeps scope controls out of List and all-records domain surfaces", () => {
    const listHtml = renderToStaticMarkup(
      <SurfaceViewSwitcher entityType="backlog_item" current="list" />,
    );
    const unfilteredGridHtml = renderToStaticMarkup(
      <SurfaceViewSwitcher entityType="supplier" current="grid" />,
    );

    expect(listHtml).not.toContain("data scope");
    expect(unfilteredGridHtml).not.toContain("data scope");
  });
});
