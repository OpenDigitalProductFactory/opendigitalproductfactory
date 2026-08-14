import type { ToolDefinition } from "@/lib/mcp-tools";
import { getWorkCaseAction } from "@/lib/work-management/action-registry";
import type { WorkCaseExecutionContext } from "@/lib/work-management/work-case-governance-hook";

export const CONSEQUENCE_CLASSES = ["routine-read", "ordinary-mutation", "consequential-mutation"] as const;
export type ConsequenceClass = (typeof CONSEQUENCE_CLASSES)[number];

export type ConsequentialToolClassification = {
  class: ConsequenceClass;
  consequential: boolean;
  alignmentRequired: boolean;
  reason: "read-only" | "ordinary-side-effect" | "explicit-policy" | "work-case-consequential";
};

export const ALIGNMENT_CONSEQUENTIAL_TOOL_NAMES = [
  "create_digital_product",
  "create_product",
  "create_product_line",
  "create_marketing_campaign",
  "launch_campaign",
  "publish_storefront",
  "send_quote",
  "send_invoice",
  "execute_change",
] as const;
const EXPLICIT = new Set<string>(ALIGNMENT_CONSEQUENTIAL_TOOL_NAMES);

/**
 * Closed, deterministic policy: reads and ordinary bookkeeping mutations skip
 * alignment; named outward/business-direction mutations are consequential.
 * Work Case metadata may elevate but never downgrade a call.
 */
export function classifyConsequentialTool(input: {
  tool: Pick<ToolDefinition, "sideEffect">;
  toolName: string;
  workCase?: WorkCaseExecutionContext;
}): ConsequentialToolClassification {
  const action = input.workCase ? getWorkCaseAction(input.workCase.action) : undefined;
  if (action?.consequential) {
    return {
      class: "consequential-mutation",
      consequential: true,
      alignmentRequired: EXPLICIT.has(input.toolName),
      reason: "work-case-consequential",
    };
  }
  if (input.tool.sideEffect && EXPLICIT.has(input.toolName)) {
    return { class: "consequential-mutation", consequential: true, alignmentRequired: true, reason: "explicit-policy" };
  }
  if (input.tool.sideEffect) {
    return { class: "ordinary-mutation", consequential: false, alignmentRequired: false, reason: "ordinary-side-effect" };
  }
  return { class: "routine-read", consequential: false, alignmentRequired: false, reason: "read-only" };
}
