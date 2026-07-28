import { createHash, randomUUID } from "node:crypto";

import { Prisma } from "@dpf/db";

import {
  canonicalOperationEnvelopeHash,
  type DataControlOperationEnvelope,
  type DataControlOperationStatus,
} from "./control-operation-domain";

export type StoredDataControlOperation = {
  operationId: string;
  organizationId: string;
  idempotencyKey: string;
  envelopeHash: string;
  status: DataControlOperationStatus;
  authorizationBindingHash: string | null;
  authorizationConsumedAt: Date | null;
};

export type PlanOperationInput = {
  envelope: DataControlOperationEnvelope;
  envelopeHash: string;
  idempotencyKey: string;
};

export interface DataControlOperationStore {
  findByIdempotency(
    organizationId: string,
    idempotencyKey: string,
  ): Promise<StoredDataControlOperation | null>;
  createPlanned(input: PlanOperationInput): Promise<StoredDataControlOperation>;
  authorize(
    operationId: string,
    input: {
      authorizationDecisionId: string;
      authorizationBindingHash: string;
      authorizedAt: Date;
    },
  ): Promise<StoredDataControlOperation>;
  consumeAuthorization(
    operationId: string,
    input: {
      expectedBindingHash: string;
      expectedEnvelopeHash: string;
      consumedAt: Date;
    },
  ): Promise<boolean>;
}

export type DataControlPersistenceClient = Pick<
  Prisma.TransactionClient,
  "dataControlOperation"
>;

function toJsonInput(value: unknown) {
  if (value === null) return Prisma.JsonNull;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new TypeError("data_control_envelope_contains_non_json_value");
  }
  return JSON.parse(encoded) as Prisma.InputJsonValue;
}

function storedOperation(row: {
  operationId: string;
  organizationId: string;
  idempotencyKey: string;
  envelopeHash: string;
  status: string;
  authorizationBindingHash: string | null;
  authorizationConsumedAt: Date | null;
}): StoredDataControlOperation {
  return {
    ...row,
    status: row.status as DataControlOperationStatus,
  };
}

export class DataControlOperationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataControlOperationConflictError";
  }
}

export class DataControlAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataControlAuthorizationError";
  }
}

export async function planDataControlOperation(input: {
  store: DataControlOperationStore;
  envelope: DataControlOperationEnvelope;
  idempotencyKey: string;
}): Promise<{ operation: StoredDataControlOperation; replayed: boolean }> {
  const envelopeHash = canonicalOperationEnvelopeHash(input.envelope);
  const existing = await input.store.findByIdempotency(
    input.envelope.organizationId,
    input.idempotencyKey,
  );
  if (existing) {
    if (existing.envelopeHash !== envelopeHash) {
      throw new DataControlOperationConflictError(
        "data_control_idempotency_envelope_mismatch",
      );
    }
    return { operation: existing, replayed: true };
  }
  const operation = await input.store.createPlanned({
    envelope: input.envelope,
    envelopeHash,
    idempotencyKey: input.idempotencyKey,
  });
  return { operation, replayed: false };
}

/**
 * Adapt either a Prisma transaction client or the root client. Callers that
 * mutate a source row must construct this store from their existing transaction
 * so source truth and the target-step outbox commit atomically.
 */
export function createPrismaDataControlOperationStore(
  db: DataControlPersistenceClient,
): DataControlOperationStore {
  const select = {
    operationId: true,
    organizationId: true,
    idempotencyKey: true,
    envelopeHash: true,
    status: true,
    authorizationBindingHash: true,
    authorizationConsumedAt: true,
  };
  return {
    findByIdempotency: async (organizationId, idempotencyKey) => {
      const row = await db.dataControlOperation.findUnique({
        where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } },
        select,
      });
      return row ? storedOperation(row) : null;
    },
    createPlanned: async (input) => {
      const operationId = `DCO-${randomUUID()}`;
      const row = await db.dataControlOperation.create({
        data: {
          operationId,
          organizationId: input.envelope.organizationId,
          actorType: input.envelope.actorType,
          actorRef: input.envelope.actorRef,
          actorAuthority: toJsonInput(input.envelope.actorAuthority),
          actionKey: input.envelope.actionKey,
          purposeOfUse: input.envelope.purposeOfUse,
          inputHash: input.envelope.inputHash,
          envelopeHash: input.envelopeHash,
          assetRefs: [...input.envelope.assetRefs],
          fieldRefs: [...input.envelope.fieldRefs],
          classificationRefs: [...input.envelope.classificationRefs],
          policyVersions: toJsonInput(input.envelope.policyVersions),
          holdRevisions: toJsonInput(input.envelope.holdRevisions),
          approvals: toJsonInput(input.envelope.approvals),
          risk: toJsonInput(input.envelope.risk),
          idempotencyKey: input.idempotencyKey,
          steps: {
            create: [...input.envelope.targets]
              .sort((left, right) => left.targetKey.localeCompare(right.targetKey))
              .map((target, sequence) => ({
                stepId: `DCOS-${randomUUID()}`,
                targetKey: target.targetKey,
                targetType: target.targetType,
                pepKey: target.pepKey,
                sequence,
                compensable: target.compensable,
                idempotencyKey: `${operationId}:${target.targetKey}`,
                compensationKey: target.compensable
                  ? `${operationId}:${target.targetKey}:compensate`
                  : null,
              })),
          },
        },
        select,
      });
      return storedOperation(row);
    },
    authorize: async (operationId, input) => {
      const updated = await db.dataControlOperation.updateMany({
        where: {
          operationId,
          status: "planned",
          authorizationBindingHash: null,
          authorizationConsumedAt: null,
        },
        data: {
          status: "authorized",
          authorizationDecisionId: input.authorizationDecisionId,
          authorizationBindingHash: input.authorizationBindingHash,
          authorizedAt: input.authorizedAt,
        },
      });
      if (updated.count !== 1) {
        throw new DataControlAuthorizationError(
          "data_control_authorization_compare_and_set_failed",
        );
      }
      const operation = await db.dataControlOperation.findUnique({
        where: { operationId },
        select,
      });
      if (!operation) throw new Error("data_control_operation_not_found");
      return storedOperation(operation);
    },
    consumeAuthorization: async (operationId, input) => {
      const updated = await db.dataControlOperation.updateMany({
        where: {
          operationId,
          status: "authorized",
          envelopeHash: input.expectedEnvelopeHash,
          authorizationBindingHash: input.expectedBindingHash,
          authorizationConsumedAt: null,
        },
        data: {
          status: "executing",
          authorizationConsumedAt: input.consumedAt,
          startedAt: input.consumedAt,
        },
      });
      return updated.count === 1;
    },
  };
}

