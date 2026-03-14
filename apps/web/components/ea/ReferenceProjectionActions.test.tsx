import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReferenceProjectionActions } from "./ReferenceProjectionActions";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

describe("ReferenceProjectionActions", () => {
  it("renders a load action when no value stream projection exists", () => {
    const html = renderToStaticMarkup(
      <ReferenceProjectionActions
        referenceModelSlug="it4it_v3_0_1"
        valueStreamProjection={{
          viewId: null,
          viewName: null,
          isProjected: false,
        }}
      />,
    );

    expect(html).toContain("Load value stream view");
    expect(html).not.toContain("Open current view");
  });

  it("renders a refresh action and open-view link when the projection already exists", () => {
    const html = renderToStaticMarkup(
      <ReferenceProjectionActions
        referenceModelSlug="it4it_v3_0_1"
        valueStreamProjection={{
          viewId: "view-1",
          viewName: "IT4IT value streams",
          isProjected: true,
        }}
      />,
    );

    expect(html).toContain("Refresh value stream view");
    expect(html).toContain("/ea/views/view-1");
    expect(html).toContain("Open current view");
  });
});
