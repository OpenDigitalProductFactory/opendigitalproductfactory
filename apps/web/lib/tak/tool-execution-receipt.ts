import { scryptSync } from "crypto";
import { prisma } from "@dpf/db";

import type { ToolResult } from "@/lib/mcp-tools";
import type { AlignmentGateDecision } from "./alignment-tool-gate";
import type { PreconditionOrderingDecision } from "./precondition-ordering-gate";
import type { GovernedExecuteContext } from "@/lib/mcp-governed-execute";
import { getWorkCaseAction } from "@/lib/work-management/action-registry";
import { collaborationShapeForTool } from "./consequential-tool-policy";
import { resolveGaidActorEnvelope, type GaidActorEnvelope } from "./gaid-actor-envelope";
import type { GovernedExecuteArgs } from "@/lib/mcp-governed-execute";

let createOverride: ((data: Record<string, unknown>) => Promise<unknown>) | null = null;
let updateOverride: ((id: string, data: Record<string, unknown>) => Promise<unknown>) | null = null;
export function setToolExecutionReceiptCreateOverrideForTests(
  override: ((data: Record<string, unknown>) => Promise<unknown>) | null,
): void {
  createOverride = override;
}
export function setToolExecutionReceiptUpdateOverrideForTests(
  override: ((id: string, data: Record<string, unknown>) => Promise<unknown>) | null,
): void {
  updateOverride = override;
}

function receiptKind(toolName: string, context?: GovernedExecuteContext, consequential = false): string | null {
  if (context?.workCase && getWorkCaseAction(context.workCase.action)?.consequential) {
    return "work-case-governed-action";
  }
  if (consequential) return "tak-consequential-action";
  if (toolName === "run_sandbox_tests") return "sandbox-test-run";
  if (toolName === "run_sandbox_command") return "sandbox-command";
  if (toolName === "run_ux_test") return "ux-run";
  return null;
}

function digestPayload(value: unknown): string {
  return scryptSync(JSON.stringify(value ?? null), "dpf-receipt", 32, {
    N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024,
  }).toString("hex");
}

function governanceEnvelope(data: {
  actor: GaidActorEnvelope | null;
  context?: GovernedExecuteContext;
  consequential?: boolean;
  alignmentDecision?: AlignmentGateDecision | null;
  preconditionDecision?: PreconditionOrderingDecision | null;
}) {
  const evidenceRefs = Array.from(new Set([
    ...(data.alignmentDecision?.alignment.checks.flatMap((check) => check.evidenceRefs) ?? []),
    ...(data.preconditionDecision?.checks.flatMap((check) => check.evidenceRefs) ?? []),
    ...(data.alignmentDecision?.specialistDelegation?.checks.flatMap((check) => check.evidenceRefs) ?? []),
  ])).sort();
  return {
    actor: data.actor,
    gateDecision: data.alignmentDecision?.verdict ?? null,
    decisionInteractionId: data.alignmentDecision?.interactionId ?? null,
    policyVersion: data.alignmentDecision?.policyVersion ?? null,
    amendmentLineage: data.alignmentDecision?.amendmentLineage ?? [],
    delegationChainId: data.context?.delegationChainId ?? null,
    qualification: data.alignmentDecision?.specialistDelegation ? {
      verdict: data.alignmentDecision.specialistDelegation.verdict,
      statuses: data.alignmentDecision.specialistDelegation.checks.map((check) => ({
        specialistAgentId: check.specialistAgentId,
        professionKey: check.professionKey,
        qualification: check.qualification,
        delegationChainId: check.delegationChainId,
      })),
      permissionGranted: data.alignmentDecision.specialistDelegation.permissionGranted,
    } : null,
    evidenceRefs,
  };
}

function receiptOutput(data: {
  result: ToolResult;
  toolName: string;
  actor: GaidActorEnvelope | null;
  context?: GovernedExecuteContext;
  consequential?: boolean;
  alignmentDecision?: AlignmentGateDecision | null;
  preconditionDecision?: PreconditionOrderingDecision | null;
}) {
  const governance = {
    ...governanceEnvelope(data),
    collaborationShape: data.consequential ? collaborationShapeForTool(data.toolName) : null,
  };
  return {
    sha256: digestPayload({
      data: data.result.data ?? null,
      error: data.result.error ?? null,
      message: data.result.message ?? null,
      success: data.result.success,
      governance,
    }),
    governance,
  };
}

