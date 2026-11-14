import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { EntityRefText } from "./EntityRefText";
import { ReferencedByPanel, referencedByLabels } from "./ReferencedByPanel";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a className={className} href={href}>{children}</a>
  ),
}));

const labels = referencedByLabels((key) => key.replace("referencedBy.", ""));

describe("ReferencedByPanel (AC-KLR-3)", () => {
  it("shows each source with its kind, scope and snippet, and the count of readable rows only", () => {
    const html = renderToStaticMarkup(
      <ReferencedByPanel
        labels={labels}
        rows={[
          { key: "BI-1", kind: "backlog", title: "Fix the close", status: "open", scope: "organization", href: "/ops?itemId=BI-1", snippet: "…blocked by BI-2…" },
          { key: "page-1", kind: "wiki", title: "Close craft", status: "published", scope: "profession", href: "/coworker-decisions/professions/finance/close", snippet: null },
        ]}
      />,
    );
    expect(html).toContain('href="/ops?itemId=BI-1"');
    expect(html).toContain("Fix the close");
    expect(html).toContain("kinds.backlog");
    expect(html).toContain("scopes.organization");
    expect(html).toContain("…blocked by BI-2…");
    expect(html).toContain("(2)");
  });

  it("shows the empty state with no count when nothing readable references the entity", () => {
    const html = renderToStaticMarkup(<ReferencedByPanel labels={labels} rows={[]} />);
    expect(html).toContain("empty");
    expect(html).not.toContain("(0)");
  });
});

describe("EntityRefText (AC-KLR-1, Workroom messages)", () => {
  it("links readable ids and leaves unknown and unreadable ids as identical plain text", () => {
    const html = renderToStaticMarkup(<EntityRefText text="Took BI-AAA1, saw BI-HIDE9 and BI-NOPE8." hrefs={{ "BI-AAA1": "/ops?itemId=BI-AAA1" }} />);
    expect(html).toContain('<a class="text-[var(--dpf-accent)] hover:underline" href="/ops?itemId=BI-AAA1">BI-AAA1</a>');
    expect(html).toContain(", saw BI-HIDE9 and BI-NOPE8.");
  });

  it("without resolved ids renders the text unchanged", () => {
    expect(renderToStaticMarkup(<EntityRefText text="BI-AAA1" />)).toBe("BI-AAA1");
  });
});
