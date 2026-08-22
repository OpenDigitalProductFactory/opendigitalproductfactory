import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/business-stance", () => ({
  publishBusinessStance: vi.fn(),
  saveBusinessStance: vi.fn(),
}));

import { BusinessStanceForm } from "./BusinessStanceForm";

describe("BusinessStanceForm", () => {
  it("renders archetype-aware authoring examples supplied by the server page (BI-5220C674)", () => {
    const html = renderToStaticMarkup(
      createElement(BusinessStanceForm, {
        examples: {
          title: "How we prioritize limited support",
          body: "Urgent mission need comes first; contributions never buy priority.",
          summary: "Mission and need set priority",
        },
      }),
    );

    expect(html).toContain('placeholder="How we prioritize limited support"');
    expect(html).toContain("Urgent mission need comes first; contributions never buy priority.");
    expect(html).toContain('placeholder="Mission and need set priority"');
    expect(html).not.toMatch(/placeholder="[^"]*refund/i);
  });
});
