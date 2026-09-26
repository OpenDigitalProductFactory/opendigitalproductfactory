import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {},
  DocumentRenditionKind: { pdf: "pdf", plain_text: "plain_text" },
}));

import { CHART_OBJECT_PARTS, odfPackage } from "@/lib/shared/__fixtures__/odf-package";
import {
  backfillDocumentRenditions,
  generateDocumentRenditions,
  needsRenditions,
  type RenditionDeps,
} from "./renditions";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF = "application/pdf";

type Row = Record<string, unknown>;

function versionRow(overrides: Row = {}): Row {
  return {
    id: "ver-1",
    version: 2,
    contentFormat: DOCX,
    summary: "Q3 board pack",
    contentBlob: { id: "blob-1", storageKey: "documents/sha256/ab/cd/x", sha256: "a".repeat(64) },
    renditions: [],
    document: {
      id: "doc-db-1",
      documentId: "DOC-1",
      organizationId: "org-1",
      title: "Board pack",
      documentKind: "report",
      currentState: "draft",
      ownerPrincipalId: null,
      currentVersionId: "ver-1",
      tags: [{ tag: "board" }],
    },
    ...overrides,
  };
}

function makeDeps(overrides: Partial<RenditionDeps> = {}, version: Row | null = versionRow()) {
  const upserts: Row[] = [];
  const events: Row[] = [];
  const documentUpdates: Row[] = [];
  const db = {
    documentVersion: {
      findUnique: vi.fn(async () => version),
      findMany: vi.fn(async () => [] as Row[]),
    },
    documentRendition: {
      upsert: vi.fn(async (args: Row) => {
        upserts.push(args);
        return { id: `r-${upserts.length}` };
      }),
    },
    document: {
      update: vi.fn(async (args: Row) => {
        documentUpdates.push(args);
        return { id: "doc-db-1" };
      }),
    },
    documentLifecycleEvent: {
      findFirst: vi.fn(async () => null as Row | null),
      create: vi.fn(async (args: Row) => {
        events.push(args);
        return { id: "evt" };
      }),
    },
  };
  const deps: RenditionDeps = {
    db: db as never,
    convert: vi.fn(async ({ to }: { to: string }) =>
      to === "pdf"
        ? { ok: true as const, data: { bytes: Buffer.from("%PDF-1.7 board"), mime: "application/pdf" } }
        : { ok: true as const, data: { bytes: Buffer.from("Quarterly adoption figures rose."), mime: "text/plain; charset=utf-8" } },
    ) as never,
    readBlob: vi.fn(async () => Buffer.from("PK\u0003\u0004 fake docx")),
    storeBlob: vi.fn(async () => ({ id: "pdf-blob-1" })),
    indexVector: vi.fn(async () => true),
    availability: vi.fn(async () => ({ available: true, detail: "ready" })),
    now: () => new Date("2026-09-25T06:00:00Z"),
    ...overrides,
  };
  return { deps, db, upserts, events, documentUpdates };
}

describe("needsRenditions", () => {
  it("is true only for an office format stored as a blob", () => {
    expect(needsRenditions({ contentFormat: DOCX, contentBlobId: "b" })).toBe(true);
    expect(needsRenditions({ contentFormat: DOCX, contentBlobId: null })).toBe(false);
    expect(needsRenditions({ contentFormat: "text/markdown", contentBlobId: "b" })).toBe(false);
  });

  it("is true for a PDF stored as a blob, so its text is read (BI-26CD1D1E)", () => {
    expect(needsRenditions({ contentFormat: PDF, contentBlobId: "b" })).toBe(true);
    expect(needsRenditions({ contentFormat: PDF, contentBlobId: null })).toBe(false);
  });
});

