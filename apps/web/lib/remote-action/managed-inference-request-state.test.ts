import { expect, it, vi } from "vitest";
import { readManagedInferenceRequestState } from "./managed-inference-request-state";
import { createManagedInferenceRequestId } from "./managed-inference-request";

it("reads an original missing request only after acquiring the shared start/queue serialization lock", async () => {
  const order: string[] = [];
  const tx = { $executeRaw: vi.fn(async () => { order.push("lock"); }),
    remoteAction: { findUnique: vi.fn(async () => { order.push("action"); return null; }) },
    quiescenceRun: { findFirst: vi.fn(async () => { order.push("drain"); return null; }) },
    platformConfig: { findUnique: vi.fn(async () => ({ value: { level: "normal", runId: null } })) } };
  const db = { $transaction: async (body: (port: typeof tx) => Promise<unknown>) => body(tx) };
  const requestId = createManagedInferenceRequestId(Date.now() - 130000);
  const result = await readManagedInferenceRequestState({ requestId, db: db as never });
  expect(order[0]).toBe("lock");
  expect(result).toMatchObject({ requestId, recorded: false, state: "not-received", canSubmitNewRequest: true });
});
