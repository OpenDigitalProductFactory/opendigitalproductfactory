import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { CollapsibleList } from "./CollapsibleList";
import { countDisclosureRegions, defaultVisibleHtml } from "../../../lib/ux-budget";

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => <li key={i}>{`row-${i}`}</li>);

describe("CollapsibleList", () => {
  it("renders every row and no toggle when total <= previewCount", () => {
    const html = renderToStaticMarkup(
      <CollapsibleList previewCount={5}>{rows(4)}</CollapsibleList>,
    );
    expect(html).toContain("row-0");
    expect(html).toContain("row-3");
    expect(html).not.toContain("<button");
  });

  it("collapsed: shows only the preview rows and a 'Show N more' toggle", () => {
    const html = renderToStaticMarkup(
      <CollapsibleList previewCount={3}>{rows(8)}</CollapsibleList>,
    );
    expect(html).toContain("row-0");
    expect(html).toContain("row-2");
    // rows beyond the preview are not present while collapsed
    expect(html).not.toContain("row-3");
    // hidden count = 8 - 3 = 5
    expect(html).toContain("Show 5 more");
    expect(html).toContain('aria-expanded="false"');
  });

  it("expanded: shows all rows and a 'Show fewer' toggle", () => {
    const html = renderToStaticMarkup(
      <CollapsibleList previewCount={3} defaultExpanded>
        {rows(8)}
      </CollapsibleList>,
    );
    expect(html).toContain("row-7");
    expect(html).toContain("Show fewer");
    expect(html).toContain('aria-expanded="true"');
  });

  it("places the toggle at the FOOT — after the last row, never mid-list", () => {
    // This is the structural fix for the UpgradeImpactPanel mid-list bug: the
    // toggle must come after every rendered row, collapsed or expanded.
    const collapsed = renderToStaticMarkup(
      <CollapsibleList previewCount={3}>{rows(8)}</CollapsibleList>,
    );
    expect(collapsed.indexOf("<button")).toBeGreaterThan(
      collapsed.lastIndexOf("row-2"),
    );

    const expanded = renderToStaticMarkup(
      <CollapsibleList previewCount={3} defaultExpanded>
        {rows(8)}
      </CollapsibleList>,
    );
    expect(expanded.indexOf("<button")).toBeGreaterThan(
      expanded.lastIndexOf("row-7"),
    );
  });

  it("honors custom labels and the list element", () => {
    const html = renderToStaticMarkup(
      <CollapsibleList
        previewCount={2}
        as="ol"
        moreLabel={(n) => `+${n} others`}
      >
        {rows(5)}
      </CollapsibleList>,
    );
    expect(html).toContain("<ol");
    expect(html).toContain("+3 others");
  });

  // BI-2B196D07 — the prescribed construct must SATISFY the blocking `deferred-detail`
  // budget check. It previously scored zero disclosure regions, so a surface that
  // deferred correctly here failed while a raw <details> passed.
  it("is countable as a disclosure region by the UX budget when it defers rows", () => {
    const html = renderToStaticMarkup(
      <CollapsibleList previewCount={2}>{rows(5)}</CollapsibleList>,
    );
    expect(countDisclosureRegions(html)).toBe(1);
    // The preview rows are visible on arrival and must survive the measured scope.
    expect(defaultVisibleHtml(html)).toContain("row-0");
  });

  it("claims no disclosure region when the whole list already fits", () => {
    const html = renderToStaticMarkup(
      <CollapsibleList previewCount={5}>{rows(4)}</CollapsibleList>,
    );
    expect(countDisclosureRegions(html)).toBe(0);
  });

  it("uses token-backed color, never raw hex", () => {
    const html = renderToStaticMarkup(
      <CollapsibleList previewCount={2}>{rows(5)}</CollapsibleList>,
    );
    expect(html).toMatch(/var\(--dpf-accent\)/);
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
  });
});