describe("generateDocumentRenditions", () => {
  it("writes a PDF and a plain-text rendition, then indexes the text", async () => {
    const { deps, upserts, documentUpdates } = makeDeps();
    const outcome = await generateDocumentRenditions("ver-1", deps);

    expect(outcome).toEqual({ status: "rendered", kinds: ["pdf", "plain_text"] });
    expect(deps.convert).toHaveBeenCalledWith(expect.objectContaining({ from: "docx", to: "pdf" }));
    expect(deps.convert).toHaveBeenCalledWith(expect.objectContaining({ from: "docx", to: "txt" }));
    expect(deps.storeBlob).toHaveBeenCalledWith(Buffer.from("%PDF-1.7 board"), "application/pdf");

    const pdf = upserts.find((u) => (u.create as unknown as Row).renditionKind === "pdf")!;
    expect(pdf.where).toEqual({ documentVersionId_renditionKind: { documentVersionId: "ver-1", renditionKind: "pdf" } });
    expect(pdf.create).toMatchObject({ blobId: "pdf-blob-1", mimeType: "application/pdf", contentText: null });
    const text = upserts.find((u) => (u.create as unknown as Row).renditionKind === "plain_text")!;
    expect(text.create).toMatchObject({ contentText: "Quarterly adoption figures rose.", mimeType: "text/plain; charset=utf-8" });

    expect(deps.indexVector).toHaveBeenCalledWith(expect.objectContaining({
      documentId: "DOC-1",
      documentVersionId: "ver-1",
      contentText: "Quarterly adoption figures rose.",
      tags: ["board"],
    }));
    expect(documentUpdates.at(-1)!.data).toEqual({
      fullTextIndexedAt: new Date("2026-09-25T06:00:00Z"),
      semanticIndexedAt: new Date("2026-09-25T06:00:00Z"),
    });
  });

  it("reads a PDF original for text only: one plain_text rendition, no pdf rendition, indexed (BI-26CD1D1E)", async () => {
    const { deps, upserts, documentUpdates } = makeDeps(
      { readBlob: vi.fn(async () => Buffer.from("%PDF-1.7 adoption policy")) },
      versionRow({ contentFormat: PDF }),
    );
    const outcome = await generateDocumentRenditions("ver-1", deps);

    expect(outcome).toEqual({ status: "rendered", kinds: ["plain_text"] });
    expect(deps.convert).toHaveBeenCalledTimes(1);
    expect(deps.convert).toHaveBeenCalledWith(expect.objectContaining({ from: "pdf", to: "txt" }));
    expect(deps.storeBlob).not.toHaveBeenCalled();
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.create).toMatchObject({ renditionKind: "plain_text", contentText: "Quarterly adoption figures rose.", blobId: null });
    expect(deps.indexVector).toHaveBeenCalledWith(expect.objectContaining({
      documentVersionId: "ver-1",
      contentFormat: PDF,
      contentText: "Quarterly adoption figures rose.",
    }));
    expect(documentUpdates.at(-1)!.data).toEqual({
      fullTextIndexedAt: new Date("2026-09-25T06:00:00Z"),
      semanticIndexedAt: new Date("2026-09-25T06:00:00Z"),
    });
  });

  it("leaves a PDF that already has its text rendition alone, never asking for a pdf one", async () => {
    const { deps } = makeDeps({}, versionRow({ contentFormat: PDF, renditions: [{ renditionKind: "plain_text" }] }));
    expect(await generateDocumentRenditions("ver-1", deps)).toEqual({ status: "skipped", reason: "already-rendered" });
    expect(deps.readBlob).not.toHaveBeenCalled();
    expect(deps.convert).not.toHaveBeenCalled();
  });

  it("is idempotent: a version that already has both renditions is left alone", async () => {
    const { deps } = makeDeps({}, versionRow({ renditions: [{ renditionKind: "pdf" }, { renditionKind: "plain_text" }] }));
    expect(await generateDocumentRenditions("ver-1", deps)).toEqual({ status: "skipped", reason: "already-rendered" });
    expect(deps.readBlob).not.toHaveBeenCalled();
  });

  it("only produces the missing kind", async () => {
    const { deps } = makeDeps({}, versionRow({ renditions: [{ renditionKind: "pdf" }] }));
    expect(await generateDocumentRenditions("ver-1", deps)).toEqual({ status: "rendered", kinds: ["plain_text"] });
    expect(deps.convert).toHaveBeenCalledTimes(1);
  });

  it("skips content that is not an office blob", async () => {
    const { deps } = makeDeps({}, versionRow({ contentFormat: "text/markdown" }));
    expect(await generateDocumentRenditions("ver-1", deps)).toEqual({ status: "skipped", reason: "not-office" });
    const missing = makeDeps({}, null);
    expect(await generateDocumentRenditions("nope", missing.deps)).toEqual({ status: "skipped", reason: "not-found" });
  });

  it("does not re-index a superseded version", async () => {
    const version = versionRow();
    (version.document as unknown as Row).currentVersionId = "ver-newer";
    const { deps } = makeDeps({}, version);
    expect(await generateDocumentRenditions("ver-1", deps)).toEqual({ status: "rendered", kinds: ["pdf", "plain_text"] });
    expect(deps.indexVector).not.toHaveBeenCalled();
  });

  it("records converter-unavailable as a lifecycle event, stops, and does not throw", async () => {
    const { deps, events, upserts } = makeDeps({
      convert: vi.fn(async () => ({ ok: false as const, error: "no dpf-doctools image is configured", reason: "converter-unavailable" as const })) as never,
    });
    const outcome = await generateDocumentRenditions("ver-1", deps);

    expect(outcome).toEqual({ status: "failed", reason: "converter-unavailable", kind: "pdf" });
    expect(deps.convert).toHaveBeenCalledTimes(1);
    expect(upserts).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toMatchObject({
      documentId: "doc-db-1",
      fromState: "draft",
      toState: "draft",
      reason: "rendition converter-unavailable: pdf of v2. no dpf-doctools image is configured",
    });
  });

  it("does not repeat the same failure event for the same version", async () => {
    const { deps, db, events } = makeDeps({
      convert: vi.fn(async () => ({ ok: false as const, error: "exit 125", reason: "converter-unavailable" as const })) as never,
    });
    db.documentLifecycleEvent.findFirst.mockResolvedValueOnce({ id: "earlier" });
    await generateDocumentRenditions("ver-1", deps);
    expect(events).toHaveLength(0);
    expect(db.documentLifecycleEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { documentId: "doc-db-1", reason: { startsWith: "rendition converter-unavailable: pdf of v2." } },
    }));
  });

  it("keeps the PDF when only the text conversion fails", async () => {
    const { deps, events, upserts } = makeDeps({
      convert: vi.fn(async ({ to }: { to: string }) =>
        to === "pdf"
          ? { ok: true as const, data: { bytes: Buffer.from("%PDF"), mime: "application/pdf" } }
          : { ok: false as const, error: "exit 3", reason: "conversion-failed" as const },
      ) as never,
    });
    expect(await generateDocumentRenditions("ver-1", deps)).toEqual({ status: "failed", reason: "conversion-failed", kind: "plain_text" });
    expect(upserts).toHaveLength(1);
    expect(events[0]!.data).toMatchObject({ reason: "rendition conversion-failed: plain_text of v2. exit 3" });
  });

  it("records embedded-objects when the converter refuses an OpenDocument file with a chart (BI-BFF142A1)", async () => {
    const { deps, events, upserts } = makeDeps(
      {
        readBlob: vi.fn(async () => odfPackage("spreadsheet", CHART_OBJECT_PARTS)),
        convert: vi.fn(async () => ({ ok: false as const, error: "exit 3: source file could not be loaded", reason: "conversion-failed" as const })) as never,
      },
      versionRow({ contentFormat: "application/vnd.oasis.opendocument.spreadsheet" }),
    );
    expect(await generateDocumentRenditions("ver-1", deps)).toEqual({ status: "failed", reason: "embedded-objects", kind: "pdf" });
    expect(upserts).toHaveLength(0);
    const reason = String((events[0]!.data as Row).reason);
    expect(reason.startsWith("rendition embedded-objects: pdf of v2. This file contains embedded objects (such as charts)")).toBe(true);
    expect(reason).toContain("Embedded: Object 1/");
  });

  it("renders an OpenDocument file with a chart that the converter accepts, as before", async () => {
    const { deps } = makeDeps(
      { readBlob: vi.fn(async () => odfPackage("text", CHART_OBJECT_PARTS)) },
      versionRow({ contentFormat: "application/vnd.oasis.opendocument.text" }),
    );
    expect(await generateDocumentRenditions("ver-1", deps)).toEqual({ status: "rendered", kinds: ["pdf", "plain_text"] });
  });

  it("records an unreadable original blob instead of throwing", async () => {
    const { deps, events } = makeDeps({ readBlob: vi.fn(async () => { throw new Error("ENOENT"); }) });
    expect(await generateDocumentRenditions("ver-1", deps)).toEqual({ status: "failed", reason: "blob-unreadable", kind: "pdf" });
    expect(events[0]!.data).toMatchObject({ reason: "rendition blob-unreadable: pdf of v2. ENOENT" });
  });

  it("keeps oversized text inline only up to the inline limit", async () => {
    const big = "word ".repeat(40);
    const { deps, upserts } = makeDeps({
      convert: vi.fn(async ({ to }: { to: string }) =>
        to === "pdf"
          ? { ok: true as const, data: { bytes: Buffer.from("%PDF"), mime: "application/pdf" } }
          : { ok: true as const, data: { bytes: Buffer.from(big), mime: "text/plain; charset=utf-8" } },
      ) as never,
      inlineTextLimitBytes: 20,
    });
    await generateDocumentRenditions("ver-1", deps);
    const text = upserts.find((u) => (u.create as unknown as Row).renditionKind === "plain_text")!;
    expect(Buffer.byteLength(String((text.create as unknown as Row).contentText))).toBeLessThanOrEqual(20);
    expect(deps.storeBlob).toHaveBeenCalledWith(Buffer.from(big), "text/plain; charset=utf-8");
  });
});

