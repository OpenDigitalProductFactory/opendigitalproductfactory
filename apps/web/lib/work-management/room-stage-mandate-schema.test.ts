import { describe, expect, it } from "vitest";
import { readCanonicalPrismaSchema } from "@dpf/db/schema-source";

import { loadScheduledRoomAuthority } from "./room-stage-mandate";
import { scheduledDeliveryFixture } from "./__fixtures__/scheduled-delivery-authority";

/**
 * BI-17238133. #6588 selected `ownerUserId` on Workroom, which has no such
 * field, so every scheduled Workroom run died at
 *   Unknown field `ownerUserId` for select statement on model `Workroom`
 * while the delivery suite passed: its fake db accepts any select. This suite
 * judges the selects the mandate actually sends against the canonical Prisma
 * schema (the same files `prisma generate` reads), relations included.
 */
type ModelFields = Map<string, string>; // field name -> base type name

function parseModels(schema: string): Map<string, ModelFields> {
  const models = new Map<string, ModelFields>();
  for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const fields: ModelFields = new Map();
    for (const line of match[2]!.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) continue;
      const parsed = /^([A-Za-z_]\w*)\s+([A-Za-z_]\w*)/.exec(trimmed);
      if (parsed) fields.set(parsed[1]!, parsed[2]!);
    }
    models.set(match[1]!, fields);
  }
  return models;
}

/** Every select key path that is not a real field of its model. */
function unknownSelectPaths(models: Map<string, ModelFields>, model: string, select: unknown, at = model): string[] {
  const fields = models.get(model);
  if (!fields) return [`${at} (model not found)`];
  const misses: string[] = [];
  for (const [key, value] of Object.entries(select as Record<string, unknown>)) {
    const type = fields.get(key);
    if (!type) { misses.push(`${at}.${key}`); continue; }
    if (value && typeof value === "object" && "select" in value) {
      misses.push(...unknownSelectPaths(models, type, (value as { select: unknown }).select, `${at}.${key}`));
    }
  }
  return misses;
}

const selectOf = (call: unknown[] | undefined) => (call?.[0] as { select: unknown }).select;

describe("scheduled room mandate selects only real schema fields (BI-17238133)", () => {
  const models = parseModels(readCanonicalPrismaSchema());

  it("parsed the models this read uses", () => {
    expect(models.get("Workroom")?.has("capsuleId")).toBe(true);
    expect(models.get("TaskRun")?.has("taskRunId")).toBe(true);
    expect(models.get("ScheduledAgentTask")?.has("ownerUserId")).toBe(true);
    expect(models.get("Workroom")?.has("ownerUserId")).toBe(false);
  });

  it("every select the delivery authority sends exists on its model", async () => {
    const f = scheduledDeliveryFixture();
    await loadScheduledRoomAuthority(f.db, f.input, f.deps);
    const sent: Array<[string, unknown]> = [
      ["Workroom", selectOf(f.db.workroom.findMany.mock.calls[0])],
      ["TaskRun", selectOf(f.db.taskRun.findUnique.mock.calls[0])],
      ["ScheduledAgentTask", selectOf(f.db.scheduledAgentTask.findUnique.mock.calls[0])],
    ];
    for (const [, select] of sent) expect(select).toBeTruthy();
    expect(sent.flatMap(([model, select]) => unknownSelectPaths(models, model, select))).toEqual([]);
  });
});
