import type { ToolResult } from "@/lib/mcp-tools";
import { CapsuleBranchOccupiedError } from "./work-capsule-branch-identity";

export function branchOccupiedResult(error: unknown): ToolResult | null {
  if (!(error instanceof CapsuleBranchOccupiedError)) return null;
  return {
    success: false,
    error: "branch_occupied",
    message: error.message,
    data: {
      capsuleId: error.capsuleId,
      status: error.status,
      backlogItemId: error.backlogItemId,
    },
  };
}

export function invalidScopeResult(error: unknown): ToolResult {
  return {
    success: false,
    error: "invalid_scope",
    message: error instanceof Error ? error.message : "Invalid Work Capsule scope metadata.",
  };
}
