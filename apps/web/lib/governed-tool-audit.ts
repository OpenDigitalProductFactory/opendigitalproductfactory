import { prisma, type GppPermitVerdict } from "@dpf/db";

import type { AlignmentGateDecision } from "./tak/alignment-tool-gate";
import type { PreconditionOrderingDecision } from "./tak/precondition-ordering-types";
import { deriveAuditClassForTool, deriveCapabilityId } from "./tool-audit-helpers";
import { boundLargeStrings } from "./evidence/bounded-evidence-output";
import type { GovernedExecuteContext, GovernedExecuteSource } from "./mcp-governed-execute-types";
import type { ToolDefinition, ToolResult } from "./mcp-tool-types";

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
  /** The approval this run spent, or the one it is parked on (BI-12E5DD91). */
  envelopeId?: string | null;
  /** GPP Phase 2 PR-C: the shadow permit verdict for an O/A/I call. Omitted for R/W calls. */
  gppPermit?: { permitId: string | null; verdict: GppPermitVerdict } | null;
}): Promise<{ id: string } | null> {
  const auditClass = deriveAuditClassForTool(data.toolName);
  const isMetricsOnly = auditClass === "metrics_only";
  const retainParameters = !isMetricsOnly || data.tool?.retainAuditParameters === true;
  // BI-39AAE9B8: the ledger records THAT a call happened and what it carried,
  // by digest — never a multi-megabyte payload. Any string leaf above the
  // ceiling becomes {__dpfBounded, sha256, byteLength, head}; the durable full
  // copy is the evidence record's blob (same sha256), not this row.
  const redactedParameters = boundLargeStrings(
    redactWriteOnlyParameters(data.rawParams, data.tool?.inputSchema),
  );
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
    // Metrics-only rows drop payloads, but a failure with no error code is
    // indistinguishable from a crash. Keep the code alone so the efficiency
    // scan can tell a governed refusal from a fault (BI-MCP-EFF query_detections,
    // surface_open, and the other read tools whose results were `{}`).
    result: isMetricsOnly ? metricsOnlyResult(data.result) : data.result as unknown as object,
    success: data.result.success, executionMode: data.source,
    routeContext: data.context?.routeContext ?? null, durationMs: data.durationMs,
    auditClass, capabilityId: deriveCapabilityId(data.toolName),
    // The elapsed time is the `durationMs` column above. It is deliberately NOT
    // folded into `summary`: the summary is read as a stable identity for the row
    // (the pattern observer substring-matches it, the operations map and evidence
    // search display it), and embedding wall-clock gave two otherwise identical
    // calls two different summaries — which flaked AC-ENFORCE's deep-equal on
    // 0ms vs 1ms. One fact, one column.
    summary: isMetricsOnly
      ? `${data.toolName}: ${data.result.success ? "ok" : "failed"}`
      : null,
    apiTokenId: data.context?.apiTokenId ?? null, skillId: data.context?.skillId ?? null,
    delegationChainId: data.context?.delegationChainId ?? null,
    envelopeId: data.envelopeId ?? pendingEnvelopeId(data.result),
    ...(data.gppPermit ? {
      gppPermitVerdict: data.gppPermit.verdict,
      ...(data.gppPermit.permitId ? { gppPermitRef: data.gppPermit.permitId } : {}),
    } : {}),
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

/** A parked call's audit row names the envelope it waits on, so the approval
 *  card and the approved-request runner join on a column, not JSON. */
function metricsOnlyResult(result: ToolResult): { error: string } | Record<string, never> {
  if (result.success) return {};
  return typeof result.error === "string" && result.error.length > 0
    ? { error: result.error }
    : {};
}

function pendingEnvelopeId(result: ToolResult): string | null {
  if (result.error !== "approval_required") return null;
  const data = result.data as Record<string, unknown> | undefined;
  return typeof data?.["envelopeId"] === "string" ? data["envelopeId"] : null;
}
