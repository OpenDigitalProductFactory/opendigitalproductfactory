import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {},
  DocumentRenditionKind: { pdf: "pdf", plain_text: "plain_text", docx: "docx", odt: "odt" },
}));

import { exportDocumentVersion, isDocumentExportFormat, type DocumentExportDeps } from "./document-office-export";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type Row = Record<string, unknown>;

function versionRow(overrides: Row = {}): Row {
  return {
    id: "ver-3",
    version: 3,
    contentFormat: "text/markdown",
    contentText: "# Plan\n\n| A | B |\n| - | - |\n| 1 | 2 |",
    contentBlob: null,
    renditions: [],
    ...overrides,
  };
}

function makeDeps(version: Row | null = versionRow(), overrides: Partial<DocumentExportDeps> = {}) {
  const upserts: Row[] = [];
  const db = {
    document: {
      findUnique: vi.fn(async () => (version === null ? null : { title: "Q3 / Plan", currentVersion: version, versions: [version] })),
    },
    documentRendition: {
      upsert: vi.fn(async (args: Row) => {
        upserts.push(args);
        return { id: "r-1" };
      }),
    },
  };
  const deps: DocumentExportDeps = {
    db: db as never,
    convert: vi.fn(async ({ to }: { to: string }) => ({
      ok: true as const,
      data: { bytes: Buffer.from(`converted-${to}`), mime: to === "pdf" ? "application/pdf" : DOCX },
    })) as never,
    readBlob: vi.fn(async () => Buffer.from("stored bytes")),
    storeBlob: vi.fn(async () => ({ id: "blob-new" })),
    ...overrides,
  };
  return { deps, db, upserts };
}

describe("isDocumentExportFormat", () => {
  it("accepts docx, odt and pdf only", () => {
    expect(["docx", "odt", "pdf"].every(isDocumentExportFormat)).toBe(true);
    expect(isDocumentExportFormat("xlsx")).toBe(false);
    expect(isDocumentExportFormat("txt")).toBe(false);
  });
});

describe("exportDocumentVersion", () => {
  it("renders a markdown version to HTML, converts it, and stores the result as a rendition", async () => {
    const { deps, upserts } = makeDeps();
    const out = await exportDocumentVersion({ documentId: "DOC-1", format: "docx" }, deps);
    if (!out.ok) throw new Error(out.error);

    const call = vi.mocked(deps.convert).mock.calls[0]![0];
    expect(call.from).toBe("html");
    expect(call.to).toBe("docx");
    expect(call.input.toString("utf8")).toContain("<h1>Plan</h1>");
    expect(call.input.toString("utf8")).toContain("<td>2</td>");

    expect(upserts[0]).toMatchObject({
      where: { documentVersionId_renditionKind: { documentVersionId: "ver-3", renditionKind: "docx" } },
      create: { documentVersionId: "ver-3", renditionKind: "docx", blobId: "blob-new", contentText: null, mimeType: DOCX },
    });
    expect(out.data).toMatchObject({ format: "docx", version: 3, reused: false, filename: "Q3 - Plan.docx", mimeType: DOCX });
    expect(out.data.bytes.toString()).toBe("converted-docx");
  });

  it("reuses a stored rendition of the same kind without converting again", async () => {
    const { deps, upserts } = makeDeps(
      versionRow({ renditions: [{ renditionKind: "odt", mimeType: "application/vnd.oasis.opendocument.text", blob: { storageKey: "k", sha256: "s" } }] }),
    );
    const out = await exportDocumentVersion({ documentId: "DOC-1", format: "odt" }, deps);
    if (!out.ok) throw new Error(out.error);
    expect(out.data.reused).toBe(true);
    expect(out.data.bytes.toString()).toBe("stored bytes");
    expect(deps.convert).not.toHaveBeenCalled();
    expect(upserts).toHaveLength(0);
  });

  it("converts a stored word-processing file from its own format", async () => {
    const { deps } = makeDeps(versionRow({ contentFormat: DOCX, contentText: null, contentBlob: { storageKey: "k", sha256: "s" } }));
    const out = await exportDocumentVersion({ documentId: "DOC-1", format: "odt" }, deps);
    expect(out.ok).toBe(true);
    const call = vi.mocked(deps.convert).mock.calls[0]![0];
    expect(call).toMatchObject({ from: "docx", to: "odt" });
    expect(call.input.toString()).toBe("stored bytes");
  });

  it("refuses to turn a spreadsheet into a word-processing file but still offers its PDF", async () => {
    const { deps } = makeDeps(versionRow({ contentFormat: XLSX, contentText: null, contentBlob: { storageKey: "k", sha256: "s" } }));
    const docx = await exportDocumentVersion({ documentId: "DOC-1", format: "docx" }, deps);
    expect(docx).toMatchObject({ ok: false, reason: "not-exportable" });
    const pdf = await exportDocumentVersion({ documentId: "DOC-1", format: "pdf" }, deps);
    expect(pdf.ok).toBe(true);
    expect(vi.mocked(deps.convert).mock.calls[0]![0]).toMatchObject({ from: "xlsx", to: "pdf" });
  });

  it("passes a converter failure through with its typed reason and stores nothing", async () => {
    const { deps, upserts } = makeDeps(versionRow(), {
      convert: vi.fn(async () => ({ ok: false as const, error: "Document conversion is not available.", reason: "converter-unavailable" as const })) as never,
    });
    const out = await exportDocumentVersion({ documentId: "DOC-1", format: "pdf" }, deps);
    expect(out).toMatchObject({ ok: false, reason: "converter-unavailable" });
    expect(upserts).toHaveLength(0);
  });

  it("reports a missing document, a missing version and an empty version", async () => {
    expect(await exportDocumentVersion({ documentId: "DOC-X", format: "pdf" }, makeDeps(null).deps)).toMatchObject({ ok: false, reason: "not-found" });
    expect(await exportDocumentVersion({ documentId: "DOC-1", version: 9, format: "pdf" }, makeDeps().deps)).toMatchObject({ ok: false, reason: "not-found" });
    expect(
      await exportDocumentVersion({ documentId: "DOC-1", format: "pdf" }, makeDeps(versionRow({ contentText: "  " })).deps),
    ).toMatchObject({ ok: false, reason: "no-content" });
  });

  it("refuses a stored PDF or other binary as a source", async () => {
    const { deps } = makeDeps(versionRow({ contentFormat: "application/pdf", contentText: null, contentBlob: { storageKey: "k", sha256: "s" } }));
    expect(await exportDocumentVersion({ documentId: "DOC-1", format: "docx" }, deps)).toMatchObject({ ok: false, reason: "not-exportable" });
  });
});

describe("exportableFormats", () => {
  it("offers every format for text and word-processing versions and PDF only for other office files", async () => {
    const { exportableFormats } = await import("./document-office-export");
    expect(exportableFormats("text/markdown")).toEqual(["docx", "odt", "pdf"]);
    expect(exportableFormats("text/plain; charset=utf-8")).toEqual(["docx", "odt", "pdf"]);
    expect(exportableFormats(DOCX)).toEqual(["docx", "odt", "pdf"]);
    expect(exportableFormats(XLSX)).toEqual(["pdf"]);
    expect(exportableFormats("application/pdf")).toEqual([]);
    expect(exportableFormats("image/png")).toEqual([]);
  });
});
