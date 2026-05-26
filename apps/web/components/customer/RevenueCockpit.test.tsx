import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RevenueCockpit } from "./RevenueCockpit";

describe("RevenueCockpit", () => {
  it("renders metrics and attention items", () => {
    const html = renderToStaticMarkup(
      <RevenueCockpit
        summary={{
          metrics: [
            {
              id: "pipeline",
              label: "Pipeline",
              value: "3",
              detail: "£6,000 open",
              href: "/customer/opportunities",
              tone: "accent",
            },
          ],
          attentionItems: [
            {
              id: "stale-opportunities",
              label: "2 stale opportunities need a next action",
              href: "/customer/opportunities",
              tone: "warning",
            },
          ],
        }}
      />,
    );

    expect(html).toContain("Today in revenue");
    expect(html).toContain("Pipeline");
    expect(html).toContain("2 stale opportunities need a next action");
    expect(html).toContain('href="/customer/opportunities"');
  });

  it("renders a calm empty attention state", () => {
    const html = renderToStaticMarkup(
      <RevenueCockpit
        summary={{
          metrics: [],
          attentionItems: [],
        }}
      />,
    );

    expect(html).toContain("No urgent revenue actions right now.");
  });
});
