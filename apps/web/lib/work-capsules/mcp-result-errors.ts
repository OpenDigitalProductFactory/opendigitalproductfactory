import type { ToolResult } from "@/lib/mcp-tools";
import { CapsuleBranchOccupiedError } from "./work-capsule-branch-identity";
import { ScopeClaimLeaseHeldError } from "./scope-claim-lease";
import { ScopeOverlapError } from "./work-capsule-store";

/** The two ways a scope claim is refused without writing anything. */
export function scopeClaimRefusal(error: unknown): ToolResult | null {
  if (error instanceof ScopeOverlapError) {
    return {
      success: false,
      error: "scope_conflict",
      message:
        `Scope overlaps ${error.conflicts.length} active claim(s) on another Work Capsule. ` +
        "Coordinate with the holder, claim different scope, or pass force=true to deliberately co-claim.",
      data: { conflicts: error.conflicts },
    };
  }
  // BI-2D65BD1B: a plain claim never takes another principal's live lease.
  if (error instanceof ScopeClaimLeaseHeldError) {
    return {
      success: false,
      error: "lease_held",
      message: error.message,
      data: { holderPrincipalId: error.holderPrincipalId, leaseExpiresAt: error.leaseExpiresAt.toISOString() },
    };
  }
  return null;
}

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