export async function writeToolExecutionReceipt(data: {
  auditRowId: string;
  buildId: string | null;
  rawParams: Record<string, unknown>;
  result: ToolResult;
  toolName: string;
  context?: GovernedExecuteContext;
  consequential?: boolean;
  alignmentDecision?: AlignmentGateDecision | null;
  preconditionDecision?: PreconditionOrderingDecision | null;
  governedArgs?: GovernedExecuteArgs;
}): Promise<void> {
  const kind = receiptKind(data.toolName, data.context, data.consequential);
  if (!kind) return;
  let actor: GaidActorEnvelope | null = null;
  try {
    actor = data.governedArgs ? await resolveGaidActorEnvelope(data.governedArgs) : null;
  } catch {
    actor = null;
  }
  const row = {
    buildId: data.buildId ?? null,
    executionStatus: data.result.success ? "succeeded" : "failed",
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    inputFingerprint: digestPayload({ params: data.rawParams, toolName: data.toolName }),
    outputDigest: receiptOutput({ ...data, actor }),
    receiptKind: kind,
    receiptStatus: data.result.success ? "valid" : "invalid",
    toolExecutionId: data.auditRowId,
  };
  try {
    if (createOverride) await createOverride(row);
    else await prisma.toolExecutionReceipt.create({ data: row });
  } catch (err) {
    console.error(
      "[governed-execute] receipt write failed tool=%s build=%s: %s",
      JSON.stringify(data.toolName), JSON.stringify(data.buildId),
      err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
    );
  }
}

/** Reserve the GAID-bound evidence channel before an approved consequential side effect. */
export async function reserveConsequentialToolExecutionReceipt(data: {
  auditRowId: string;
  args: GovernedExecuteArgs;
  alignmentDecision: AlignmentGateDecision | null;
  preconditionDecision: PreconditionOrderingDecision | null;
}): Promise<{ id: string } | null> {
  let actor: GaidActorEnvelope | null = null;
  try {
    actor = await resolveGaidActorEnvelope(data.args);
  } catch {
    return null;
  }
  if (!actor) return null;
  const reservedResult: ToolResult = { success: false, error: "execution_reserved", message: "Consequential execution reserved." };
  const row = {
    buildId: null,
    executionStatus: "reserved",
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    inputFingerprint: digestPayload({ params: data.args.rawParams, toolName: data.args.toolName }),
    outputDigest: receiptOutput({
      result: reservedResult, toolName: data.args.toolName, actor, context: data.args.context,
      consequential: true, alignmentDecision: data.alignmentDecision,
      preconditionDecision: data.preconditionDecision,
    }),
    receiptKind: receiptKind(data.args.toolName, data.args.context, true)!,
    receiptStatus: "reserved",
    toolExecutionId: data.auditRowId,
  };
  try {
    const created = createOverride
      ? await createOverride(row)
      : await prisma.toolExecutionReceipt.create({ data: row, select: { id: true } });
    return typeof (created as { id?: unknown } | undefined)?.id === "string"
      ? { id: String((created as { id: string }).id) }
      : null;
  } catch {
    return null;
  }
}

export async function finalizeConsequentialToolExecutionReceipt(data: {
  receiptId: string;
  result: ToolResult;
  toolName: string;
  args: GovernedExecuteArgs;
  alignmentDecision: AlignmentGateDecision | null;
  preconditionDecision: PreconditionOrderingDecision | null;
  buildId?: string | null;
}): Promise<void> {
  const actor = await resolveGaidActorEnvelope(data.args);
  const update = {
    ...(data.buildId ? { buildId: data.buildId } : {}),
    executionStatus: data.result.success ? "succeeded" : "failed",
    receiptStatus: data.result.success ? "valid" : "invalid",
    outputDigest: receiptOutput({
      result: data.result, toolName: data.toolName, actor, context: data.args.context,
      consequential: true, alignmentDecision: data.alignmentDecision,
      preconditionDecision: data.preconditionDecision,
    }),
  };
  if (updateOverride) await updateOverride(data.receiptId, update);
  else await prisma.toolExecutionReceipt.update({ where: { id: data.receiptId }, data: update });
}
