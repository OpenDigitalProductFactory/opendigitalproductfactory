import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders an explicit intent with its label and data attribute", () => {
    const html = renderToStaticMarkup(
      <StatusBadge intent="success" label="Paid" />,
    );
    expect(html).toContain('data-intent="success"');
    expect(html).toContain("Paid");
  });

  it("resolves domain + status through the registry", () => {
    const html = renderToStaticMarkup(
      <StatusBadge domain="finance" status="overdue" />,
    );
    expect(html).toContain('data-intent="danger"');
    // default label falls back to the status value
    expect(html).toContain("overdue");
  });

  it("falls back to neutral for an unknown status", () => {
    const html = renderToStaticMarkup(
      <StatusBadge domain="finance" status="mystery" />,
    );
    expect(html).toContain('data-intent="neutral"');
  });

  it("applies token-backed colors (never raw hex)", () => {
    const html = renderToStaticMarkup(
      <StatusBadge intent="danger" label="Critical" variant="soft" />,
    );
    expect(html).toMatch(/var\(--dpf-error\)/);
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("can keep semantic tint while using the readable body foreground for small labels", () => {
    const html = renderToStaticMarkup(
      <StatusBadge intent="warning" label="Due in 60 minutes" variant="soft" textTone="body" />,
    );
    expect(html).toContain("color:var(--dpf-text)");
    expect(html).toContain("var(--dpf-warning) 12%");
    expect(html).toContain('data-intent="warning"');
  });

  it("honors uppercase=false", () => {
    const html = renderToStaticMarkup(
      <StatusBadge intent="info" label="Sent" uppercase={false} />,
    );
    expect(html).not.toContain("uppercase");
  });
});
