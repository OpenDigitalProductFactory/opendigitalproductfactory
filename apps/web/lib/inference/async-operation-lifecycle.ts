import {
  canonicalAsyncOperationBindingDigest,
  canonicalAsyncOperationRequestDigest,
  type AsyncInferenceOperationStatus,
  type AsyncOperationBinding,
} from "./async-operation-contract";
import { parseDurableAsyncProviderContextInput } from "./async-operation-provider";

export interface AsyncOperationRecord {
  id: string;
  authorityScopeKey: string;
  requestKey: string;
  requestDigest: string;
  bindingDigest: string;
  providerId: string;
  modelId: string;
  contractFamily: string;
  screenedRequestContext: Record<string, unknown>;
  taskRunId: string | null;
  workroomId: string | null;
  status: AsyncInferenceOperationStatus;
  providerOperationId: string | null;
  checkpointSequence: number;
  transitionSequence: number;
  startClaimFence: number;
  startAttemptedAt: Date | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  cancelRequestedAt: Date | null;
  nextPollAt: Date | null;
  resultText: string | null;
  resultData: Record<string, unknown> | null;
  errorMessage: string | null;
  progressPct: number | null;
  progressMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date;
}

export interface CreateOrReplayAsyncOperationInput {
  binding: AsyncOperationBinding;
  authorityScopeKey: string;
  requestKey: string;
  requestDigest: string;
  bindingDigest: string;
  providerId: string;
  modelId: string;
  contractFamily: string;
  screenedRequestContext: Record<string, unknown>;
  expiresAt: Date;
}

export interface AsyncOperationAdmissionStore {
  createOrReplay(
    input: CreateOrReplayAsyncOperationInput,
  ): Promise<{ operation: AsyncOperationRecord; replayed: boolean }>;
}

export interface AsyncOperationAdmissionDependencies {
  /** Resolves and authorizes a durable TaskRun or Workroom from server context. */
  resolveBinding(): Promise<AsyncOperationBinding>;
  store: AsyncOperationAdmissionStore;
  enqueue(operationId: string): Promise<void>;
}

export interface AdmitDurableAsyncOperationInput {
  providerId: string;
  modelId: string;
  contractFamily: string;
  screenedRequestDigest: string;
  screenedRequestContext: Record<string, unknown>;
  expiresAt: Date;
}

export class AsyncOperationIdentityConflictError extends Error {
  constructor() {
    super("ASYNC_OPERATION_IDENTITY_CONFLICT");
    this.name = "AsyncOperationIdentityConflictError";
  }
}

export function asyncOperationAuthorityScopeKey(
  binding: AsyncOperationBinding,
): string {
  return binding.kind === "task-run"
    ? `task-run:${binding.taskRunId}`
    : `workroom:${binding.workroomId}`;
}

export async function admitDurableAsyncOperation(
  input: AdmitDurableAsyncOperationInput,
  dependencies: AsyncOperationAdmissionDependencies,
): Promise<{ operationId: string; replayed: boolean }> {
  // Authority is deliberately resolved inside this boundary. No caller-provided
  // operation id or arbitrary scope string is accepted as authority.
  const binding = await dependencies.resolveBinding();
  const screenedRequestContext = parseDurableAsyncProviderContextInput({
    screenedRequestContext: input.screenedRequestContext,
    providerId: input.providerId,
    modelId: input.modelId,
    contractFamily: input.contractFamily,
  }) as unknown as Record<string, unknown>;
  const bindingDigest = canonicalAsyncOperationBindingDigest(binding);
  const requestDigest = canonicalAsyncOperationRequestDigest({
    providerId: input.providerId,
    modelId: input.modelId,
    contractFamily: input.contractFamily,
    screenedRequestDigest: input.screenedRequestDigest,
    screenedRequestContext,
    binding,
  });
  const result = await dependencies.store.createOrReplay({
    binding,
    authorityScopeKey: asyncOperationAuthorityScopeKey(binding),
    requestKey: binding.requestKey,
    requestDigest,
    bindingDigest,
    providerId: input.providerId,
    modelId: input.modelId,
    contractFamily: input.contractFamily,
    screenedRequestContext,
    expiresAt: input.expiresAt,
  });

  if (!result.replayed) {
    // Durable identity exists before advisory dispatch. A lost enqueue is
    // recoverable by reconciliation; a provider side effect before persistence
    // is not.
    await dependencies.enqueue(result.operation.id);
  }

  return {
    operationId: result.operation.id,
    replayed: result.replayed,
  };
}
