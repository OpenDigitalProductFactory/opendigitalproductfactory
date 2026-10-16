import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProviderDetailSections } from "./ProviderDetailSections";

describe("provider detail disclosures", () => {
  it("retains every supplied tool while expanding only the essential section", () => {
    const html = renderToStaticMarkup(<ProviderDetailSections sections={[
      { key: "connection", title: "Connection", open: true, content: <button>Check connection</button> },
      { key: "usage", title: "Usage and billing", content: <a href="/business/finance">Supplier contract</a> },
      { key: "diagnostics", title: "Diagnostics", content: <p>Recent route decisions</p> },
    ]} />);
    expect((html.match(/<details/g) ?? []).length).toBe(3);
    expect((html.match(/open=""/g) ?? []).length).toBe(1);
    expect(html).toContain("Check connection");
    expect(html).toContain("Supplier contract");
    expect(html).toContain("Recent route decisions");
    expect(html).toContain('href="/business/finance"');
  });
});