export async function authorizeDataControlOperation(input: {
  store: DataControlOperationStore;
  operation: StoredDataControlOperation;
  authorizationDecisionId: string;
  targetPepKeys: readonly string[];
  now?: Date;
}): Promise<StoredDataControlOperation> {
  if (input.operation.status !== "planned") {
    throw new DataControlAuthorizationError(
      "data_control_operation_not_planned",
    );
  }
  const authorizationBindingHash = buildAuthorizationBindingHash({
    operationId: input.operation.operationId,
    envelopeHash: input.operation.envelopeHash,
    authorizationDecisionId: input.authorizationDecisionId,
    targetPepKeys: input.targetPepKeys,
  });
  return input.store.authorize(input.operation.operationId, {
    authorizationDecisionId: input.authorizationDecisionId,
    authorizationBindingHash,
    authorizedAt: input.now ?? new Date(),
  });
}

export function buildAuthorizationBindingHash(input: {
  operationId: string;
  envelopeHash: string;
  authorizationDecisionId: string;
  targetPepKeys: readonly string[];
}): string {
  return createHash("sha256")
    .update(JSON.stringify({
      operationId: input.operationId,
      envelopeHash: input.envelopeHash,
      authorizationDecisionId: input.authorizationDecisionId,
      targetPepKeys: [...input.targetPepKeys].sort(),
    }))
    .digest("hex");
}

export async function consumeDataControlAuthorization(input: {
  store: DataControlOperationStore;
  operation: StoredDataControlOperation;
  revalidate: (
    operation: StoredDataControlOperation,
  ) => Promise<{
    allowed: boolean;
    envelopeHash: string;
    authorizationBindingHash: string;
  }>;
  now?: Date;
}): Promise<void> {
  if (
    input.operation.status !== "authorized" ||
    !input.operation.authorizationBindingHash ||
    input.operation.authorizationConsumedAt
  ) {
    throw new DataControlAuthorizationError(
      "data_control_authorization_not_consumable",
    );
  }
  const current = await input.revalidate(input.operation);
  if (
    !current.allowed ||
    current.envelopeHash !== input.operation.envelopeHash ||
    current.authorizationBindingHash !==
      input.operation.authorizationBindingHash
  ) {
    throw new DataControlAuthorizationError(
      "data_control_authorization_stale_or_mismatched",
    );
  }
  const consumed = await input.store.consumeAuthorization(
    input.operation.operationId,
    {
      expectedBindingHash: input.operation.authorizationBindingHash,
      expectedEnvelopeHash: input.operation.envelopeHash,
      consumedAt: input.now ?? new Date(),
    },
  );
  if (!consumed) {
    throw new DataControlAuthorizationError(
      "data_control_authorization_already_consumed",
    );
  }
}

export type ClaimedDataControlStep = {
  stepId: string;
  operationId: string;
  targetKey: string;
  idempotencyKey: string;
};

export async function executeDataControlStep(input: {
  step: ClaimedDataControlStep;
  effect: (input: ClaimedDataControlStep) => Promise<unknown>;
  verify: (
    input: ClaimedDataControlStep & { targetReceipt: unknown },
  ) => Promise<{ verified: boolean; evidence: unknown }>;
  persistApplied: (stepId: string, receipt: unknown) => Promise<void>;
  persistVerified: (stepId: string, evidence: unknown) => Promise<void>;
}): Promise<{ status: "applied" | "verified"; verified: boolean }> {
  const targetReceipt = await input.effect(input.step);
  await input.persistApplied(input.step.stepId, targetReceipt);
  const verification = await input.verify({
    ...input.step,
    targetReceipt,
  });
  if (!verification.verified) return { status: "applied", verified: false };
  await input.persistVerified(input.step.stepId, verification.evidence);
  return { status: "verified", verified: true };
}
