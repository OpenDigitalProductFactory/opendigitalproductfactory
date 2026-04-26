import { PLATFORM_TOOLS } from "./mcp-tools";
import type { AuditClass } from "./audit-classes";

export function deriveAuditClassForTool(toolName: string): AuditClass {
  const tool = PLATFORM_TOOLS.find((t) => t.name === toolName);
  if (!tool) return "journal";
  if ("auditClass" in tool && (tool as { auditClass?: AuditClass }).auditClass) {
    return (tool as { auditClass?: AuditClass }).auditClass!;
  }
  if (tool.sideEffect) return "ledger";
  if (tool.requiresExternalAccess) return "journal";
  return "metrics_only";
}

export function deriveCapabilityId(toolName: string): string {
  return `platform:${toolName}`;
}
