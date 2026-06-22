import { describe, expect, it } from "vitest";

import { runDataModelMirror } from "./run-data-model-mirror";

const SCHEMA = `
model User {
  id    String @id
  posts Post[]
}
model Post {
  id       String @id
  authorId String
  author   User   @relation(fields: [authorId], references: [id])
}
`;

// Minimal in-memory prisma covering the mirror + steward surfaces.
function makeClient() {
  const elements = new Map<string, { id: string; properties: Record<string, unknown> }>();
  const relationships = new Map<string, { id: string; properties: Record<string, unknown> }>();
  const issues: Array<Record<string, unknown>> = [];
  let seq = 0;
  const id = (p: string) => `${p}-${++seq}`;
  const startsWith = (v: unknown, where: Record<string, unknown> | undefined) => {
    const p = (where?.properties as { string_starts_with?: string })?.string_starts_with;
    return p ? String((v as Record<string, unknown>).sourceKey ?? "").startsWith(p) : true;
  };
  const store = (m: Map<string, { id: string; properties: Record<string, unknown> }>, p: string) => ({
    findMany: async (a: Record<string, unknown>) =>
      [...m.values()].filter((r) => {
        const w = a.where as Record<string, unknown> | undefined;
        if (typeof w?.id === "string") return r.id === w.id;
        return startsWith(r.properties, w);
      }),
    create: async (a: Record<string, unknown>) => {
      const rid = id(p);
      m.set(rid, { id: rid, properties: ((a.data as Record<string, unknown>).properties ?? {}) as Record<string, unknown> });
      return { id: rid };
    },
    upsert: async (a: Record<string, unknown>) => {
      // Apply step only upserts genuinely-new (from,to,type) edges; create-semantics is faithful.
      const rid = id(p);
      const data = (a.create ?? a.data) as Record<string, unknown>;
      m.set(rid, { id: rid, properties: (data.properties ?? {}) as Record<string, unknown> });
      return { id: rid };
    },
    update: async (a: Record<string, unknown>) => {
      const rid = (a.where as { id: string }).id;
      const row = m.get(rid);
      const data = a.data as Record<string, unknown>;
      if (row && data.properties) row.properties = data.properties as Record<string, unknown>;
      return { id: rid };
    },
  });
  return {
    eaNotation: { findUnique: async () => ({ id: "n", slug: "archimate4" }) },
    eaElementType: { findUnique: async () => ({ id: "et", neoLabel: "ArchiMate__DataObject", slug: "data_object" }) },
    eaRelationshipType: { findUnique: async () => ({ id: "rt", neoType: "ASSOCIATED_WITH", slug: "associated_with" }) },
    viewpointDefinition: { upsert: async () => ({ id: "vp" }) },
    eaView: { findFirst: async () => null, create: async () => ({ id: "view" }) },
    eaElement: store(elements, "el"),
    eaRelationship: store(relationships, "rel"),
    eaViewElement: { findFirst: async () => null, create: async () => ({ id: id("vm") }) },
    eaSnapshot: { create: async (a: Record<string, unknown>) => { void a; return { id: id("snap") }; } },
    eaConformanceIssue: {
      findFirst: async () => null,
      findMany: async () => [],
      create: async (a: Record<string, unknown>) => { issues.push((a.data as Record<string, unknown>)); return { id: id("iss") }; },
      update: async () => ({ id: "iss" }),
    },
  };
}

describe("runDataModelMirror", () => {
  it("composes parse → reconcile → steward from an injected schema (Neo4j off)", async () => {
    const result = await runDataModelMirror({
      prisma: makeClient(),
      schemaSource: SCHEMA,
      syncNeo4j: false,
    });

    expect(result.mirror.status).toBe("applied");
    expect(result.mirror.summary.created).toBeGreaterThan(0);
    expect(result.steward).toBeDefined();
    expect(result.neo4jSynced).toBeNull();
  });
});
