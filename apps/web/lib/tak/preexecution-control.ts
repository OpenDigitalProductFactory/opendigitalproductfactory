import type {
  GovernedExecuteArgs,
  GovernedExecuteRejection,
  GovernedExecuteResult,
} from "@/lib/mcp-governed-execute";
import { runTakAlignmentGate, type AlignmentGateDecision } from "./alignment-tool-gate";
import {
  runTakPreconditionGate,
  type PreconditionOrderingDecision,
} from "./precondition-ordering-gate";
import { writeToolExecutionReceipt } from "./tool-execution-receipt";

type AuditResult = { id: string } | null;
type PreexecutionAudit = (input: {
  result: GovernedExecuteResult;
  alignmentDecision: AlignmentGateDecision | null;
  preconditionDecision: PreconditionOrderingDecision | null;
}) => Promise<AuditResult>;

function rejected(
  toolName: string,
  rejection: GovernedExecuteRejection,
  detail: string,
): GovernedExecuteResult {
  return {
    success: false,
    error: rejection,
    message: `${toolName} rejected: ${detail}`,
    governance: { rejected: rejection },
  };
}

async function receiptDenied(input: {
  args: GovernedExecuteArgs;
  result: GovernedExecuteResult;
  auditRow: AuditResult;
  alignmentDecision: AlignmentGateDecision | null;
  preconditionDecision: PreconditionOrderingDecision | null;
}): Promise<void> {
  if (!input.auditRow?.id) return;
  await writeToolExecutionReceipt({
    auditRowId: input.auditRow.id,
    buildId: null,
    rawParams: input.args.rawParams,
    result: input.result,
    toolName: input.args.toolName,
    context: input.args.context,
    consequential: true,
    alignmentDecision: input.alignmentDecision,
    preconditionDecision: input.preconditionDecision,
  });
}

export async function enforceTakPreexecution(input: {
  args: GovernedExecuteArgs;
  alignmentRequired: boolean;
  preconditionRequired: boolean;
  writeAudit: PreexecutionAudit;
}): Promise<{
  result: GovernedExecuteResult | null;
  alignmentDecision: AlignmentGateDecision | null;
  preconditionDecision: PreconditionOrderingDecision | null;
}> {
  let alignmentDecision: AlignmentGateDecision | null = null;
  let preconditionDecision: PreconditionOrderingDecision | null = null;

  if (input.preconditionRequired) {
    preconditionDecision = await runTakPreconditionGate(input.args);
    if (preconditionDecision.verdict !== "approve") {
      const rejection: GovernedExecuteRejection = preconditionDecision.verdict === "decline"
        ? "precondition_denied" : "precondition_escalation_required";
      const result: GovernedExecuteResult = {
        ...rejected(input.args.toolName, rejection, preconditionDecision.rationale),
        data: { precondition: preconditionDecision },
        governance: { rejected: rejection, precondition: preconditionDecision },
      };
      const auditRow = await input.writeAudit({ result, alignmentDecision, preconditionDecision });
      await receiptDenied({ args: input.args, result, auditRow, alignmentDecision, preconditionDecision });
      return { result, alignmentDecision, preconditionDecision };
    }
  }

  if (input.alignmentRequired) {
    alignmentDecision = await runTakAlignmentGate(input.args);
    if (alignmentDecision.verdict !== "approve") {
      const rejection: GovernedExecuteRejection = alignmentDecision.verdict === "decline"
        ? "alignment_denied" : "alignment_escalation_required";
      const result: GovernedExecuteResult = {
        ...rejected(input.args.toolName, rejection, alignmentDecision.rationale),
        data: { interactionId: alignmentDecision.interactionId, alignment: alignmentDecision.alignment },
        governance: {
          rejected: rejection,
          alignment: alignmentDecision.alignment,
          alignmentInteractionId: alignmentDecision.interactionId,
          ...(preconditionDecision ? { precondition: preconditionDecision } : {}),
        },
      };
      const auditRow = await input.writeAudit({ result, alignmentDecision, preconditionDecision });
      await receiptDenied({ args: input.args, result, auditRow, alignmentDecision, preconditionDecision });
      return { result, alignmentDecision, preconditionDecision };
    }
  }
  return { result: null, alignmentDecision, preconditionDecision };
}
