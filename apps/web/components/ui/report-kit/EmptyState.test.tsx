import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders the title", () => {
    const html = renderToStaticMarkup(<EmptyState title="No invoices found" />);
    expect(html).toContain("No invoices found");
    expect(html).toContain('role="status"');
  });

  it("renders description, icon, and action when provided", () => {
    const html = renderToStaticMarkup(
      <EmptyState
        title="Nothing here"
        description="Create your first record to get started."
        icon={<span>📭</span>}
        action={<a href="/new">New</a>}
      />,
    );
    expect(html).toContain("Create your first record to get started.");
    expect(html).toContain("📭");
    expect(html).toContain('href="/new"');
  });

  it("uses only tokens — no raw hex", () => {
    const html = renderToStaticMarkup(<EmptyState title="Empty" />);
    expect(html).toContain("var(--dpf-");
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("drops the border in borderless mode", () => {
    const html = renderToStaticMarkup(<EmptyState title="Empty" bordered={false} />);
    expect(html).not.toContain("border-dashed");
  });
});
