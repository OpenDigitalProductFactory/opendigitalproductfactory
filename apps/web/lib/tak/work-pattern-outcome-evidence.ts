import { isRecord } from "@/lib/shared/coerce";

export type WorkPatternOutcomeEvidence = {
  completed: boolean;
  buildGate: {
    unitTests: "pass" | "fail" | "not-applicable";
    productionBuild: "pass" | "fail" | "not-run";
    uxVerification: "pass" | "fail" | "not-applicable" | "blocked";
    migration: "pass" | "fail" | "not-applicable" | "blocked";
  };
  review: {
    decision: "pass" | "fail";
    reproducedBlockingFindings: number;
    nonBlockingFindings: number;
    reviewRounds: number;
  };
  execution: {
    toolCalls: number;
    toolFailures: number;
    retryCount: number;
    recoveryActions: string[];
    manualTouches: number;
    inputTokens?: number;
    outputTokens?: number;
    durationMs: number;
    costUsd?: number;
  };
  delivery: {
    prCreated: boolean;
    mergeQueued: boolean;
    merged: boolean;
    deployed: boolean;
    rolledBack: boolean;
  };
  failureClass?: string;
};

function oneOf<const T extends readonly string[]>(
  value: unknown,
  values: T,
): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function booleanFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return fields.every((field) => typeof value[field] === "boolean");
}

export function parseWorkPatternOutcomeEvidence(
  value: unknown,
): WorkPatternOutcomeEvidence | null {
  if (!isRecord(value) || typeof value.completed !== "boolean") return null;
  if (
    !isRecord(value.buildGate)
    || !oneOf(value.buildGate.unitTests, ["pass", "fail", "not-applicable"] as const)
    || !oneOf(value.buildGate.productionBuild, ["pass", "fail", "not-run"] as const)
    || !oneOf(value.buildGate.uxVerification, ["pass", "fail", "not-applicable", "blocked"] as const)
    || !oneOf(value.buildGate.migration, ["pass", "fail", "not-applicable", "blocked"] as const)
  ) {
    return null;
  }
  if (
    !isRecord(value.review)
    || !oneOf(value.review.decision, ["pass", "fail"] as const)
    || !nonNegativeInteger(value.review.reproducedBlockingFindings)
    || !nonNegativeInteger(value.review.nonBlockingFindings)
    || !nonNegativeInteger(value.review.reviewRounds)
  ) {
    return null;
  }
  if (
    !isRecord(value.execution)
    || !nonNegativeInteger(value.execution.toolCalls)
    || !nonNegativeInteger(value.execution.toolFailures)
    || !nonNegativeInteger(value.execution.retryCount)
    || !Array.isArray(value.execution.recoveryActions)
    || value.execution.recoveryActions.some((item) => typeof item !== "string" || item.trim().length === 0)
    || !nonNegativeInteger(value.execution.manualTouches)
    || !nonNegativeNumber(value.execution.durationMs)
    || (value.execution.inputTokens !== undefined && !nonNegativeInteger(value.execution.inputTokens))
    || (value.execution.outputTokens !== undefined && !nonNegativeInteger(value.execution.outputTokens))
    || (value.execution.costUsd !== undefined && !nonNegativeNumber(value.execution.costUsd))
  ) {
    return null;
  }
  if (
    !isRecord(value.delivery)
    || !booleanFields(value.delivery, ["prCreated", "mergeQueued", "merged", "deployed", "rolledBack"])
  ) {
    return null;
  }
  if (
    value.failureClass !== undefined
    && (typeof value.failureClass !== "string" || value.failureClass.trim().length === 0)
  ) {
    return null;
  }

  return {
    completed: value.completed,
    buildGate: {
      unitTests: value.buildGate.unitTests,
      productionBuild: value.buildGate.productionBuild,
      uxVerification: value.buildGate.uxVerification,
      migration: value.buildGate.migration,
    },
    review: {
      decision: value.review.decision,
      reproducedBlockingFindings: value.review.reproducedBlockingFindings,
      nonBlockingFindings: value.review.nonBlockingFindings,
      reviewRounds: value.review.reviewRounds,
    },
    execution: {
      toolCalls: value.execution.toolCalls,
      toolFailures: value.execution.toolFailures,
      retryCount: value.execution.retryCount,
      recoveryActions: value.execution.recoveryActions as string[],
      manualTouches: value.execution.manualTouches,
      ...(value.execution.inputTokens !== undefined
        ? { inputTokens: value.execution.inputTokens as number }
        : {}),
      ...(value.execution.outputTokens !== undefined
        ? { outputTokens: value.execution.outputTokens as number }
        : {}),
      durationMs: value.execution.durationMs,
      ...(value.execution.costUsd !== undefined
        ? { costUsd: value.execution.costUsd as number }
        : {}),
    },
    delivery: {
      prCreated: value.delivery.prCreated as boolean,
      mergeQueued: value.delivery.mergeQueued as boolean,
      merged: value.delivery.merged as boolean,
      deployed: value.delivery.deployed as boolean,
      rolledBack: value.delivery.rolledBack as boolean,
    },
    ...(typeof value.failureClass === "string" ? { failureClass: value.failureClass } : {}),
  };
}
