import { scryptSync } from "crypto";
import { prisma } from "@dpf/db";

import type { ToolResult } from "@/lib/mcp-tools";
import type { AlignmentGateDecision } from "./alignment-tool-gate";
import type { GovernedExecuteContext } from "@/lib/mcp-governed-execute";
import { getWorkCaseAction } from "@/lib/work-management/action-registry";

let createOverride: ((data: Record<string, unknown>) => Promise<unknown>) | null = null;
export function setToolExecutionReceiptCreateOverrideForTests(
  override: ((data: Record<string, unknown>) => Promise<unknown>) | null,
): void {
  createOverride = override;
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

export async function writeToolExecutionReceipt(data: {
  auditRowId: string;
  buildId: string | null;
  rawParams: Record<string, unknown>;
  result: ToolResult;
  toolName: string;
  context?: GovernedExecuteContext;
  consequential?: boolean;
  alignmentDecision?: AlignmentGateDecision | null;
}): Promise<void> {
  const kind = receiptKind(data.toolName, data.context, data.consequential);
  if (!kind) return;
  const row = {
    buildId: data.buildId ?? null,
    executionStatus: data.result.success ? "succeeded" : "failed",
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    inputFingerprint: digestPayload({ params: data.rawParams, toolName: data.toolName }),
    outputDigest: { sha256: digestPayload({
      data: data.result.data ?? null,
      error: data.result.error ?? null,
      message: data.result.message ?? null,
      success: data.result.success,
      alignment: data.alignmentDecision ? {
        interactionId: data.alignmentDecision.interactionId,
        verdict: data.alignmentDecision.verdict,
        specialistDelegation: data.alignmentDecision.specialistDelegation ?? null,
      } : null,
    }) },
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
