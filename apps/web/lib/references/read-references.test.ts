import { describe, expect, it, vi } from "vitest";

import { PERSON_CORPUS_SCOPE, type CorpusReadScope } from "@/lib/tak/corpus-read-scope";

import {
  listInbound,
  listOutbound,
  resolveReadableEntityHrefs,
  type ReferenceReadDb,
  type ReferenceReader,
} from "./read-references";

// BI-A63A9476: one reader for every "Referenced by" surface (spec §3.4, R1).
// The fake edge table ignores the SQL push-down on purpose: every unreadable
// source below reaches the batch check, so these tests prove the batch check
// alone keeps it out. The push-down is asserted separately.

type Edge = { src_key: string; dst_key: string; props: Record<string, unknown> };

const TARGET = "BI-TARGET";
const edge = (src: string, sourceKind: string, extra: Record<string, unknown> = {}): Edge => ({
  src_key: src,
  dst_key: TARGET,
  props: { projection: "references", sourceKind, sourceScope: "install", sourceOrganizationId: null, writtenBy: "user:x", ...extra },
});

const EDGES: Edge[] = [
  edge("BI-OWN", "backlog", { sourceScope: "organization", sourceOrganizationId: "org-a" }),
  edge("BI-OTHERORG", "backlog", { sourceScope: "organization", sourceOrganizationId: "org-b" }),
  edge("BI-RESTRICTED", "backlog"),
  edge("EP-1", "epic"),
  edge("DOC-OWN", "document", { sourceScope: "organization", sourceOrganizationId: "org-a" }),
  edge("DOC-PRIVATE", "document", { sourceScope: "organization", sourceOrganizationId: "org-a" }),
  edge("msg-admitted", "message", { roomId: "room-in" }),
  edge("msg-locked", "message", { roomId: "room-out" }),
  edge("page-org", "wiki", { sourceScope: "organization", sourceOrganizationId: "org-a" }),
  edge("page-finance", "wiki", { sourceScope: "profession", sourceFamily: "finance" }),
  edge("page-security", "wiki", { sourceScope: "profession", sourceFamily: "security" }),
];

function fakeDb(): ReferenceReadDb {
  const backlog = [
    { itemId: "BI-OWN", title: "Own item", status: "open", organizationId: "org-a", sensitivity: "internal", body: "Depends on BI-TARGET today." },
    { itemId: "BI-OTHERORG", title: "Other estate", status: "open", organizationId: "org-b", sensitivity: "internal", body: "BI-TARGET" },
    { itemId: "BI-RESTRICTED", title: "Secret", status: "open", organizationId: null, sensitivity: "restricted", body: "BI-TARGET" },
    { itemId: "BI-TARGET", title: "Target", status: "open", organizationId: null, sensitivity: "internal", body: "See EP-1 and DOC-PRIVATE." },
  ];
  return {
    $queryRawUnsafe: vi.fn(async (sql: string, key: string) =>
      sql.includes("WHERE dst_key = $1") ? EDGES.filter((e) => e.dst_key === key) : EDGES.filter((e) => e.src_key === key).map((e) => ({ ...e, dst_key: e.dst_key })),
    ) as never,
    backlogItem: { findMany: vi.fn(async ({ where }) => backlog.filter((r) => (where.itemId.in as string[]).includes(r.itemId))) },
    epic: { findMany: vi.fn(async ({ where }) => [{ epicId: "EP-1", title: "Epic one", status: "open", description: "Tracks BI-TARGET." }].filter((r) => (where.epicId.in as string[]).includes(r.epicId))) },
    document: {
      findMany: vi.fn(async ({ where }) => {
        const rows = [
          { documentId: "DOC-OWN", title: "Runbook", currentState: "published", organizationId: "org-a", accessScope: "organization", currentVersion: { contentText: "Cites BI-TARGET." } },
          { documentId: "DOC-PRIVATE", title: "Board memo", currentState: "draft", organizationId: "org-a", accessScope: "restricted", currentVersion: { contentText: "BI-TARGET" } },
        ];
        // The real query adds readableDocumentWhere(viewer); this viewer holds no grant.
        return rows.filter((r) => (where.AND[0].documentId.in as string[]).includes(r.documentId) && r.accessScope === "organization" && r.organizationId === where.AND[1].organizationId);
      }),
    },
    wikiPage: {
      findMany: vi.fn(async ({ where }) =>
        [
          { id: "page-org", slug: "overlay/close", title: "Our close", status: "published", organizationId: "org-a", body: "Uses BI-TARGET." },
          { id: "page-finance", slug: "professions/finance/close", title: "Close craft", status: "published", organizationId: null, body: "BI-TARGET" },
          { id: "page-security", slug: "professions/security/ir", title: "IR craft", status: "published", organizationId: null, body: "BI-TARGET" },
        ].filter((r) => (where.id.in as string[]).includes(r.id)),
      ),
    },
    workroom: { findMany: vi.fn(async () => []) },
    workItemMessage: {
      findMany: vi.fn(async ({ where }) =>
        [
          { id: "msg-admitted", body: "Picked up BI-TARGET.", workItem: { capsules: [{ id: "room-in", capsuleId: "WC-IN", title: "Delivery room" }] } },
          { id: "msg-locked", body: "BI-TARGET", workItem: { capsules: [{ id: "room-out", capsuleId: "WC-OUT", title: "Locked room" }] } },
        ].filter((r) => (where.id.in as string[]).includes(r.id)),
      ),
    },
  };
}

