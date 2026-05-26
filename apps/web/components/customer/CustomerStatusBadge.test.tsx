import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CustomerStatusBadge } from "./CustomerStatusBadge";

describe("CustomerStatusBadge", () => {
  it("renders the label and theme-aware tone classes", () => {
    const html = renderToStaticMarkup(
      <CustomerStatusBadge label="Dormant" tone="warning" />,
    );

    expect(html).toContain(">Dormant<");
    expect(html).toContain("border-[var(--dpf-border)]");
    expect(html).toContain("text-[var(--dpf-text)]");
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
  });
});
