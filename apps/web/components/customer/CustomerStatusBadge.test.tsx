import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CustomerStatusBadge } from "./CustomerStatusBadge";

describe("CustomerStatusBadge", () => {
  it("renders the label through the shared report-kit StatusBadge", () => {
    const html = renderToStaticMarkup(
      <CustomerStatusBadge label="Dormant" tone="warning" />,
    );

    expect(html).toContain(">Dormant<");
    expect(html).toContain('data-intent="warning"');
    expect(html).toContain("border-color:var(--dpf-warning)");
    expect(html).not.toContain("border-[var(--dpf-border)]");
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
  });
});
