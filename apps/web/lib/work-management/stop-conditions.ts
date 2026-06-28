import type { WorkCaseStopCondition } from "./policy-envelope";

export const WORK_CASE_STOP_CONDITION_KINDS = [
  "max-iterations",
  "budget-ceiling",
  "timebox",
  "required-approval",
  "terminal-sealed",
  "receipt-required",
  "policy-required",
] as const;

export type WorkCaseStopConditionKind =
  (typeof WORK_CASE_STOP_CONDITION_KINDS)[number];

export type WorkCaseApprovalStatus = "missing" | "pending" | "approved" | "rejected";

export type WorkCaseStopConditionDefinition =
  | {
      conditionId: string;
      kind: "max-iterations";
      observedCount: number;
      limit: number;
    }
  | {
      conditionId: string;
      kind: "budget-ceiling";
      observedAmount: number;
      limit: number;
      unit?: string;
    }
  | {
      conditionId: string;
      kind: "timebox";
      deadlineAt: Date | string;
    }
  | {
      conditionId: string;
      kind: "required-approval";
      approvalStatus: WorkCaseApprovalStatus;
    }
  | {
      conditionId: string;
      kind: "terminal-sealed";
      terminal: boolean;
    }
  | {
      conditionId: string;
      kind: "receipt-required" | "policy-required";
      required: boolean;
      satisfied: boolean;
    };

export interface WorkCaseStopConditionEvaluationInput {
  now?: Date | string;
  conditions: readonly WorkCaseStopConditionDefinition[];
}

export interface WorkCaseStopConditionResult {
  conditionId: string;
  kind: WorkCaseStopConditionKind;
  tripped: boolean;
  reason: string;
}

export interface WorkCaseStopConditionEvaluation {
  ok: boolean;
  tripped: WorkCaseStopConditionResult[];
  clear: WorkCaseStopConditionResult[];
  conditions: WorkCaseStopConditionResult[];
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function unitSuffix(unit: string | undefined): string {
  return unit?.trim() ? ` ${unit.trim()}` : "";
}

function evaluateOne(
  condition: WorkCaseStopConditionDefinition,
  now: Date,
): WorkCaseStopConditionResult {
  switch (condition.kind) {
    case "max-iterations": {
      const tripped = condition.observedCount >= condition.limit;
      return {
        conditionId: condition.conditionId,
        kind: condition.kind,
        tripped,
        reason: tripped
          ? `Iteration count ${condition.observedCount} reached max ${condition.limit}.`
          : `Iteration count ${condition.observedCount} is below max ${condition.limit}.`,
      };
    }
    case "budget-ceiling": {
      const tripped = condition.observedAmount >= condition.limit;
      const unit = unitSuffix(condition.unit);
      return {
        conditionId: condition.conditionId,
        kind: condition.kind,
        tripped,
        reason: tripped
          ? `Budget ${condition.observedAmount}${unit} reached ceiling ${condition.limit}${unit}.`
          : `Budget ${condition.observedAmount}${unit} is below ceiling ${condition.limit}${unit}.`,
      };
    }
    case "timebox": {
      const deadline = asDate(condition.deadlineAt);
      const tripped = now.getTime() >= deadline.getTime();
      return {
        conditionId: condition.conditionId,
        kind: condition.kind,
        tripped,
        reason: tripped
          ? `Timebox expired at ${deadline.toISOString()}.`
          : `Timebox remains open until ${deadline.toISOString()}.`,
      };
    }
    case "required-approval": {
      const tripped = condition.approvalStatus !== "approved";
      return {
        conditionId: condition.conditionId,
        kind: condition.kind,
        tripped,
        reason: tripped
          ? `Required approval is ${condition.approvalStatus}.`
          : "Required approval is approved.",
      };
    }
    case "terminal-sealed":
      return {
        conditionId: condition.conditionId,
        kind: condition.kind,
        tripped: condition.terminal,
        reason: condition.terminal
          ? "Terminal case is sealed."
          : "Case is not terminal.",
      };
    case "receipt-required": {
      const tripped = condition.required && !condition.satisfied;
      return {
        conditionId: condition.conditionId,
        kind: condition.kind,
        tripped,
        reason: tripped
          ? "Required receipt has not been emitted."
          : "Receipt requirement is satisfied.",
      };
    }
    case "policy-required": {
      const tripped = condition.required && !condition.satisfied;
      return {
        conditionId: condition.conditionId,
        kind: condition.kind,
        tripped,
        reason: tripped
          ? "Required policy evaluation has not passed."
          : "Policy requirement is satisfied.",
      };
    }
  }
}

export function evaluateWorkCaseStopConditions(
  input: WorkCaseStopConditionEvaluationInput,
): WorkCaseStopConditionEvaluation {
  const now = input.now ? asDate(input.now) : new Date();
  const conditions = input.conditions.map((condition) => evaluateOne(condition, now));
  const tripped = conditions.filter((condition) => condition.tripped);
  const clear = conditions.filter((condition) => !condition.tripped);
  return {
    ok: tripped.length === 0,
    tripped,
    clear,
    conditions,
  };
}

export function toPolicyStopConditions(
  evaluation: WorkCaseStopConditionEvaluation,
): WorkCaseStopCondition[] {
  return evaluation.conditions.map((condition) => ({
    stopId: condition.conditionId,
    tripped: condition.tripped,
    reason: condition.reason,
  }));
}
