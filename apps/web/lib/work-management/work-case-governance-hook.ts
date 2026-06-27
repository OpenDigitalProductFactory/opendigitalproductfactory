import type { ToolLifecycleHook } from "../mcp-governed-execute";
import {
  evaluateWorkCasePolicy,
  type WorkCasePolicyInput,
} from "./policy-envelope";

export type WorkCaseExecutionContext = WorkCasePolicyInput;

export function createWorkCaseGovernanceHook(): ToolLifecycleHook {
  return {
    id: "work-case-governance",
    onPreToolUse: async (event) => {
      const workCase = event.context?.workCase;
      if (!workCase) {
        return {
          decision: "allow",
          reason: "No Work Case context supplied.",
        };
      }

      const decision = evaluateWorkCasePolicy(workCase);
      if (!decision.ok) {
        return {
          decision: "deny",
          reason: `Work Case policy denied ${workCase.action}: ${decision.reason} - ${decision.message}`,
        };
      }

      return {
        decision: "allow",
        reason: `Work Case policy allowed ${workCase.action}.`,
      };
    },
  };
}
