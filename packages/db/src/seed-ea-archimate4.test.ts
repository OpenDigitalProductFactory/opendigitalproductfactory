import { describe, expect, it, vi } from "vitest";
const { types, typeUpsert } = vi.hoisted(() => {
  const types = new Map<string, Record<string, unknown>>();
  return { types, typeUpsert: vi.fn(async ({ create, update }) => {
    const id = create.slug;
    const row = types.has(id) ? { ...types.get(id), ...update } : { ...create, id };
    types.set(id, row);
    return row;
  }) };
});
vi.mock("./client", () => {
  const upsert = async ({ create }: { create: Record<string, unknown> }) => ({ ...create, id: create.slug ?? "fixture" });
  return { prisma: {
    eaNotation: { upsert },
    eaElementType: { upsert: typeUpsert, findUnique: async ({ where }: { where: { id: string } }) => types.get(where.id) },
    eaRelationshipType: { upsert },
    eaRelationshipRule: { upsert, findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
    eaDqRule: { findFirst: async () => null, create: async () => ({ id: "dq" }) },
    eaFrameworkMapping: { upsert }, eaTraversalPattern: { upsert },
  } };
});
import { seedEaArchimate4 } from "./seed-ea-archimate4";
import { validateEaLifecycle } from "./ea-validation";

describe("room carrier lifecycle seed", () => {
  it("permits reversible withdrawal on fresh and already seeded stage types", async () => {
    await seedEaArchimate4();
    expect(await validateEaLifecycle("value_stream_stage", "design", "inactive")).toEqual({ valid: true });
    types.get("value_stream_stage")!.validLifecycleStatuses = ["draft", "active"];
    await seedEaArchimate4();
    expect(await validateEaLifecycle("value_stream_stage", "design", "inactive")).toEqual({ valid: true });
    expect(await validateEaLifecycle("value_stream_stage", "retirement", "inactive")).toMatchObject({ valid: false });
  });
});

describe("typed metamodel rules (BI-52280538)", () => {
  it("prunes association rules the seed no longer declares and keeps the one ArchiMate defines", async () => {
    const { pruneRetiredAssociationRules } = await import("./seed-ea-archimate4");
    const { prisma } = await import("./client");
    const deleted: string[][] = [];
    const rule = prisma.eaRelationshipRule as unknown as { findMany: unknown; deleteMany: unknown };
    rule.findMany = async () => [
      { id: "keep", fromElementTypeId: "gap", toElementTypeId: "plateau" },
      { id: "stale", fromElementTypeId: "ai_coworker", toElementTypeId: "ea_control" },
    ];
    rule.deleteMany = async ({ where }: { where: { id: { in: string[] } } }) => {
      deleted.push(where.id.in);
      return { count: where.id.in.length };
    };
    const etMap = new Map([["gap", "gap"], ["plateau", "plateau"], ["ai_coworker", "ai_coworker"], ["ea_control", "ea_control"]]);
    const pruned = await pruneRetiredAssociationRules("n", "rt-assoc", [["gap", "plateau", "associated_with"], ["ai_coworker", "ea_control", "realizes"]], etMap);
    expect(pruned).toBe(1);
    expect(deleted).toEqual([["stale"]]);
  });
});
