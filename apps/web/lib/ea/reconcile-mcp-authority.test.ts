import { describe, expect, it, vi } from "vitest";
import { reconcileMcpAuthorityModel } from "./reconcile-mcp-authority";

// Small fixture map: pkg + default-deny + 3 grants + 3 tools = 8 elements.
const MAP = {
  create_backlog_item: ["backlog_write"],
  query_backlog: ["backlog_read"],
  multi_tool: ["backlog_write", "build_evidence"],
};

type ExistingEl = { id: string; infraCiKey: string; properties: Record<string, unknown> };

// A mock prisma client, injected via opts.db — no vi.mock("@dpf/db"), so nothing
// can bleed across files under the forks pool.
function makeDb(existing: ExistingEl[] = [], opts: { notation?: boolean; relExists?: boolean; viewExists?: boolean } = {}) {
  return {
    eaNotation: { findUnique: vi.fn().mockResolvedValue(opts.notation === false ? null : { id: "n-sysml2" }) },
    eaElementType: { findUniqueOrThrow: vi.fn(async (a: { where: { notationId_slug: { slug: string } } }) => ({ id: `et-${a.where.notationId_slug.slug}` })) },
    eaRelationshipType: { findUniqueOrThrow: vi.fn(async (a: { where: { notationId_slug: { slug: string } } }) => ({ id: `rt-${a.where.notationId_slug.slug}` })) },
    eaElement: {
      findMany: vi.fn().mockResolvedValue(existing),
      create: vi.fn(async (a: { data: { infraCiKey: string } }) => ({ id: `el-${a.data.infraCiKey}` })),
      update: vi.fn(async (a: { where: { id: string } }) => ({ id: a.where.id })),
    },
    eaRelationship: {
      findFirst: vi.fn().mockResolvedValue(opts.relExists ? { id: "rel-1" } : null),
      create: vi.fn().mockResolvedValue({}),
    },
    viewpointDefinition: { findUnique: vi.fn().mockResolvedValue({ id: "vp-1" }) },
    eaView: {
      findFirst: vi.fn().mockResolvedValue(opts.viewExists ? { id: "view-1" } : null),
      create: vi.fn().mockResolvedValue({ id: "view-1" }),
    },
    eaViewElement: { upsert: vi.fn().mockResolvedValue({}) },
  };
}

describe("reconcileMcpAuthorityModel", () => {
  it("creates the full projection on first run", async () => {
    const db = makeDb([]);
    const r = await reconcileMcpAuthorityModel({ toolToGrants: MAP, db: db as never });
    expect(r.status).toBe("applied");
    expect(r.toolCount).toBe(3);
    expect(r.grantCount).toBe(3);
    expect(r.created).toBe(8); // pkg + default-deny + 3 grants + 3 tools
    expect(r.updated).toBe(0);
    expect(r.removed).toBe(0);
    expect(db.eaElement.create).toHaveBeenCalledTimes(8);
    expect(db.eaView.create).toHaveBeenCalledTimes(1);
    expect(db.eaViewElement.upsert).toHaveBeenCalledTimes(8);
  });

  it("is idempotent: re-run updates existing, creates no duplicates", async () => {
    const existing: ExistingEl[] = [
      "mcp:pkg", "mcp:constraint:default-deny",
      "mcp:grant:backlog_read", "mcp:grant:backlog_write", "mcp:grant:build_evidence",
      "mcp:tool:create_backlog_item", "mcp:tool:query_backlog", "mcp:tool:multi_tool",
    ].map((k) => ({ id: `el-${k}`, infraCiKey: k, properties: {} }));
    const db = makeDb(existing, { relExists: true, viewExists: true });
    const r = await reconcileMcpAuthorityModel({ toolToGrants: MAP, db: db as never });
    expect(r.created).toBe(0);
    expect(r.updated).toBe(8);
    expect(r.removed).toBe(0);
    expect(db.eaElement.create).not.toHaveBeenCalled();
    expect(db.eaRelationship.create).not.toHaveBeenCalled();
    expect(db.eaView.create).not.toHaveBeenCalled();
  });

  it("soft-removes a tool that disappeared from the registry (never hard-delete)", async () => {
    const existing: ExistingEl[] = [{ id: "el-gone", infraCiKey: "mcp:tool:removed_tool", properties: {} }];
    const db = makeDb(existing);
    const r = await reconcileMcpAuthorityModel({ toolToGrants: MAP, db: db as never });
    expect(r.removed).toBe(1);
    const softRemove = db.eaElement.update.mock.calls.find(
      ([a]) => (a as { where: { id: string } }).where.id === "el-gone"
    );
    expect(softRemove).toBeDefined();
    expect((softRemove![0] as unknown as { data: { properties: { mirrorRemoved: boolean } } }).data.properties.mirrorRemoved).toBe(true);
  });

  it("skips cleanly when the sysml2 notation is not seeded", async () => {
    const db = makeDb([], { notation: false });
    const r = await reconcileMcpAuthorityModel({ toolToGrants: MAP, db: db as never });
    expect(r.status).toBe("skipped");
    expect(db.eaElement.create).not.toHaveBeenCalled();
  });
});
