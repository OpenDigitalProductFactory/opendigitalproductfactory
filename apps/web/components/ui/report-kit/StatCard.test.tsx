import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { StatCard } from "./StatCard";

describe("StatCard", () => {
  it("renders label, value, and hint", () => {
    const html = renderToStaticMarkup(
      <StatCard label="Outstanding" value="£12,340" hint="across 8 invoices" />,
    );
    expect(html).toContain("Outstanding");
    expect(html).toContain("£12,340");
    expect(html).toContain("across 8 invoices");
  });

  it("colors the accent border from intent (token, no hex)", () => {
    const html = renderToStaticMarkup(
      <StatCard label="Overdue" value="3" intent="danger" />,
    );
    expect(html).toContain("var(--dpf-error)");
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("renders a delta chip with auto intent by direction", () => {
    const up = renderToStaticMarkup(
      <StatCard label="MRR" value="£5k" delta={{ label: "+12%", direction: "up" }} />,
    );
    expect(up).toContain('data-delta-intent="success"');
    expect(up).toContain("+12%");

    const down = renderToStaticMarkup(
      <StatCard label="Churn" value="2%" delta={{ label: "-1%", direction: "down" }} />,
    );
    expect(down).toContain('data-delta-intent="danger"');
  });

  it("honors a delta intent override (up can be bad)", () => {
    const html = renderToStaticMarkup(
      <StatCard
        label="Spend"
        value="£900"
        delta={{ label: "+30%", direction: "up", intent: "danger" }}
      />,
    );
    expect(html).toContain('data-delta-intent="danger"');
  });

  it("renders as a link when href is provided", () => {
    const html = renderToStaticMarkup(
      <StatCard label="Paid" value="42" href="/finance/invoices" />,
    );
    expect(html).toContain('href="/finance/invoices"');
  });
});
