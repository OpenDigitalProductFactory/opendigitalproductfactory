import { describe, expect, it, vi } from "vitest";

import {
  DataControlOperationConflictError,
  executeDataControlStep,
  planDataControlOperation,
  consumeDataControlAuthorization,
  type DataControlOperationStore,
  type StoredDataControlOperation,
} from "./control-operation";
import type { DataControlOperationEnvelope } from "./control-operation-domain";

const envelope: DataControlOperationEnvelope = {
  organizationId: "org-1",
  actorType: "user",
  actorRef: "user-1",
  actorAuthority: { roles: ["privacy-owner"] },
  actionKey: "data.subject.erase",
  purposeOfUse: "subject-request",
  inputHash: "a".repeat(64),
  assetRefs: ["data:agent-message"],
  fieldRefs: [],
  classificationRefs: ["restricted"],
  policyVersions: { erasure: "4" },
  holdRevisions: { legal: "none" },
  approvals: [{ approvalId: "APR-1" }],
  risk: { band: "high" },
  targets: [
    { targetKey: "postgres", targetType: "postgres", pepKey: "pep:postgres", compensable: false },
  ],
};

function store(operation?: StoredDataControlOperation): DataControlOperationStore {
  const current: StoredDataControlOperation = operation ?? {
    operationId: "DCO-1",
    organizationId: "org-1",
    idempotencyKey: "erase:subject-1",
    envelopeHash: "a".repeat(64),
    status: "planned",
    authorizationBindingHash: null,
    authorizationConsumedAt: null,
  };
  return {
    findByIdempotency: vi.fn(async () => operation ?? null),
    createPlanned: vi.fn(async (input): Promise<StoredDataControlOperation> => ({
      operationId: "DCO-1",
      organizationId: input.envelope.organizationId,
      idempotencyKey: input.idempotencyKey,
      envelopeHash: input.envelopeHash,
      status: "planned",
      authorizationBindingHash: null,
      authorizationConsumedAt: null,
    })),
    authorize: vi.fn(async (_operationId, input): Promise<StoredDataControlOperation> => ({
      ...current,
      status: "authorized",
      authorizationBindingHash: input.authorizationBindingHash,
    })),
    consumeAuthorization: vi.fn(async () => true),
  };
}

describe("data control operation service", () => {
  it("creates intent and target outbox rows through one store call", async () => {
    const db = store();
    const result = await planDataControlOperation({
      store: db,
      envelope,
      idempotencyKey: "erase:subject-1",
    });

    expect(result.replayed).toBe(false);
    expect(db.createPlanned).toHaveBeenCalledWith(expect.objectContaining({
      envelope,
      idempotencyKey: "erase:subject-1",
      envelopeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });

  it("replays the same envelope but rejects key reuse with changed intent", async () => {
    const first = await planDataControlOperation({
      store: store(),
      envelope,
      idempotencyKey: "erase:subject-1",
    });
    const replayStore = store(first.operation);
    expect((await planDataControlOperation({
      store: replayStore,
      envelope,
      idempotencyKey: "erase:subject-1",
    })).replayed).toBe(true);

    await expect(planDataControlOperation({
      store: replayStore,
      envelope: { ...envelope, inputHash: "b".repeat(64) },
      idempotencyKey: "erase:subject-1",
    })).rejects.toBeInstanceOf(DataControlOperationConflictError);
  });

  it("consumes authorization once only after current authority and holds revalidate", async () => {
    const operation: StoredDataControlOperation = {
      operationId: "DCO-1",
      organizationId: "org-1",
      idempotencyKey: "erase:subject-1",
      envelopeHash: "a".repeat(64),
      status: "authorized",
      authorizationBindingHash: "binding-1",
      authorizationConsumedAt: null,
    };
    const db = store(operation);
    const revalidate = vi.fn(async () => ({
      allowed: true,
      envelopeHash: operation.envelopeHash,
      authorizationBindingHash: "binding-1",
    }));

    await consumeDataControlAuthorization({
      store: db,
      operation,
      revalidate,
      now: new Date("2026-07-27T00:00:00Z"),
    });

    expect(revalidate).toHaveBeenCalledWith(operation);
    expect(db.consumeAuthorization).toHaveBeenCalledTimes(1);
  });

  it("records acknowledgement as applied and requires separate verifier evidence", async () => {
    const persistApplied = vi.fn(async () => undefined);
    const persistVerified = vi.fn(async () => undefined);
    const result = await executeDataControlStep({
      step: {
        stepId: "DCOS-1",
        operationId: "DCO-1",
        targetKey: "qdrant",
        idempotencyKey: "DCO-1:qdrant",
      },
      effect: vi.fn(async () => ({ providerStatus: 200 })),
      verify: vi.fn(async () => ({ verified: false, evidence: { remaining: 1 } })),
      persistApplied,
      persistVerified,
    });

    expect(result).toEqual({ status: "applied", verified: false });
    expect(persistApplied).toHaveBeenCalledWith("DCOS-1", { providerStatus: 200 });
    expect(persistVerified).not.toHaveBeenCalled();
  });

  it("passes the stable step idempotency key to duplicate deliveries", async () => {
    const effect = vi.fn(async () => ({ providerStatus: 200 }));
    const input = {
      step: {
        stepId: "DCOS-1",
        operationId: "DCO-1",
        targetKey: "postgres",
        idempotencyKey: "DCO-1:postgres",
      },
      effect,
      verify: vi.fn(async () => ({ verified: true, evidence: { absent: true } })),
      persistApplied: vi.fn(async () => undefined),
      persistVerified: vi.fn(async () => undefined),
    };

    await executeDataControlStep(input);
    await executeDataControlStep(input);
    expect(effect).toHaveBeenNthCalledWith(1, expect.objectContaining({
      idempotencyKey: "DCO-1:postgres",
    }));
    expect(effect).toHaveBeenNthCalledWith(2, expect.objectContaining({
      idempotencyKey: "DCO-1:postgres",
    }));
  });
});
