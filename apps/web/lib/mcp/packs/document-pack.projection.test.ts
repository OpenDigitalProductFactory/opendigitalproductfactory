// BI-CAP-3D434086: selected document reads must not repeat every old body.
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  loadManagedDocument: vi.fn(), saveManagedDocument: vi.fn(),
  searchManagedDocuments: vi.fn(), changeManagedDocumentState: vi.fn(),
  listManagedDocumentVersions: vi.fn(),
}));
vi.mock("@/lib/documents/document-store", () => store);
vi.mock("@/lib/documents/document-access", () => ({
  resolveDocumentViewer: vi.fn(async () => ({ principalId: "person-1" })),
}));
vi.mock("@/lib/identity/principal-linking", () => ({
  syncUserPrincipal: vi.fn(async () => ({ id: "person-1" })),
  ensureAgentPrincipalIdentity: vi.fn(async () => null),
}));
import { documentPack } from "./document-pack";

const version = (n: number, contentText: string) => ({
  id: `version-${n}`, version: n, title: `Title ${n}`, contentText,
  contentFormat: "text/plain", contentBlobId: null, contentSha256: "a".repeat(64),
  summary: "Saved version", sizeBytes: Buffer.byteLength(contentText),
  createdAt: new Date("2026-01-01T00:00:00Z"), renditions: [],
});
const old = version(1, "historical-body-".repeat(60_000));
const selected = version(2, "Complete selected body\nwith unicode: café.\n");
const document = {
  documentId: "DOC-PROJECTION", title: "Projection", currentState: "draft",
  currentVersionId: selected.id, currentVersion: selected, versions: [selected, old],
  tags: ["evidence"], lifecycleEvents: [],
};
const run = (tool: string, params: Record<string, unknown>) => documentPack.handlers[tool]!(params, "user-1");
beforeEach(() => {
  vi.clearAllMocks();
  store.loadManagedDocument.mockResolvedValue(document);
  store.saveManagedDocument.mockResolvedValue(document);
  store.searchManagedDocuments.mockResolvedValue([document]);
  store.changeManagedDocumentState.mockResolvedValue(document);
  store.listManagedDocumentVersions.mockResolvedValue(document.versions);
});

describe("managed document tool projection", () => {
  it.each([undefined, 2])("loads exact selected content without historical bodies (version=%s)", async (pinned) => {
    const result = await run("doc_load", { documentId: document.documentId, ...(pinned ? { version: pinned } : {}) });
    expect(result.success).toBe(true);
    const data = result.data as { document: Record<string, unknown>; renditions: unknown[] };
    expect(data.document.currentVersion).toEqual(selected);
    expect(data.document.currentVersionId).toBe(selected.id);
    expect(data.renditions).toEqual(selected.renditions);
    expect(JSON.stringify(data)).not.toContain("historical-body-");
    expect(data.document).not.toHaveProperty("versions");
    expect(JSON.stringify(data).length).toBeLessThan(2_000);
    expect(store.loadManagedDocument).toHaveBeenCalledWith({ documentId: document.documentId, version: pinned ?? null, viewer: { principalId: "person-1" } });
    expect(document.versions[1]).toBe(old);
  });

  it("preserves the body of a pinned older version without the newer body", async () => {
    store.loadManagedDocument.mockResolvedValue({ ...document, currentVersionId: old.id, currentVersion: old });
    const result = await run("doc_load", { documentId: document.documentId, version: 1 });
    const data = result.data as { document: Record<string, unknown> };
    expect(data.document.currentVersion).toEqual(old);
    expect(data.document.currentVersionId).toBe(old.id);
    expect(data.document).not.toHaveProperty("versions");
    expect(JSON.stringify(data)).not.toContain(selected.contentText);
  });

  it("lists version metadata without bodies, retaining identity and renditions", async () => {
    const result = await run("doc_version_list", { documentId: document.documentId });
    const data = result.data as { versions: Record<string, unknown>[] };
    expect(data.versions).toHaveLength(2);
    for (const [i, actual] of data.versions.entries()) {
      const { contentText: _body, ...metadata } = document.versions[i]!;
      expect(actual).toEqual(metadata);
      expect(actual).not.toHaveProperty("contentText");
    }
    expect(JSON.stringify(data).length).toBeLessThan(2_000);
    expect(document.versions[1]!.contentText).toBe(old.contentText);
  });

  it.each(["doc_save", "doc_search", "doc_state_change"])("%s returns the same selected-version projection", async (tool) => {
    const result = await run(tool, { documentId: document.documentId, title: "Projection", documentKind: "report", contentFormat: "text/plain", contentText: selected.contentText, toState: "review" });
    expect(result.success).toBe(true);
    const data = result.data as { document?: Record<string, unknown>; results?: Record<string, unknown>[] };
    const actual = tool === "doc_search" ? data.results![0]! : data.document!;
    expect(actual.currentVersion).toEqual(selected);
    expect(actual.tags).toEqual(document.tags);
    expect(actual).not.toHaveProperty("versions");
    expect(JSON.stringify(data)).not.toContain("historical-body-");
    expect(JSON.stringify(data).length).toBeLessThan(2_000);
  });

  it("retains the existing not-found response", async () => {
    store.loadManagedDocument.mockResolvedValue(null);
    expect(await run("doc_load", { documentId: "DOC-UNREADABLE" })).toMatchObject({ success: false, error: "Document not found." });
  });
});
