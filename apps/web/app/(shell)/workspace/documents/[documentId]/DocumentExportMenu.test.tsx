// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/documents/document-export", () => ({
  DOCUMENT_EXPORT_FORMATS: ["docx", "odt", "pdf"],
  DOCUMENT_EXPORT_LABELS: { docx: "Word (.docx)", odt: "OpenDocument (.odt)", pdf: "PDF (.pdf)" },
}));

import { DocumentExportMenu } from "./DocumentExportMenu";

afterEach(() => cleanup());

describe("DocumentExportMenu", () => {
  it("offers each exportable format as a download link for the version", () => {
    render(<DocumentExportMenu documentId="DOC 1" version={3} formats={["docx", "odt", "pdf"]} converterAvailable />);
    fireEvent.click(screen.getByText("Export"));
    const links = screen.getAllByRole("menuitem") as HTMLAnchorElement[];
    expect(links.map((link) => link.textContent)).toEqual(["Word (.docx)", "OpenDocument (.odt)", "PDF (.pdf)"]);
    expect(links[0]!.getAttribute("href")).toBe("/api/documents/DOC%201/content?version=3&export=docx");
  });

  it("offers only PDF for a file that cannot become a word-processing document", () => {
    render(<DocumentExportMenu documentId="DOC-1" version={1} formats={["pdf"]} converterAvailable />);
    expect((screen.getAllByRole("menuitem", { hidden: true }) as HTMLAnchorElement[]).map((l) => l.textContent)).toEqual(["PDF (.pdf)"]);
  });

  it("says conversion is not set up instead of offering links that would fail", () => {
    render(<DocumentExportMenu documentId="DOC-1" version={1} formats={["docx", "pdf"]} converterAvailable={false} />);
    expect(screen.queryByText("Export")).toBeNull();
    expect(screen.getByText("Export needs document conversion, not set up here.")).toBeTruthy();
  });

  it("renders nothing when the version cannot be exported", () => {
    const { container } = render(<DocumentExportMenu documentId="DOC-1" version={1} formats={[]} converterAvailable />);
    expect(container.innerHTML).toBe("");
  });
});
