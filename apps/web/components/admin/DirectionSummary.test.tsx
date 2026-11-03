import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { namespaceMessages } from "@dpf/i18n";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { describe, expect, it } from "vitest";

import { DirectionSummary } from "./DirectionSummary";

function render(node: ReactElement) {
  return renderToStaticMarkup(
    <MessagesProvider locale="en-US" messages={{ storefront: namespaceMessages("en-US", "storefront") }}>{node}</MessagesProvider>,
  );
}

describe("DirectionSummary (BI-916216E7)", () => {
  it("marks a missing direction and links to the Direction panel", () => {
    const html = render(<DirectionSummary missing={["mission", "vision", "outcomes"]} outcomeCount={0} />);
    expect(html).toContain("Your direction");
    expect(html).toContain("Not set yet");
    expect(html).toContain('href="/storefront/settings/business?section=direction"');
    expect(html).toContain("Set direction");
  });

  it("names what is still missing when part is recorded", () => {
    const html = render(<DirectionSummary missing={["vision"]} outcomeCount={2} />);
    expect(html).toContain("Vision missing");
    expect(html).toContain("Edit direction");
  });

  it("stays short once everything is recorded", () => {
    const html = render(<DirectionSummary missing={[]} outcomeCount={3} />);
    expect(html).not.toContain("Not set yet");
    expect(html).toContain("3 outcomes");
  });
});
