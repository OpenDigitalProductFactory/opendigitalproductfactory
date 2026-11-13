import { PLATFORM_TOOLS } from "./mcp-tools";
import type { AuditClass } from "./audit-classes";
import { deriveToolAuditClass } from "./governed-tool-audit-parameters";

export function deriveAuditClassForTool(toolName: string): AuditClass {
  return deriveToolAuditClass(PLATFORM_TOOLS.find((t) => t.name === toolName));
}

export function deriveCapabilityId(toolName: string): string {
  return `platform:${toolName}`;
}
