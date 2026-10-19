import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentPagePreviews } from "./DocumentPagePreviews";

describe("DocumentPagePreviews", () => {
  it("shows one linked thumbnail per slide of the version, with alt text", () => {
    const html = renderToStaticMarkup(<DocumentPagePreviews documentId="DOC-1" version={2} pages={[1, 2, 3]} isPresentation />);
    expect(html).toContain("3 slides");
    expect(html.match(/<img /g)).toHaveLength(3);
    expect(html).toContain('src="/api/documents/DOC-1/previews/2?version=2"');
    expect(html).toContain('alt="Slide 3 of 3"');
    expect(html).not.toMatch(/#[0-9a-f]{6}|text-white|gray-/i);
  });

  it("calls them pages for a document that is not a presentation", () => {
    const html = renderToStaticMarkup(<DocumentPagePreviews documentId="DOC-2" version={1} pages={[1]} isPresentation={false} />);
    expect(html).toContain("1 page");
    expect(html).toContain('alt="Page 1 of 1"');
  });

  it("renders nothing when the version has no previews", () => {
    expect(renderToStaticMarkup(<DocumentPagePreviews documentId="DOC-3" version={1} pages={[]} isPresentation />)).toBe("");
  });
});
