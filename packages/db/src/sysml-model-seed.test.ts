import { describe, expect, it, vi } from "vitest";
import { applySysmlModel, type SysmlDesiredModel } from "./sysml-model-seed.js";

const MODEL: SysmlDesiredModel = {
  elements: [
    { sysmlKey: "x:pkg", typeSlug: "package", name: "P", description: "d" },
    { sysmlKey: "x:a", typeSlug: "part_definition", name: "A", description: "d" },
  ],
  relationships: [{ fromKey: "x:pkg", toKey: "x:a", relSlug: "contains" }],
  elementTypeSlugs: ["package", "part_definition"],
  relTypeSlugs: ["contains"],
  view: { name: "X View", description: "d", viewpointName: "System Decomposition & Interfaces", scopeRef: "x" },
  softRemovePrefix: "x:",
};

type ExistingEl = { id: string; infraCiKey: string; properties: Record<string, unknown> };

function makeDb(
  existing: ExistingEl[] = [],
  opts: { notation?: boolean; relExists?: boolean; viewExists?: boolean; crossTargets?: Record<string, string> } = {},
) {
  return {
    eaNotation: { findUnique: vi.fn().mockResolvedValue(opts.notation === false ? null : { id: "n" }) },
    eaElementType: { findUniqueOrThrow: vi.fn(async (a: { where: { notationId_slug: { slug: string } } }) => ({ id: `et-${a.where.notationId_slug.slug}` })) },
    eaRelationshipType: { findUniqueOrThrow: vi.fn(async (a: { where: { notationId_slug: { slug: string } } }) => ({ id: `rt-${a.where.notationId_slug.slug}` })) },
    eaElement: {
      findMany: vi.fn().mockResolvedValue(existing),
      // Resolves a cross-layer target by infraCiKey when opts.crossTargets maps it;
      // otherwise null (the prior behaviour every existing test relies on).
      findFirst: vi.fn(async (a: { where: { infraCiKey: string } }) => {
        const id = opts.crossTargets?.[a.where.infraCiKey];
        return id ? { id, elementTypeId: `et-${a.where.infraCiKey}` } : null;
      }),
      create: vi.fn(async (a: { data: { infraCiKey: string } }) => ({ id: `el-${a.data.infraCiKey}` })),
      update: vi.fn(async (a: { where: { id: string } }) => ({ id: a.where.id })),
    },
    eaRelationship: {
      findFirst: vi.fn().mockResolvedValue(
        opts.relExists ? { id: "r", properties: {}, notationSlug: "sysml2" } : null,
      ),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    eaRelationshipRule: {
      findFirst: vi.fn().mockResolvedValue({ id: "rule" }),
    },
    eaConformanceIssue: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
    viewpointDefinition: { findUnique: vi.fn().mockResolvedValue({ id: "vp" }) },
    eaView: {
      findFirst: vi.fn().mockResolvedValue(
        opts.viewExists
          ? { id: "v", description: "d", viewpointId: "vp", scopeRef: "x" }
          : null,
      ),
      create: vi.fn().mockResolvedValue({ id: "v" }),
      update: vi.fn().mockResolvedValue({ id: "v" }),
    },
    eaViewElement: {
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

describe("applySysmlModel", () => {
  it("creates elements, relationships, and a view on first run", async () => {
    const db = makeDb([]);
    const r = await applySysmlModel(MODEL, { db: db as never });
    expect(r.status).toBe("applied");
    expect(r.created).toBe(2);
    expect(r.updated).toBe(0);
    expect(db.eaRelationship.create).toHaveBeenCalledTimes(1);
    expect(db.eaView.create).toHaveBeenCalledTimes(1);
    expect(db.eaViewElement.upsert).toHaveBeenCalledTimes(2);
  });

  it("is idempotent: re-run updates existing and creates no duplicates", async () => {
    const existing: ExistingEl[] = [
      { id: "el-x:pkg", infraCiKey: "x:pkg", properties: {} },
      { id: "el-x:a", infraCiKey: "x:a", properties: {} },
    ];
    const db = makeDb(existing, { relExists: true, viewExists: true });
    const r = await applySysmlModel(MODEL, { db: db as never });
    expect(r.created).toBe(0);
    expect(r.updated).toBe(2);
    expect(db.eaElement.create).not.toHaveBeenCalled();
    expect(db.eaRelationship.create).not.toHaveBeenCalled();
    expect(db.eaView.create).not.toHaveBeenCalled();
  });

  it("soft-removes elements under the prefix that are no longer desired", async () => {
    const existing: ExistingEl[] = [{ id: "el-stale", infraCiKey: "x:stale", properties: {} }];
    const db = makeDb(existing);
    const r = await applySysmlModel(MODEL, { db: db as never });
    expect(r.removed).toBe(1);
    const call = db.eaElement.update.mock.calls.find(([a]) => (a as { where: { id: string } }).where.id === "el-stale");
    expect((call![0] as unknown as { data: { properties: { mirrorRemoved: boolean } } }).data.properties.mirrorRemoved).toBe(true);
    expect(db.eaViewElement.deleteMany).toHaveBeenCalledWith({
      where: {
        viewId: "v",
        elementId: { in: ["el-stale"] },
      },
    });
  });

  it("skips when the notation is not seeded", async () => {
    const db = makeDb([], { notation: false });
    const r = await applySysmlModel(MODEL, { db: db as never });
    expect(r.status).toBe("skipped");
    expect(db.eaElement.create).not.toHaveBeenCalled();
  });

  it("preserves per-element provenance (architect stays architect; otherwise deterministic)", async () => {
    const db = makeDb([]);
    const model: SysmlDesiredModel = {
      ...MODEL,
      softRemovePrefix: undefined,
      elements: [
        { sysmlKey: "x:pkg", typeSlug: "package", name: "P", description: "d", properties: { provenance: "architect", note: "judgment" } },
        { sysmlKey: "x:a", typeSlug: "part_definition", name: "A", description: "d", properties: { sourceKey: "file.ts" } },
      ],
    };
    await applySysmlModel(model, { db: db as never });
    const created = db.eaElement.create.mock.calls.map(([a]) => (a as { data: { infraCiKey: string; properties: Record<string, unknown> } }).data);
    expect(created.find((d) => d.infraCiKey === "x:pkg")!.properties.provenance).toBe("architect");
    expect(created.find((d) => d.infraCiKey === "x:a")!.properties.provenance).toBe("deterministic");
  });

  it("stamps a configurable lifecycle stage (default production)", async () => {
    const db = makeDb([]);
    await applySysmlModel({ ...MODEL, softRemovePrefix: undefined, lifecycleStage: "design" }, { db: db as never });
    const stages = db.eaElement.create.mock.calls.map(([a]) => (a as { data: { infraCiKey: string; lifecycleStage: string } }).data.lifecycleStage);
    expect(stages).toEqual(["design", "design"]);
  });

  it("files conformance issues idempotently when provided", async () => {
    const db = makeDb([]);
    const model: SysmlDesiredModel = {
      ...MODEL,
      softRemovePrefix: undefined,
      conformanceIssues: [{ onKey: "x:a", issueType: "drift-x", severity: "warn", message: "m" }],
    };
    await applySysmlModel(model, { db: db as never });
    expect(db.eaConformanceIssue.create).toHaveBeenCalledTimes(1);
    expect(db.eaConformanceIssue.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ issueType: "drift-x", elementId: "el-x:a", status: "open" }) })
    );

    // Re-run with the issue already present → no duplicate create.
    db.eaConformanceIssue.findFirst.mockResolvedValue({ id: "existing" });
    db.eaConformanceIssue.create.mockClear();
    await applySysmlModel(model, { db: db as never });
    expect(db.eaConformanceIssue.create).not.toHaveBeenCalled();
  });

  it("does not touch the conformance table when the model carries no issues", async () => {
    const db = makeDb([]);
    await applySysmlModel({ ...MODEL, softRemovePrefix: undefined }, { db: db as never });
    expect(db.eaConformanceIssue.findFirst).not.toHaveBeenCalled();
    expect(db.eaConformanceIssue.create).not.toHaveBeenCalled();
  });

  const crossModel: SysmlDesiredModel = {
    ...MODEL,
    softRemovePrefix: undefined,
    relTypeSlugs: ["contains", "allocates"],
    crossLayerRelationships: [{ fromKey: "x:a", toKey: "other:logical", relSlug: "allocates" }],
  };

  it("links a cross-layer edge to an element another projection owns (resolved by infraCiKey)", async () => {
    const db = makeDb([], { crossTargets: { "other:logical": "el-other" } });
    const r = await applySysmlModel(crossModel, { db: db as never });
    expect(r.crossLayerLinked).toBe(1);
    expect(r.crossLayerUnresolved).toBe(0);
    const xcall = db.eaRelationship.create.mock.calls.find(
      ([a]) => (a as { data: { toElementId: string } }).data.toElementId === "el-other",
    );
    expect(xcall).toBeTruthy();
    const data = (xcall![0] as { data: { fromElementId: string; relationshipTypeId: string; properties: { crossLayer: boolean } } }).data;
    expect(data.fromElementId).toBe("el-x:a"); // resolved in-model
    expect(data.relationshipTypeId).toBe("rt-allocates");
    expect(data.properties.crossLayer).toBe(true);
  });

  it("counts a cross-layer edge as unresolved (never silent) when the target is absent", async () => {
    const db = makeDb([], {}); // no crossTargets → target won't resolve
    const r = await applySysmlModel(
      { ...crossModel, crossLayerRelationships: [{ fromKey: "x:a", toKey: "missing:logical", relSlug: "allocates" }] },
      { db: db as never },
    );
    expect(r.crossLayerUnresolved).toBe(1);
    expect(r.crossLayerLinked).toBe(0);
    const xcall = db.eaRelationship.create.mock.calls.find(
      ([a]) => (a as { data: { toElementId: string } }).data.toElementId === "el-missing:logical",
    );
    expect(xcall).toBeFalsy(); // no phantom edge created
  });

  it("is idempotent for cross-layer edges: counts linked but creates no duplicate", async () => {
    const db = makeDb([], { crossTargets: { "other:logical": "el-other" } });
    db.eaRelationship.findFirst.mockResolvedValue({ id: "rx" }); // every edge already present
    const r = await applySysmlModel(crossModel, { db: db as never });
    expect(r.crossLayerLinked).toBe(1);
    expect(db.eaRelationship.create).not.toHaveBeenCalled();
  });

  it("resolves a dedicated cross-notation relationship type and preserves safe edge metadata", async () => {
    const db = makeDb([], { crossTargets: { "other:logical": "el-other" } });
    const model: SysmlDesiredModel = {
      ...MODEL,
      softRemovePrefix: undefined,
      crossLayerRelationships: [
        {
          fromKey: "x:a",
          toKey: "other:logical",
          relSlug: "sysml_allocates",
          relationshipNotationSlug: "dpf-cross-notation",
          properties: { sourceVersion: "2026-07-26.1", explanationCode: "allocated-to-realizer" },
        },
      ],
    };

    await applySysmlModel(model, { db: db as never });

    expect(db.eaNotation.findUnique).toHaveBeenCalledWith({
      where: { slug: "dpf-cross-notation" },
      select: { id: true },
    });
    expect(db.eaRelationshipType.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { notationId_slug: { notationId: "n", slug: "sysml_allocates" } },
      select: { id: true },
    });
    expect(db.eaRelationship.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        relationshipTypeId: "rt-sysml_allocates",
        notationSlug: "dpf-cross-notation",
        properties: {
          crossLayer: true,
          sourceVersion: "2026-07-26.1",
          explanationCode: "allocated-to-realizer",
        },
      }),
    });
  });

  it("persists relationship metadata used for conditional routing explanations", async () => {
    const db = makeDb([]);
    const model: SysmlDesiredModel = {
      ...MODEL,
      softRemovePrefix: undefined,
      relationships: [
        {
          fromKey: "x:pkg",
          toKey: "x:a",
          relSlug: "contains",
          properties: { conditionCode: "allow", ownerLabel: "Allowed by policy" },
        },
      ],
    };

    await applySysmlModel(model, { db: db as never });

    expect(db.eaRelationship.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        properties: { conditionCode: "allow", ownerLabel: "Allowed by policy" },
      }),
    });
  });

  it("rejects an explicit cross-notation edge when its seeded relationship rule is absent", async () => {
    const db = makeDb([], { crossTargets: { "other:logical": "el-other" } });
    db.eaRelationshipRule.findFirst.mockResolvedValue(null);
    const model: SysmlDesiredModel = {
      ...MODEL,
      softRemovePrefix: undefined,
      crossLayerRelationships: [
        {
          fromKey: "x:a",
          toKey: "other:logical",
          relSlug: "sysml_allocates",
          relationshipNotationSlug: "dpf-cross-notation",
        },
      ],
    };

    await expect(applySysmlModel(model, { db: db as never })).rejects.toThrow(
      /relationship rule not seeded/,
    );
    expect(db.eaRelationship.create).toHaveBeenCalledTimes(1);
  });
});
