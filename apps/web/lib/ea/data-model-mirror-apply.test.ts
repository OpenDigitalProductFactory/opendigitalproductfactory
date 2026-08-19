import { describe, expect, it } from "vitest";

import { parsePrismaSchema } from "../build/code-graph/extractors/prisma-schema-adapter";
import { reconcileDataModelMirror, type MirrorPrismaClient } from "./data-model-mirror-apply";
import { modelSourceKey } from "./data-model-mirror";

const SCHEMA = `
model User {
  id    String @id
  posts Post[]
}

model Post {
  id       String @id
  authorId String
  author   User   @relation(fields: [authorId], references: [id])
  @@index([authorId])
}
`;

type Row = { id: string; properties: Record<string, unknown> };

function matchesWhere(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  if (typeof where.id === "string") return row.id === where.id;
  const props = where.properties as { path?: string[]; string_starts_with?: string } | undefined;
  if (props?.path?.[0] === "sourceKey" && typeof props.string_starts_with === "string") {
    return String(row.properties.sourceKey ?? "").startsWith(props.string_starts_with);
  }
  return true;
}

/** In-memory MirrorPrismaClient backed by simple Maps. */
function makeClient(seed?: { elements?: Row[]; relationships?: Row[] }) {
  const elements = new Map<string, Row>((seed?.elements ?? []).map((r) => [r.id, r]));
  const relationships = new Map<string, Row>((seed?.relationships ?? []).map((r) => [r.id, r]));
  const viewElements: Array<{ viewId: string; elementId: string }> = [];
  const snapshots: Array<Record<string, unknown>> = [];
  const issues: Array<Record<string, unknown>> = [];
  let seq = 0;
  const nextId = (p: string) => `${p}-${++seq}`;

  const elementStore = (map: Map<string, Row>, prefix: string) => ({
    findMany: async (args: Record<string, unknown>) =>
      [...map.values()]
        .filter((r) => matchesWhere(r, args.where as Record<string, unknown>))
        .map((r) => ({ id: r.id, properties: r.properties })),
    create: async (args: Record<string, unknown>) => {
      const data = args.data as Record<string, unknown>;
      const id = nextId(prefix);
      map.set(id, { id, properties: (data.properties ?? {}) as Record<string, unknown> });
      return { id };
    },
    upsert: async (args: Record<string, unknown>) => {
      // The apply step only upserts genuinely-new (from,to,type) edges (plan create ops),
      // so create-semantics is faithful here; the DB unique key enforces real idempotency.
      const data = (args.create ?? args.data) as Record<string, unknown>;
      const id = nextId(prefix);
      map.set(id, { id, properties: (data.properties ?? {}) as Record<string, unknown> });
      return { id };
    },
    update: async (args: Record<string, unknown>) => {
      const id = (args.where as { id: string }).id;
      const data = args.data as Record<string, unknown>;
      const row = map.get(id);
      if (row && data.properties) row.properties = data.properties as Record<string, unknown>;
      return { id };
    },
  });

  const client: MirrorPrismaClient = {
    eaNotation: { findUnique: async () => ({ id: "not-1", slug: "archimate4" }) },
    eaElementType: { findUnique: async () => ({ id: "et-do", neoLabel: "ArchiMate__DataObject", slug: "data_object" }) },
    eaRelationshipType: { findUnique: async () => ({ id: "rt-assoc", neoType: "ASSOCIATED_WITH", slug: "associated_with" }) },
    viewpointDefinition: { upsert: async () => ({ id: "vp-1" }) },
    eaView: {
      findFirst: async () => null,
      create: async () => ({ id: "view-1" }),
    },
    eaElement: elementStore(elements, "el"),
    eaRelationship: elementStore(relationships, "rel"),
    eaViewElement: {
      findFirst: async (args: Record<string, unknown>) => {
        const w = args.where as { viewId: string; elementId: string };
        return viewElements.find((v) => v.viewId === w.viewId && v.elementId === w.elementId)
          ? { id: "vm" }
          : null;
      },
      create: async (args: Record<string, unknown>) => {
        const data = args.data as { viewId: string; elementId: string };
        viewElements.push({ viewId: data.viewId, elementId: data.elementId });
        return { id: nextId("vm") };
      },
    },
    eaSnapshot: {
      create: async (args: Record<string, unknown>) => {
        snapshots.push(args.data as Record<string, unknown>);
        return { id: nextId("snap") };
      },
    },
    eaConformanceIssue: {
      findFirst: async () => null,
      create: async (args: Record<string, unknown>) => {
        issues.push(args.data as Record<string, unknown>);
        return { id: nextId("issue") };
      },
    },
  };

  return { client, elements, relationships, viewElements, snapshots, issues };
}

const facts = parsePrismaSchema(SCHEMA);

describe("reconcileDataModelMirror", () => {
  it("first run creates data_object elements + relationships, view membership, and a snapshot", async () => {
    const m = makeClient();
    const result = await reconcileDataModelMirror({ prisma: m.client, facts });

    expect(result.status).toBe("applied");
    expect(result.snapshotWritten).toBe(true);
    expect(result.summary.created).toBeGreaterThan(0);

    // One element per model, keyed by stable source key.
    const sourceKeys = [...m.elements.values()].map((r) => r.properties.sourceKey);
    expect(sourceKeys).toEqual(expect.arrayContaining([modelSourceKey("User"), modelSourceKey("Post")]));
    expect(m.relationships.size).toBeGreaterThanOrEqual(2);
    expect(m.viewElements.length).toBe(2);
    expect(m.snapshots).toHaveLength(1);
  });

  it("is idempotent end-to-end — a second reconcile is a noop with no snapshot", async () => {
    const m = makeClient();
    await reconcileDataModelMirror({ prisma: m.client, facts });
    const elementsAfterFirst = m.elements.size;
    const snapshotsAfterFirst = m.snapshots.length;

    const second = await reconcileDataModelMirror({ prisma: m.client, facts });
    expect(second.status).toBe("noop");
    expect(second.snapshotWritten).toBe(false);
    expect(m.elements.size).toBe(elementsAfterFirst);
    expect(m.snapshots.length).toBe(snapshotsAfterFirst);
  });

  it("marks removed an element whose model left the schema", async () => {
    const m = makeClient({
      elements: [
        {
          id: "el-gone",
          properties: { sourceKey: modelSourceKey("Gone"), descriptor: "x", mirrorRemoved: false },
        },
      ],
    });
    await reconcileDataModelMirror({ prisma: m.client, facts });
    expect(m.elements.get("el-gone")?.properties.mirrorRemoved).toBe(true);
  });

  it("blocks and writes a conformance issue on a duplicate source key", async () => {
    const dupKey = modelSourceKey("User");
    const m = makeClient({
      elements: [
        { id: "dup-a", properties: { sourceKey: dupKey, descriptor: "a", mirrorRemoved: false } },
        { id: "dup-b", properties: { sourceKey: dupKey, descriptor: "b", mirrorRemoved: false } },
      ],
    });
    const result = await reconcileDataModelMirror({ prisma: m.client, facts });

    expect(result.status).toBe("blocked");
    expect(result.duplicateIssues).toBeGreaterThan(0);
    expect(m.issues.length).toBeGreaterThan(0);
    expect(m.issues[0].issueType).toBe("mirror-duplicate-source-key");
    // No new elements created while blocked (only the two seeded duplicates remain).
    expect(m.elements.size).toBe(2);
    expect(m.snapshots).toHaveLength(0);
  });
});
