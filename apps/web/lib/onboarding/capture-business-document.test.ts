import { describe, expect, it, vi } from "vitest";

import type { ManagedDocument } from "@/lib/documents/document-store";
import {
  captureBusinessDocument,
  BUSINESS_DOCUMENT_KIND,
  type CaptureBusinessDocumentDeps,
  type DocumentEnricher,
} from "./capture-business-document";

function deps(over: Partial<CaptureBusinessDocumentDeps> = {}): CaptureBusinessDocumentDeps {
  return {
    parse: vi.fn(async () => ({
      type: "document" as const,
      summary: "3 pages, 1200 characters",
      fullText: "We are an HVAC company serving the tri-county area. Our mission is...",
    })),
    save: vi.fn(async (input) =>
      ({
        id: "doc_row_1",
        documentId: "doc_abc",
        title: input.title,
        documentKind: input.documentKind,
        contentFormat: input.contentFormat,
        currentState: "draft",
        accessScope: "organization",
        sourceKind: "managed",
      }) as ManagedDocument,
    ),
    ...over,
  };
}

const ORG = "org_123";
const buf = Buffer.from("pretend pdf bytes");

describe("captureBusinessDocument", () => {
  it("parses the file and stores it in the DMS as a plan document", async () => {
    const d = deps();
    const res = await captureBusinessDocument(
      { organizationId: ORG, fileName: "business-plan.pdf", mimeType: "application/pdf", buffer: buf },
      d,
    );

    expect(d.parse).toHaveBeenCalledWith(buf, "application/pdf", "business-plan.pdf");
    expect(d.save).toHaveBeenCalledTimes(1);
    const saveArg = (d.save as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(saveArg).toMatchObject({
      organizationId: ORG,
      documentKind: BUSINESS_DOCUMENT_KIND, // "plan"
      contentFormat: "application/pdf",
      sourceKind: "managed",
    });
    expect(saveArg.contentText).toContain("HVAC company");
    expect(saveArg.tags).toContain("onboarding");

    expect(res.documentId).toBe("doc_abc");
    expect(res.textLength).toBeGreaterThan(0);
  });

  it("derives a title from the file name when none is given", async () => {
    const d = deps();
    await captureBusinessDocument(
      { organizationId: ORG, fileName: "Q3 Business Plan.pdf", mimeType: "application/pdf", buffer: buf },
      d,
    );
    const saveArg = (d.save as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(saveArg.title).toBe("Q3 Business Plan");
  });

  it("prefers an explicit title over the file name", async () => {
    const d = deps();
    await captureBusinessDocument(
      { organizationId: ORG, fileName: "plan.pdf", mimeType: "application/pdf", buffer: buf, title: "Our Plan" },
      d,
    );
    expect((d.save as ReturnType<typeof vi.fn>).mock.calls[0][0].title).toBe("Our Plan");
  });

  it("throws on an unsupported document type (parser returns null)", async () => {
    const d = deps({ parse: vi.fn(async () => null) });
    await expect(
      captureBusinessDocument(
        { organizationId: ORG, fileName: "logo.png", mimeType: "image/png", buffer: buf },
        d,
      ),
    ).rejects.toThrow(/unsupported/i);
    expect(d.save).not.toHaveBeenCalled();
  });

  it("invokes the enrichment seam when provided and text is present", async () => {
    const enrich = vi.fn<DocumentEnricher>(async () => {});
    const d = deps({ enrich });
    const res = await captureBusinessDocument(
      { organizationId: ORG, fileName: "plan.pdf", mimeType: "application/pdf", buffer: buf },
      d,
    );
    expect(enrich).toHaveBeenCalledTimes(1);
    expect(enrich.mock.calls[0][0]).toMatchObject({ organizationId: ORG, documentId: "doc_abc" });
    expect(res.enrichmentQueued).toBe(true);
  });

  it("stores without enrichment when no seam is wired (pipeline not yet merged)", async () => {
    const d = deps(); // no enrich
    const res = await captureBusinessDocument(
      { organizationId: ORG, fileName: "plan.pdf", mimeType: "application/pdf", buffer: buf },
      d,
    );
    expect(res.enrichmentQueued).toBe(false);
    expect(d.save).toHaveBeenCalledTimes(1); // doc still captured
  });

  it("does not enrich when extracted text is empty", async () => {
    const enrich = vi.fn<DocumentEnricher>(async () => {});
    const d = deps({
      parse: vi.fn(async () => ({ type: "document" as const, summary: "0 characters", fullText: "   " })),
      enrich,
    });
    const res = await captureBusinessDocument(
      { organizationId: ORG, fileName: "empty.pdf", mimeType: "application/pdf", buffer: buf },
      d,
    );
    expect(enrich).not.toHaveBeenCalled();
    expect(res.enrichmentQueued).toBe(false);
  });
});