describe("backfillDocumentRenditions", () => {
  it("does nothing, and records nothing, while the converter is unavailable", async () => {
    const { deps, db } = makeDeps({ availability: vi.fn(async () => ({ available: false, detail: "no docker socket" })) });
    expect(await backfillDocumentRenditions({}, deps)).toEqual({ status: "converter-unavailable", detail: "no docker socket", processed: 0, results: [] });
    expect(db.documentVersion.findMany).not.toHaveBeenCalled();
  });

  it("sweeps current office versions missing a rendition and PDFs missing text, bounded by the limit", async () => {
    const { deps, db } = makeDeps();
    db.documentVersion.findMany.mockResolvedValueOnce([{ id: "ver-1" }]);
    const outcome = await backfillDocumentRenditions({ limit: 5000 }, deps);

    expect(outcome.processed).toBe(1);
    expect(outcome.results).toEqual([{ documentVersionId: "ver-1", status: "rendered", kinds: ["pdf", "plain_text"] }]);
    const query = (db.documentVersion.findMany.mock.calls as unknown as unknown[][])[0]![0] as unknown as Row;
    expect(query.take).toBe(100);
    const where = query.where as unknown as { OR: Row[] } & Row;
    expect(where).toMatchObject({ contentBlobId: { not: null }, currentForDocuments: { some: {} } });
    expect(where.OR).toHaveLength(2);
    expect(where.OR[0]).toEqual({
      contentFormat: { in: expect.arrayContaining([DOCX]) },
      OR: [
        { renditions: { none: { renditionKind: "pdf" } } },
        { renditions: { none: { renditionKind: "plain_text" } } },
      ],
    });
    expect((where.OR[0]!.contentFormat as { in: string[] }).in).not.toContain(PDF);
    // A PDF original never gets a pdf rendition, so only a missing text one selects it.
    expect(where.OR[1]).toEqual({
      contentFormat: { in: [PDF] },
      renditions: { none: { renditionKind: "plain_text" } },
    });
  });
});
