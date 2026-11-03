import { vi, type Mock } from "vitest";

/** Test support: existing scheduler suites use scalar Prisma stubs. Give their transactions
 * a persisted row snapshot so a binding write is visible to later settlement.
 * PostgreSQL suites independently verify real locking and rollback. */
export function installScheduledTaskTransactionFixture(db: {
  $transaction: Mock;
  scheduledAgentTask: { findUnique: Mock; update: Mock; updateMany: Mock };
  taskRun: { findUnique: Mock };
}) {
  let row: Record<string, unknown> | null = null;
  db.$transaction.mockImplementation(async callback => {
    if (!row) {
      const read = db.scheduledAgentTask.findUnique.mock.results.at(-1);
      row = structuredClone(read?.type === "return" ? await read.value : null);
    }
    const snapshot = row;
    const tx = { ...db,
      $queryRaw: vi.fn(async () => snapshot ? [{ taskId: snapshot.taskId }] : []),
      scheduledAgentTask: { ...db.scheduledAgentTask,
        findUnique: vi.fn(async () => structuredClone(snapshot)),
        update: async (args: { data: Record<string, unknown> }) => {
          const result = await db.scheduledAgentTask.update(args);
          if (snapshot) Object.assign(snapshot, args.data);
          return result;
        },
        updateMany: async (args: { data: Record<string, unknown> }) => {
          const result = await db.scheduledAgentTask.updateMany(args);
          if (result?.count === 1 && snapshot) Object.assign(snapshot, args.data);
          return result;
        },
      },
      taskRun: { ...db.taskRun, findUnique: vi.fn(async () => ({ userId: snapshot?.ownerUserId, status: "working" })) },
    };
    return callback(tx);
  });
}
