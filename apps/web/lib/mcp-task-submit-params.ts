import { parseInitiativeReviewBinding, validateInitiativeReviewAuthorityScope, type InitiativeReviewBinding } from "./mcp-task-review-contract";
import { parseDurableInferenceTaskRecipeId, type DurableInferenceTaskRecipeId } from "./mcp-task-durable-inference-contract";

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export const REMOTE_RISK_CLASSES = ["read", "bounded-write", "high-risk"] as const;
export type RemoteRiskClass = (typeof REMOTE_RISK_CLASSES)[number];
export type RemoteTaskSubmitParams = {
  agentId: string;
  routeContext: string;
  title: string;
  objective: string;
  prompt: string;
  idempotencyKey: string;
  riskClass: RemoteRiskClass;
  threadId?: string | null;
  authorityScope?: string[];
  collaborationKind?: "handoff" | "summon";
  initiativeReviewBinding?: InitiativeReviewBinding;
  recipeId?: DurableInferenceTaskRecipeId;
};
const DURABLE_INFERENCE_SUBMIT_KEYS = new Set([
  "agentId",
  "routeContext",
  "title",
  "objective",
  "prompt",
  "idempotencyKey",
  "riskClass",
  "threadId",
  "authorityScope",
  "collaborationKind",
  "initiativeReviewBinding",
  "recipeId",
]);

export function parseRemoteTaskSubmitParams(params: Record<string, unknown> | undefined): RemoteTaskSubmitParams | string {
  if (!params) return "tasks/submit requires params";
  const agentId = optionalString(params["agentId"]);
  const routeContext = optionalString(params["routeContext"]);
  const objective = optionalString(params["objective"]);
  const prompt = optionalString(params["prompt"]);
  const idempotencyKey = optionalString(params["idempotencyKey"]);
  const riskClass = optionalString(params["riskClass"]);
  const durableRecipe = parseDurableInferenceTaskRecipeId(params["recipeId"]);
  if (!agentId) return "tasks/submit requires params.agentId (string)";
  if (!routeContext) return "tasks/submit requires params.routeContext (string)";
  if (!objective) return "tasks/submit requires params.objective (string)";
  if (!prompt) return "tasks/submit requires params.prompt (string)";
  if (!idempotencyKey) return "tasks/submit requires params.idempotencyKey (string)";
  if (!riskClass || !REMOTE_RISK_CLASSES.includes(riskClass as RemoteRiskClass)) return `tasks/submit requires params.riskClass (${REMOTE_RISK_CLASSES.join(" | ")})`;
  if (!durableRecipe.ok) return durableRecipe.error;
  const durableRecipeId = durableRecipe.data.recipeId;
  if (durableRecipeId) {
    const unknownKey = Object.keys(params).find((key) => !DURABLE_INFERENCE_SUBMIT_KEYS.has(key));
    if (unknownKey) return `tasks/submit durable-inference recipe does not accept params.${unknownKey}`;
  }
  if (durableRecipeId && riskClass !== "read") return "tasks/submit durable-inference recipe requires params.riskClass read";

  const authorityScope = Array.isArray(params["authorityScope"])
    ? params["authorityScope"].filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : undefined;
  const initiativeReviewBinding = params["initiativeReviewBinding"] === undefined
    ? undefined
    : parseInitiativeReviewBinding(params["initiativeReviewBinding"]);
  if (params["initiativeReviewBinding"] !== undefined && !initiativeReviewBinding) return "tasks/submit requires a valid immutable initiativeReviewBinding";
  if (durableRecipeId && (initiativeReviewBinding || (authorityScope?.length ?? 0) > 0)) return "tasks/submit durable-inference recipe does not accept tool authority or initiative review bindings";
  if (initiativeReviewBinding) {
    const scopeError = validateInitiativeReviewAuthorityScope(initiativeReviewBinding, authorityScope);
    if (scopeError) return `tasks/submit ${scopeError}`;
  }

  return {
    agentId,
    routeContext,
    title: optionalString(params["title"]) ?? objective.slice(0, 120),
    objective,
    prompt,
    idempotencyKey,
    riskClass: riskClass as RemoteRiskClass,
    threadId: optionalString(params["threadId"]),
    authorityScope,
    initiativeReviewBinding: initiativeReviewBinding ?? undefined,
    collaborationKind: params["collaborationKind"] === "handoff" || params["collaborationKind"] === "summon"
      ? params["collaborationKind"]
      : undefined,
    ...(durableRecipeId ? { recipeId: durableRecipeId } : {}),
  };
}

