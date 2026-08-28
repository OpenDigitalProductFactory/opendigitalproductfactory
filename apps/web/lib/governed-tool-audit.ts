import { prisma } from "@dpf/db";

import type { AlignmentGateDecision } from "./tak/alignment-tool-gate";
import type { PreconditionOrderingDecision } from "./tak/precondition-ordering-gate";
import { deriveAuditClassForTool, deriveCapabilityId } from "./tool-audit-helpers";
import type { GovernedExecuteContext, GovernedExecuteSource } from "./mcp-governed-execute";
import type { ToolDefinition, ToolResult } from "./mcp-tools";

let createOverride: ((data: Record<string, unknown>) => Promise<unknown>) | null = null;
let updateOverride: ((id: string, data: Record<string, unknown>) => Promise<unknown>) | null = null;

export function setGovernedToolAuditOverridesForTests(overrides: {
  create?: ((data: Record<string, unknown>) => Promise<unknown>) | null;
  update?: ((id: string, data: Record<string, unknown>) => Promise<unknown>) | null;
}): void {
  createOverride = overrides.create ?? null;
  updateOverride = overrides.update ?? null;
}

function redactWriteOnlyParameters(
  value: Record<string, unknown>, schema: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const properties = schema?.properties && typeof schema.properties === "object"
    ? schema.properties as Record<string, unknown> : {};
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    const property = properties[key] && typeof properties[key] === "object"
      ? properties[key] as Record<string, unknown> : undefined;
    if (property?.writeOnly === true) return [key, "[REDACTED]"];
    if (entry && typeof entry === "object" && !Array.isArray(entry) && property?.properties) {
      return [key, redactWriteOnlyParameters(entry as Record<string, unknown>, property)];
    }
    return [key, entry];
  }));
}

export async function writeGovernedToolAudit(data: {
  toolName: string;
  tool?: ToolDefinition;
  rawParams: Record<string, unknown>;
  result: ToolResult;
  userId: string;
  source: GovernedExecuteSource;
  context?: GovernedExecuteContext;
  durationMs: number;
  alignmentDecision?: AlignmentGateDecision | null;
  preconditionDecision?: PreconditionOrderingDecision | null;
}): Promise<{ id: string } | null> {
  const auditClass = deriveAuditClassForTool(data.toolName);
  const isMetricsOnly = auditClass === "metrics_only";
  const retainParameters = !isMetricsOnly || data.tool?.retainAuditParameters === true;
  const redactedParameters = redactWriteOnlyParameters(data.rawParams, data.tool?.inputSchema);
  const row = {
    threadId: data.context?.threadId ?? "", agentId: data.context?.agentId ?? "unknown",
    userId: data.userId, taskRunId: data.context?.taskRunId ?? null, toolName: data.toolName,
    parameters: retainParameters ? {
      ...redactedParameters,
      ...(data.context?.surfaceInvocation ? { _surface: data.context.surfaceInvocation } : {}),
      ...(data.alignmentDecision ? { _takAlignment: {
        interactionId: data.alignmentDecision.interactionId,
        verdict: data.alignmentDecision.verdict,
        policyVersion: data.alignmentDecision.policyVersion ?? null,
        checks: data.alignmentDecision.alignment.checks,
      } } : {}),
      ...(data.preconditionDecision ? { _takPrecondition: data.preconditionDecision } : {}),
    } : {},
    result: isMetricsOnly ? {} : data.result as unknown as object,
    success: data.result.success, executionMode: data.source,
    routeContext: data.context?.routeContext ?? null, durationMs: data.durationMs,
    auditClass, capabilityId: deriveCapabilityId(data.toolName),
    summary: isMetricsOnly
      ? `${data.toolName}: ${data.result.success ? "ok" : "failed"}${data.durationMs ? ` (${data.durationMs}ms)` : ""}`
      : null,
    apiTokenId: data.context?.apiTokenId ?? null, skillId: data.context?.skillId ?? null,
    delegationChainId: data.context?.delegationChainId ?? null,
  };
  try {
    const created = createOverride
      ? await createOverride(row)
      : await prisma.toolExecution.create({ data: row, select: { id: true } });
    return typeof (created as { id?: unknown } | undefined)?.id === "string"
      ? { id: String((created as { id: string }).id) } : null;
  } catch (err) {
    console.error(
      "[governed-execute] audit write failed tool=%s source=%s: %s",
      JSON.stringify(data.toolName), JSON.stringify(data.source),
      err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
    );
    return null;
  }
}

export async function updateGovernedToolAudit(id: string, result: ToolResult, durationMs: number): Promise<void> {
  const data = { result: result as unknown as object, success: result.success, durationMs };
  try {
    if (updateOverride) await updateOverride(id, data);
    else await prisma.toolExecution.update({ where: { id }, data });
  } catch (err) {
    console.error(
      "[governed-execute] reserved audit finalization failed execution=%s: %s",
      JSON.stringify(id), err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
    );
  }
}
