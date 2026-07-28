import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DirectionLoadingState } from "./DirectionLoadingState";

describe("DirectionLoadingState", () => {
  it("announces loading without exposing placeholder evidence", () => {
    const html = renderToStaticMarkup(<DirectionLoadingState />);

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading product direction"');
    expect(html).toContain("Loading product direction");
    expect(html).not.toContain("0 sales");
    expect(html).not.toContain("No decisions");
  });
});
