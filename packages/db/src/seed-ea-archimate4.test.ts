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
    eaRelationshipType: { upsert }, eaRelationshipRule: { upsert },
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