const person: ReferenceReader = {
  kind: "person",
  userId: "u1",
  agentId: null,
  organizationId: "org-a",
  corpus: PERSON_CORPUS_SCOPE,
  canReadBacklog: true,
  clearance: new Set(["public", "internal"]),
  documentViewer: { principalId: "p1" },
};

const deps = () => ({ db: fakeDb(), canReadRoom: async (roomRowId: string) => roomRowId === "room-in" });

describe("listInbound — the R1 contract (AC-KLR-5)", () => {
  it("returns only sources the reader can open; another org, restricted sensitivity, a closed room and an unreadable document are absent, counts included", async () => {
    const page = await listInbound(TARGET, person, {}, deps());
    expect(page.rows.map((r) => r.key).sort()).toEqual(
      ["BI-OWN", "DOC-OWN", "EP-1", "msg-admitted", "page-finance", "page-org", "page-security"].sort(),
    );
    expect(page.count).toBe(7);
    const text = JSON.stringify(page);
    for (const hidden of ["Other estate", "Secret", "Board memo", "Locked room", "BI-OTHERORG", "BI-RESTRICTED", "DOC-PRIVATE", "msg-locked"]) {
      expect(text).not.toContain(hidden);
    }
  });

  it("each row has source, kind, scope and a snippet read from the source row now (AC-KLR-3)", async () => {
    const page = await listInbound(TARGET, person, {}, deps());
    expect(page.rows.find((r) => r.key === "BI-OWN")).toEqual({
      key: "BI-OWN",
      kind: "backlog",
      title: "Own item",
      status: "open",
      scope: "organization",
      href: "/ops?itemId=BI-OWN",
      snippet: "Depends on BI-TARGET today.",
    });
    expect(page.rows.find((r) => r.key === "msg-admitted")).toMatchObject({ kind: "message", title: "Delivery room", href: "/ops/workrooms#WC-IN" });
  });

  it("without snippets (the MCP shape) a row carries no body text", async () => {
    const page = await listInbound(TARGET, person, { snippets: false }, deps());
    expect(page.rows.every((r) => r.snippet === null)).toBe(true);
  });

  it("raising the reader's clearance admits the restricted item; a reader without backlog read sees no work records", async () => {
    const cleared = await listInbound(TARGET, { ...person, clearance: new Set(["public", "internal", "confidential", "restricted"]) }, {}, deps());
    expect(cleared.rows.map((r) => r.key)).toContain("BI-RESTRICTED");
    const noBacklog = await listInbound(TARGET, { ...person, canReadBacklog: false }, {}, deps());
    expect(noBacklog.rows.map((r) => r.kind)).not.toContain("backlog");
    expect(noBacklog.rows.map((r) => r.kind)).not.toContain("epic");
  });

  it("pushes the organization and corpus filters into SQL", async () => {
    const d = deps();
    await listInbound(TARGET, person, {}, d);
    const [sql, ...params] = vi.mocked(d.db.$queryRawUnsafe).mock.calls[0]!;
    expect(sql).toContain("props->>'sourceOrganizationId'");
    expect(sql).toContain("props->>'sourceFamily'");
    expect(params.slice(0, 4)).toEqual([TARGET, "org-a", true, null]);
  });
});

