import type { Mock } from "vitest";

/** Project successful mock writes into later reads, including ownership fences. */
export function taskRunState(db: {
  persisted: Record<string, unknown>;
  findFirst: Mock;
  findUnique: Mock;
  update: Mock;
  updateMany: Mock;
}) {
  return {
    findFirst: (...args: unknown[]) => db.findFirst(...args),
    findUnique: async (...args: unknown[]) => {
      const row = await db.findUnique(...args);
      return row ? { ...row, ...db.persisted } : row;
    },
    update: async (args: { data: Record<string, unknown> }) => {
      const result = await db.update(args);
      Object.assign(db.persisted, args.data);
      return result;
    },
    updateMany: async (args: { data: Record<string, unknown> }) => {
      const result = await db.updateMany(args);
      if (result.count === 1) Object.assign(db.persisted, args.data);
      return result;
    },
  };
}
