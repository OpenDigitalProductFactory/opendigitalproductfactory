// BI-957915CB AC-DPF-1/2 through MCP: the doc_* tools, run end to end over the
// real document store, refuse a restricted document to a person with no owner,
// creator or grant match, and serve it to one with a match. The viewer is the
// acting USER: the same coworker acting for two people sees two different
// stores.
import { beforeEach, describe, expect, it, vi } from "vitest";

const world = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@dpf/db", () => ({
  get prisma() {
    return world.db;
  },
  DocumentRenditionKind: { pdf: "pdf", docx: "docx", odt: "odt", plain_text: "plain_text", preview: "preview" },
}));
vi.mock("@dpf/db/graph-sync", () => ({ syncDocumentReference: vi.fn(async () => undefined) }));
const semanticHits = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock("@/lib/documents/embeddings", () => ({
  storeDocumentVector: vi.fn(async () => false),
  searchDocumentVectors: vi.fn(async () => semanticHits.ids.map((documentId) => ({ id: documentId, documentId, title: "", contentPreview: "", score: 0.9 }))),
}));
vi.mock("@/lib/documents/rendition-trigger", () => ({ requestDocumentRenditions: vi.fn(async () => true) }));
vi.mock("@/lib/identity/principal-linking", async () => {
  const { PRINCIPAL_BY_USER } = await import("@/lib/documents/document-isolation.test-support");
  return {
    resolvePrincipalRecordIdForSessionIdentity: vi.fn(async ({ id }: { id: string }) => PRINCIPAL_BY_USER[id] ?? null),
    ensureAgentPrincipalIdentity: vi.fn(async () => ({ id: "p-coworker" })),
    syncUserPrincipal: vi.fn(async (userId: string) => ({ id: PRINCIPAL_BY_USER[userId] ?? "p-none" })),
  };
});

import { documentPack } from "./document-pack";
import { ALLOWED_USERS, createDocumentWorld, REFUSED_USERS, type FakeDocumentWorld } from "@/lib/documents/document-isolation.test-support";

let current: FakeDocumentWorld;
beforeEach(() => {
  current = createDocumentWorld();
  world.db = current.db;
  semanticHits.ids = ["DOC-SECRET"];
});

const COWORKER = { agentId: "AGT-SHARED" };
const run = (tool: string, params: Record<string, unknown>, userId: string) => documentPack.handlers[tool]!(params, userId, COWORKER);

describe.each(REFUSED_USERS)("a coworker acting for %s, who may not read DOC-SECRET", (userId) => {
  it("doc_load answers not found", async () => {
    expect(await run("doc_load", { documentId: "DOC-SECRET" }, userId)).toMatchObject({ success: false, error: "Document not found." });
  });

  it("doc_search leaves it out of hybrid, semantic and full-text results", async () => {
    for (const mode of ["hybrid", "semantic", "full-text", "metadata"]) {
      const result = await run("doc_search", { query: "salary", mode }, userId);
      expect(result.message, mode).not.toContain("DOC-SECRET");
      expect(JSON.stringify(result.data), mode).not.toContain("Board salary review");
    }
  });

  it("doc_version_list and doc_list_references return nothing for it, and other documents' references omit it", async () => {
    expect((await run("doc_version_list", { documentId: "DOC-SECRET" }, userId)).data).toEqual({ versions: [] });
    expect((await run("doc_list_references", { documentId: "DOC-SECRET" }, userId)).data).toEqual({ inbound: [], outbound: [] });
    expect(JSON.stringify((await run("doc_list_references", { documentId: "DOC-PUBLIC" }, userId)).data)).not.toContain("DOC-SECRET");
  });

  it("doc_save, doc_state_change and doc_link cannot touch it", async () => {
    await expect(run("doc_save", { documentId: "DOC-SECRET", title: "t", documentKind: "report", contentFormat: "text/plain", contentText: "x" }, userId)).rejects.toThrow(/not found/i);
    await expect(run("doc_state_change", { documentId: "DOC-SECRET", toState: "archived" }, userId)).rejects.toThrow(/not found/i);
    await expect(run("doc_link", { sourceDocumentId: "DOC-SECRET", targetDocumentId: "DOC-PUBLIC", refType: "cites" }, userId)).rejects.toThrow(/not found/i);
    expect(current.secret.currentState).toBe("draft");
  });
});

describe.each(ALLOWED_USERS)("a coworker acting for %s, who may read DOC-SECRET", (userId) => {
  it("loads, finds and lists it", async () => {
    expect(await run("doc_load", { documentId: "DOC-SECRET" }, userId)).toMatchObject({ success: true, entityId: "DOC-SECRET" });
    expect((await run("doc_search", { query: "salary", mode: "semantic" }, userId)).message).toContain("DOC-SECRET");
    expect(((await run("doc_version_list", { documentId: "DOC-SECRET" }, userId)).data as { versions: unknown[] }).versions).toHaveLength(1);
  });
});

describe("a restricted document a coworker saves for a person", () => {
  it("is owned by that person, so they can open it and a stranger cannot", async () => {
    const saved = await run("doc_save", { title: "My plan", documentKind: "plan", contentFormat: "text/plain", contentText: "x", accessScope: "restricted" }, "u-stranger");
    const documentId = saved.entityId!;
    expect(current.documents.find((doc) => doc.documentId === documentId)).toMatchObject({ ownerPrincipalId: "p-stranger", createdByPrincipalId: "p-coworker" });
    expect((await run("doc_load", { documentId }, "u-stranger")).success).toBe(true);
    expect((await run("doc_load", { documentId }, "u-grantee")).success).toBe(false);
  });
});
