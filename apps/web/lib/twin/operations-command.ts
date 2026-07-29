export type OperationalCommandStatus =
  | "confirmed"
  | "conflict"
  | "rejected"
  | "unsupported";

export interface OperationalInterval {
  startsAt: string;
  endsAt: string;
}

export interface OperationalEntityRefs {
  demandId: string;
  resourceIds: string[];
}

export interface OperationalAssignmentCommand {
  kind: "assign";
  idempotencyKey: string;
  expectedVersion: string;
  interval: OperationalInterval;
  entityRefs: OperationalEntityRefs;
}

export type OperationalCommand = OperationalAssignmentCommand;

export interface OperationalChangedFact {
  entityId: string;
  field: string;
  value: string | number | boolean | null;
}

export interface OperationalAlternative {
  resourceIds: string[];
  label: string;
}

interface OperationalResultBase {
  status: OperationalCommandStatus;
  idempotencyKey: string;
  replayed: boolean;
  latencyMs?: number;
}

export interface OperationalConfirmedResult extends OperationalResultBase {
  status: "confirmed";
  newVersion: string;
  changedFacts: OperationalChangedFact[];
}

export interface OperationalConflictResult extends OperationalResultBase {
  status: "conflict";
  currentVersion: string;
  changedFacts: OperationalChangedFact[];
  alternatives: OperationalAlternative[];
}

export interface OperationalRejectedResult extends OperationalResultBase {
  status: "rejected";
  reasonCode: string;
  message: string;
}

export interface OperationalUnsupportedResult extends OperationalResultBase {
  status: "unsupported";
  capability: string;
  message: string;
}

export type OperationalCommandResult =
  | OperationalConfirmedResult
  | OperationalConflictResult
  | OperationalRejectedResult
  | OperationalUnsupportedResult;

export type OperationalCommandAdapterResult =
  | {
      status: "confirmed";
      newVersion: string;
      changedFacts: OperationalChangedFact[];
    }
  | {
      status: "conflict";
      currentVersion: string;
      changedFacts: OperationalChangedFact[];
      alternatives: OperationalAlternative[];
    }
  | {
      status: "rejected";
      reasonCode: string;
      message: string;
    }
  | {
      status: "unsupported";
      capability: string;
      message: string;
    };

export interface OperationalCommandAdapter {
  /**
   * The adapter owns the durable transaction: idempotency receipt, expected
   * version check, overlap/hold constraint, and write commit happen atomically.
   */
  executeAtomically(command: OperationalCommand): Promise<OperationalCommandAdapterResult>;
  supports?(command: OperationalCommand): boolean;
}

export interface OperationalCommandBoundary {
  execute(command: OperationalCommand): Promise<OperationalCommandResult>;
}

function commandFingerprint(command: OperationalCommand): string {
  return JSON.stringify(command);
}

function rejection(
  command: OperationalCommand,
  reasonCode: string,
  message: string,
): OperationalRejectedResult {
  return {
    status: "rejected",
    idempotencyKey: command.idempotencyKey,
    replayed: false,
    reasonCode,
    message,
  };
}

function validateCommand(command: OperationalCommand): OperationalRejectedResult | null {
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(command.idempotencyKey)) {
    return rejection(command, "invalid-idempotency-key", "Use an 8–160 character stable command key.");
  }
  if (!command.expectedVersion.trim()) {
    return rejection(command, "missing-expected-version", "Refresh Operations state before assigning.");
  }
  const startsAt = Date.parse(command.interval.startsAt);
  const endsAt = Date.parse(command.interval.endsAt);
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) {
    return rejection(command, "invalid-interval", "The assignment end must be after its start.");
  }
  if (!command.entityRefs.demandId.trim() || command.entityRefs.resourceIds.length === 0) {
    return rejection(command, "missing-entity-reference", "Demand and at least one resource are required.");
  }
  return null;
}

export function createOperationalCommandBoundary(
  adapter: OperationalCommandAdapter,
  clock: () => number = () => performance.now(),
): OperationalCommandBoundary {
  const inFlight = new Map<string, { fingerprint: string; result: Promise<OperationalCommandResult> }>();
  const settled = new Map<string, { fingerprint: string; result: OperationalCommandResult }>();

  return {
    async execute(command) {
      const invalid = validateCommand(command);
      if (invalid) return invalid;

      const fingerprint = commandFingerprint(command);
      const prior = settled.get(command.idempotencyKey);
      if (prior) {
        if (prior.fingerprint !== fingerprint) {
          return rejection(
            command,
            "idempotency-key-reused",
            "That command key already belongs to a different assignment.",
          );
        }
        return { ...prior.result, replayed: true };
      }

      const pending = inFlight.get(command.idempotencyKey);
      if (pending) {
        if (pending.fingerprint !== fingerprint) {
          return rejection(
            command,
            "idempotency-key-reused",
            "That command key is already executing a different assignment.",
          );
        }
        return pending.result;
      }

      if (adapter.supports && !adapter.supports(command)) {
        return {
          status: "unsupported",
          idempotencyKey: command.idempotencyKey,
          replayed: false,
          capability: command.kind,
          message: "The active operations provider does not support this command.",
        };
      }

      const startedAt = clock();
      const result = (async (): Promise<OperationalCommandResult> => {
        const adapterResult = await adapter.executeAtomically(command);
        return {
          ...adapterResult,
          idempotencyKey: command.idempotencyKey,
          replayed: false,
          latencyMs: Math.max(0, clock() - startedAt),
        } as OperationalCommandResult;
      })();
      inFlight.set(command.idempotencyKey, { fingerprint, result });

      try {
        const completed = await result;
        settled.set(command.idempotencyKey, { fingerprint, result: completed });
        return completed;
      } finally {
        inFlight.delete(command.idempotencyKey);
      }
    },
  };
}

export interface PendingOperationalCommand {
  idempotencyKey: string;
  previousSelection: string[];
}

export interface OperationalUiState {
  snapshotVersion: string;
  selectedEntityIds: string[];
  pending: PendingOperationalCommand | null;
  conflict: OperationalConflictResult | null;
  lastResult: OperationalCommandResult | null;
}

export function initialOperationalUiState(snapshotVersion: string): OperationalUiState {
  return {
    snapshotVersion,
    selectedEntityIds: [],
    pending: null,
    conflict: null,
    lastResult: null,
  };
}

export function beginOperationalCommand(
  state: OperationalUiState,
  command: OperationalCommand,
  optimisticSelection: string[],
): OperationalUiState {
  return {
    ...state,
    selectedEntityIds: optimisticSelection,
    pending: {
      idempotencyKey: command.idempotencyKey,
      previousSelection: state.selectedEntityIds,
    },
    conflict: null,
    lastResult: null,
  };
}

export function reconcileOperationalCommand(
  state: OperationalUiState,
  result: OperationalCommandResult,
): OperationalUiState {
  if (!state.pending || state.pending.idempotencyKey !== result.idempotencyKey) return state;
  if (result.status === "confirmed") {
    return {
      ...state,
      snapshotVersion: result.newVersion,
      pending: null,
      conflict: null,
      lastResult: result,
    };
  }
  return {
    ...state,
    snapshotVersion: result.status === "conflict" ? result.currentVersion : state.snapshotVersion,
    selectedEntityIds: state.pending.previousSelection,
    pending: null,
    conflict: result.status === "conflict" ? result : null,
    lastResult: result,
  };
}