describe("listInbound — corpus grants for coworkers (AC-KLR-6)", () => {
  const agent = (corpus: CorpusReadScope): ReferenceReader => ({ ...person, kind: "agent", agentId: "a1", corpus });
  const financeAgent: CorpusReadScope = {
    kernel: true, organization: true, professionFamilies: new Set(["finance"]), familyKey: "finance", mapped: true, reportOnlyUnmapped: false,
  };

  it("a coworker sees profession pages only in its families, own family first", async () => {
    const page = await listInbound(TARGET, agent(financeAgent), {}, deps());
    const keys = page.rows.map((r) => r.key);
    expect(keys).toContain("page-finance");
    expect(keys).not.toContain("page-security");
    expect(keys[0]).toBe("page-finance");
  });

  it("with the organization corpus removed, no organization page is a far end", async () => {
    const page = await listInbound(TARGET, agent({ ...financeAgent, organization: false }), {}, deps());
    expect(page.rows.map((r) => r.key)).not.toContain("page-org");
  });

  it("with the profession grant revoked, no profession page is a far end", async () => {
    const page = await listInbound(TARGET, agent({ ...financeAgent, professionFamilies: new Set() }), {}, deps());
    expect(page.rows.some((r) => r.key.startsWith("page-finance") || r.key.startsWith("page-security"))).toBe(false);
  });
});

describe("listOutbound and the renderer's id resolution (AC-KLR-1)", () => {
  it("resolves only the ids the reader may open to hrefs", async () => {
    const hrefs = await resolveReadableEntityHrefs(["EP-1", "DOC-PRIVATE", "BI-OTHERORG", "BI-NOPE", "BI-OWN"], person, deps());
    expect(hrefs).toEqual({ "EP-1": "/ops#EP-1", "BI-OWN": "/ops?itemId=BI-OWN" });
  });

  it("listOutbound applies the same rules to targets", async () => {
    const d = deps();
    vi.mocked(d.db.$queryRawUnsafe).mockResolvedValueOnce([
      { src_key: TARGET, dst_key: "EP-1", props: { targetKind: "epic" } },
      { src_key: TARGET, dst_key: "DOC-PRIVATE", props: { targetKind: "document", targetOrganizationId: "org-a" } },
    ] as never);
    const page = await listOutbound(TARGET, person, {}, d);
    expect(page.rows.map((r) => r.key)).toEqual(["EP-1"]);
  });
});

describe("get_backlog_item referencedBy (AC-KLR-3)", () => {
  it("returns id, kind, title and scope only, never a snippet, under the same filter", async () => {
    const { referencedByForTool } = await import("./mcp-referenced-by");
    const rows = await referencedByForTool(TARGET, person, deps());
    expect(rows.find((r) => r.id === "BI-OWN")).toEqual({ id: "BI-OWN", kind: "backlog", title: "Own item", scope: "organization" });
    expect(rows.every((r) => Object.keys(r).sort().join(",") === "id,kind,scope,title")).toBe(true);
    expect(rows.map((r) => r.id)).not.toContain("BI-OTHERORG");
    expect(JSON.stringify(rows)).not.toContain("Depends on");
  });
});
