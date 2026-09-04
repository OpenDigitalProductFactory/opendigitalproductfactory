import type { ToolConsequence, ToolDefinition } from "@/lib/mcp-tools";
import { getWorkCaseAction } from "@/lib/work-management/action-registry";
import type { WorkCaseExecutionContext } from "@/lib/work-management/work-case-governance-hook";
import type { WorkroomShapeKey } from "@/lib/work-management/room-shapes";

export const CONSEQUENCE_CLASSES = ["routine-read", "ordinary-mutation", "consequential-mutation"] as const;
export type ConsequenceClass = (typeof CONSEQUENCE_CLASSES)[number];

export type ConsequentialToolClassification = {
  class: ConsequenceClass;
  consequential: boolean;
  alignmentRequired: boolean;
  preconditionRequired: boolean;
  collaborationShape: WorkroomShapeKey | null;
  reason:
    | "read-only"
    | "ordinary-side-effect"
    | "explicit-policy"
    | "work-case-consequential"
    | "declared-outward"
    | "declared-irreversible";
};

/**
 * Legacy name-keyed alignment list, kept only for tools that predate the
 * declared `ToolDefinition.consequence` axis.
 *
 * It previously carried nine names, SEVEN of which matched nothing in the
 * codebase (`create_product`, `create_product_line`, `launch_campaign`,
 * `publish_storefront`, `send_quote`, `send_invoice`, `execute_change`). A
 * name that resolves to no tool gates nothing, so the list read as broad
 * coverage while alignment actually ran on two real tools. The dead names are
 * removed and `every name resolves` is now a conformance test — the drift, not
 * the list, was the defect.
 */
export const ALIGNMENT_CONSEQUENTIAL_TOOL_NAMES = [
  "create_digital_product",
  "create_marketing_campaign",
  // Banking books loop (BI-DE27D34E, S-FIN): setting up a real account and
  // importing a statement move money-of-record, so they route the governance
  // gate for owner approval. Categorization/matching are ordinary, reversible
  // mutations and intentionally stay off this list.
  "create_bank_account",
  "import_bank_statement",
] as const;
const EXPLICIT = new Set<string>(ALIGNMENT_CONSEQUENTIAL_TOOL_NAMES);
/**
 * Name-keyed precondition list (like ALIGNMENT_CONSEQUENTIAL_TOOL_NAMES, it
 * predates the declared consequence axis). Exported so the name-set
 * referential-integrity test (lib/mcp/name-set-referential-integrity.test.ts)
 * can prove every name resolves to a live catalog tool — a name that resolves
 * to nothing gates nothing (BI-47629B5B).
 */
export const PRECONDITION_TOOL_NAMES = ["transition_employee_status"] as const;
const PRECONDITION = new Set<string>(PRECONDITION_TOOL_NAMES);

/** Alignment applies to what leaves the business, not to internal platform ops. */
function alignmentRequiredFor(toolName: string, consequence: ToolConsequence | undefined): boolean {
  return consequence === "outward" || EXPLICIT.has(toolName);
}

export function collaborationShapeForTool(
  toolName: string,
  consequence?: ToolConsequence,
): WorkroomShapeKey | null {
  // Single-source: these are the same name-keyed legacy lists declared above
  // (EXPLICIT / PRECONDITION), not a third hand-maintained copy — so the
  // referential-integrity test over those exports covers this function too.
  if (EXPLICIT.has(toolName)) return "specialist-alignment";
  if (PRECONDITION.has(toolName)) return "change-consequential";
  if (consequence === "outward") return "outward-review";
  if (consequence === "irreversible") return "change-consequential";
  return null;
}

/**
 * Closed, deterministic policy: reads and ordinary bookkeeping mutations skip
 * alignment; named outward/business-direction mutations are consequential.
 * Work Case metadata may elevate but never downgrade a call.
 */
export function classifyConsequentialTool(input: {
  tool: Pick<ToolDefinition, "sideEffect" | "consequence">;
  toolName: string;
  workCase?: WorkCaseExecutionContext;
}): ConsequentialToolClassification {
  const consequence = input.tool.consequence;
  const action = input.workCase ? getWorkCaseAction(input.workCase.action) : undefined;
  if (action?.consequential) {
    return {
      class: "consequential-mutation",
      consequential: true,
      alignmentRequired: alignmentRequiredFor(input.toolName, consequence),
      preconditionRequired: PRECONDITION.has(input.toolName),
      collaborationShape: collaborationShapeForTool(input.toolName, consequence) ?? "change-consequential",
      reason: "work-case-consequential",
    };
  }
  // A declared reach is the tool's own claim about itself and outranks the
  // legacy name list. `outward` additionally requires WWWD alignment;
  // `irreversible` is receipted and reserved but not alignment-gated.
  if (input.tool.sideEffect && consequence) {
    return {
      class: "consequential-mutation",
      consequential: true,
      alignmentRequired: alignmentRequiredFor(input.toolName, consequence),
      preconditionRequired: PRECONDITION.has(input.toolName),
      collaborationShape: collaborationShapeForTool(input.toolName, consequence),
      reason: consequence === "outward" ? "declared-outward" : "declared-irreversible",
    };
  }
  if (input.tool.sideEffect && (EXPLICIT.has(input.toolName) || PRECONDITION.has(input.toolName))) {
    return {
      class: "consequential-mutation", consequential: true,
      alignmentRequired: alignmentRequiredFor(input.toolName, consequence),
      preconditionRequired: PRECONDITION.has(input.toolName),
      collaborationShape: collaborationShapeForTool(input.toolName, consequence), reason: "explicit-policy",
    };
  }
  if (input.tool.sideEffect) {
    return {
      class: "ordinary-mutation", consequential: false, alignmentRequired: false,
      preconditionRequired: false, collaborationShape: null, reason: "ordinary-side-effect",
    };
  }
  return {
    class: "routine-read", consequential: false, alignmentRequired: false,
    preconditionRequired: false, collaborationShape: null, reason: "read-only",
  };
}
