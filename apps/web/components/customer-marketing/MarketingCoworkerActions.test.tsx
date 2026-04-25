import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketingCoworkerActions } from "./MarketingCoworkerActions";

describe("MarketingCoworkerActions", () => {
  it("renders coworker-led marketing actions instead of static form controls", () => {
    const html = renderToStaticMarkup(
      <MarketingCoworkerActions
        actions={[
          {
            label: "Start here",
            title: "Run the first strategy review",
            description: "Ask the strategist to translate assumptions into useful next steps.",
            prompt: "Run the first marketing strategy review.",
            primary: true,
          },
        ]}
      />,
    );

    expect(html).toContain("Run the first strategy review");
    expect(html).toContain("Ask the strategist");
    expect(html).toContain("button");
  });
});
