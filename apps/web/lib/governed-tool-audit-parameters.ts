// Pure audit policy shared by persistence and delayed-approval admission.
// Registry lookup belongs to tool-audit-helpers, never this dependency leaf.
import type { AuditClass } from "./audit-classes";
import type { ToolDefinition } from "./mcp-tool-types";
import { boundLargeStrings } from "./evidence/bounded-evidence-output";
import { TASK_EXECUTION_FENCE_AUDIT_KEY } from "./attention/coworker-envelope-decision";

export function deriveToolAuditClass(tool: ToolDefinition | undefined): AuditClass {
  if (!tool) return "journal";
  if ("auditClass" in tool && (tool as { auditClass?: AuditClass }).auditClass) {
    return (tool as { auditClass?: AuditClass }).auditClass!;
  }
  if (tool.sideEffect) return "ledger";
  if (tool.requiresExternalAccess) return "journal";
  return "metrics_only";
}

function redactWriteOnlyParameters(value: Record<string, unknown>, schema: Record<string, unknown> | undefined): Record<string, unknown> {
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

/** Exact parameter projection available to the runner; null means payloads
 * are dropped. The caller supplies the canonical resolved audit class. */
export function retainedGovernedToolParameters(data: {
  tool?: ToolDefinition; rawParams: Record<string, unknown>;
}, auditClass: AuditClass): Record<string, unknown> | null {
  if (auditClass === "metrics_only" && data.tool?.retainAuditParameters !== true) return null;
  const parameters = { ...boundLargeStrings(redactWriteOnlyParameters(data.rawParams, data.tool?.inputSchema)) };
  delete parameters[TASK_EXECUTION_FENCE_AUDIT_KEY];
  return parameters;
}
