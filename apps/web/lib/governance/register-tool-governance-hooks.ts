import { createCompletionEvidenceGovernanceHook } from "@/lib/backlog/completion-evidence-governance-hook";
import { registerToolLifecycleHook } from "@/lib/mcp-governed-execute";
import { createDecisionRoutingGovernanceHook } from "@/lib/tak/decision-routing-governance-hook";

export function registerServerToolGovernanceHooks(): void {
  registerToolLifecycleHook(createDecisionRoutingGovernanceHook());
  registerToolLifecycleHook(createCompletionEvidenceGovernanceHook());
}
