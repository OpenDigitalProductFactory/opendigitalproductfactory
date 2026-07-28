import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { ReferenceDataSearch } from "./ReferenceDataControls";

describe("ReferenceDataSearch", () => {
  it("composes the shared named-field and submit contracts", () => {
    const html = renderToStaticMarkup(
      <ReferenceDataSearch
        label="Find countries"
        query=""
        queryParam="countryQ"
        pageParam="countryPage"
        placeholder="Name or ISO code"
      />,
    );

    expect(html).toContain('name="countryQ"');
    expect(html).toContain('type="search"');
    expect(html).toContain(">Find countries</span>");
    expect(html).toContain('type="submit"');
  });
});
