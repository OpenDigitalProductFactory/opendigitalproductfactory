import { describe, expect, it } from "vitest";

import { renderMarkdown } from "@/lib/shared/markdown";

import { EPIC_DESCRIPTION_OPTIONS, epicDescriptionMarkdown } from "./epic-description-markdown";

describe("epic description through the shared renderer (BI-A63A9476)", () => {
  it("keeps docs paths as portal links and opens external links in a new tab", () => {
    const html = renderMarkdown(
      epicDescriptionMarkdown("Spec docs/superpowers/specs/x.md and file:///D:/repo/docs/plans/y.md, see https://example.com"),
      EPIC_DESCRIPTION_OPTIONS,
    );
    expect(html).toContain('href="/api/docs?path=docs%2Fsuperpowers%2Fspecs%2Fx.md"');
    expect(html).toContain('href="/api/docs?path=docs%2Fplans%2Fy.md"');
    expect(html).toMatch(/href="https:\/\/example\.com"[^>]*target="_blank" rel="noopener noreferrer"/);
  });

  it("links readable entity ids and leaves the rest as text", () => {
    const html = renderMarkdown(epicDescriptionMarkdown("Covers BI-AAA1 and BI-HIDE2"), {
      ...EPIC_DESCRIPTION_OPTIONS,
      entityRefHref: (id) => (id === "BI-AAA1" ? "/ops?itemId=BI-AAA1" : null),
    });
    expect(html).toContain('<a href="/ops?itemId=BI-AAA1" class="text-[var(--dpf-accent)] hover:underline break-all">BI-AAA1</a>');
    expect(html).toContain(" and BI-HIDE2");
  });
});
