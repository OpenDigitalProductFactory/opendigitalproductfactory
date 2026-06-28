import type { RoutedHarnessPlan } from "./recipe-types";

export type ActivityHarnessAudit = {
  recipeKey: string;
  activityClass: string;
  activityConfidence: RoutedHarnessPlan["activityConfidence"];
  promptStrategy: string;
  contextAssembler: string;
  memoryPolicy?: RoutedHarnessPlan["memoryPolicy"];
  tokenPolicy?: RoutedHarnessPlan["tokenPolicy"];
  evaluator?: RoutedHarnessPlan["evaluator"];
  providerFamily?: string;
  modelFamily?: string;
  executionAdapterHint?: string;
};

export function serializeActivityHarnessAudit(
  harness: RoutedHarnessPlan | undefined,
): ActivityHarnessAudit | undefined {
  if (!harness) return undefined;

  return stripUndefined({
    recipeKey: harness.recipeKey,
    activityClass: harness.activityClass,
    activityConfidence: harness.activityConfidence,
    promptStrategy: harness.promptStrategy,
    contextAssembler: harness.contextAssembler,
    memoryPolicy: harness.memoryPolicy,
    tokenPolicy: harness.tokenPolicy,
    evaluator: harness.evaluator,
    providerFamily: harness.providerFamily,
    modelFamily: harness.modelFamily,
    executionAdapterHint: harness.executionAdapterHint,
  });
}

export function parseActivityHarnessAudit(value: unknown): ActivityHarnessAudit | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.recipeKey !== "string" ||
    typeof record.activityClass !== "string" ||
    typeof record.activityConfidence !== "string" ||
    typeof record.promptStrategy !== "string" ||
    typeof record.contextAssembler !== "string"
  ) {
    return null;
  }

  return stripUndefined({
    recipeKey: record.recipeKey,
    activityClass: record.activityClass,
    activityConfidence: record.activityConfidence as ActivityHarnessAudit["activityConfidence"],
    promptStrategy: record.promptStrategy,
    contextAssembler: record.contextAssembler,
    memoryPolicy: typeof record.memoryPolicy === "string"
      ? record.memoryPolicy as ActivityHarnessAudit["memoryPolicy"]
      : undefined,
    tokenPolicy: isTokenPolicy(record.tokenPolicy)
      ? record.tokenPolicy
      : undefined,
    evaluator: typeof record.evaluator === "string"
      ? record.evaluator as ActivityHarnessAudit["evaluator"]
      : undefined,
    providerFamily: typeof record.providerFamily === "string" ? record.providerFamily : undefined,
    modelFamily: typeof record.modelFamily === "string" ? record.modelFamily : undefined,
    executionAdapterHint: typeof record.executionAdapterHint === "string" ? record.executionAdapterHint : undefined,
  });
}

function isTokenPolicy(value: unknown): value is ActivityHarnessAudit["tokenPolicy"] {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.inputPacking === "string" && typeof record.outputBudget === "string";
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
