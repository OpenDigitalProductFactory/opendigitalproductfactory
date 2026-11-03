import { prisma } from "@dpf/db";
import type { GovernedExecuteArgs } from "@/lib/mcp-governed-execute-types";
import type { ToolResult } from "@/lib/mcp-tool-types";
import { commandAuthorityScopeKey, commandPayloadBinding, lookupReceiptedCommand,
  CommandIdConflictError, ReplayedCommandRejection, type ReceiptDb } from "./command-receipts";
import { originalScopeReleaseTargetsMatch, parseScopeReleaseRequest } from "./scope-release-targets";

type SettledApproval = { envelopeId: string; status: "executed" | "failed"; result: unknown };
type Reader = ReceiptDb & { workroom: { findUnique(args: unknown): Promise<{ id: string; scopeClaims: unknown } | null> } };
export type ScopeReleasePreflightResult =
  | ({ outcome: "settled" } & SettledApproval)
  | { outcome: "settled-command"; result: ToolResult }
  | { outcome: "reject"; rejection: "precondition_denied" | "authority_evidence_unavailable"; message: string };
const invalid = (): ScopeReleasePreflightResult => ({ outcome: "reject", rejection: "precondition_denied",
  message: "The original scope-release targets are missing or changed. No new approval was created. A new release intent requires its own original complete targets." });
const unavailable = (): ScopeReleasePreflightResult => ({ outcome: "reject", rejection: "authority_evidence_unavailable",
  message: "The original scope-release outcome could not be established. No replacement approval or release was created." });

/** Call only after current capability, grant, delegation and result-access authority passed.
 * Exact historical outcomes precede target-dependent checks, never current denials. */
export async function preflightOriginalScopeRelease(
  execution: GovernedExecuteArgs,
  readExactApproval: () => Promise<SettledApproval | null>,
  db: Reader = prisma as unknown as Reader,
): Promise<ScopeReleasePreflightResult | null> {
  if (!["release_workroom_scope", "release_capsule_scope"].includes(execution.toolName)) return null;
  const request = parseScopeReleaseRequest(execution.rawParams);
  if (!request) return invalid();
  try {
    const room = await db.workroom.findUnique({ where: { capsuleId: request.capsuleId }, select: { id: true, scopeClaims: true } });
    if (!room || room.id !== request.expectedRoomId) return invalid();
    const settled = await readExactApproval();
    if (settled) return { outcome: "settled", ...settled };
    if (request.commandId) {
      const { commandId, ...payload } = request;
      try {
        const receipt = await lookupReceiptedCommand<ToolResult>({ db,
          authorityScopeKey: commandAuthorityScopeKey({ userId: execution.userId, agentId: execution.context?.agentId ?? null }),
          commandId, commandType: "release-scope", target: { kind: "workroom", id: request.capsuleId },
          expectedRoomRowId: request.expectedRoomId, payloadBinding: commandPayloadBinding(payload) });
        if (receipt.kind === "settled") {
          if (!receipt.result || typeof receipt.result.success !== "boolean") return unavailable();
          return { outcome: "settled-command", result: receipt.result };
        }
      } catch (error) {
        if (error instanceof CommandIdConflictError) return invalid();
        if (error instanceof ReplayedCommandRejection) {
          const result = error.rejection.data?.result;
          if (result && typeof result === "object" && typeof (result as ToolResult).success === "boolean") {
            return { outcome: "settled-command", result: result as ToolResult };
          }
          return { outcome: "settled-command", result: { success: false, error: error.code, message: error.message } };
        }
        return unavailable();
      }
    }
    return originalScopeReleaseTargetsMatch(room, request.expectedRoomId, request.claims) ? null : invalid();
  } catch { return unavailable(); }
}
