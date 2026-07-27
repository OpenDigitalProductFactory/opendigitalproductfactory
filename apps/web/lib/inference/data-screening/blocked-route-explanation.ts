import type { RouteDecision } from "@/lib/routing/types";

export function screenedLocalOnlyBlockReason(
  decision: RouteDecision,
  taskType: string,
): string | null {
  const receipt = decision.inferenceDataScreenReceipt;
  if (!receipt || receipt.routeEffect !== "local-only") return null;

  const dataClasses = receipt.classifiedDataClasses.length > 0
    ? receipt.classifiedDataClasses.map(humanizeDataClass).join(", ")
    : "governed data";
  const saferRoute =
    "Use an eligible local/private model or an approved provider account with evidence for this data class.";
  const transform =
    receipt.transformation === "masked" || receipt.transformation === "tokenized"
      ? "The payload was transformed before routing; rehydration still needs an authorized surface."
      : "Masking/tokenization is not available for this route yet; remove sensitive details if exact values are not needed.";

  return (
    `Sensitive-data routing blocked cloud dispatch for task '${taskType}' because the payload includes ${dataClasses}. ` +
    `${saferRoute} ${transform} Router detail: ${decision.reason}`
  );
}

function humanizeDataClass(value: string): string {
  return value.replace(/-/g, " ");
}
