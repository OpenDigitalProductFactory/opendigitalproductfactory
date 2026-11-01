// A Workroom MCP write that carries `commandId` runs once (BI-763D6E01).
//
// The tool's own handler runs inside the receipt's transaction: while it runs,
// `commandDb()` hands every store write that same transaction client, so the
// effect, its lease renewal and its receipt commit together under the room's
// row lock. A call without `commandId` runs exactly as before. A refused call
// (`success: false`) rolls back whatever it touched and stores the refusal, so
// a retry gets the same answer.

import { AsyncLocalStorage } from "node:async_hooks";

import { prisma } from "@dpf/db";
import type { ToolResult, ToolExecutionContext } from "@/lib/mcp-tool-types";
import { isRecord } from "@/lib/shared/coerce";

import {
  CommandIdConflictError,
  CommandReceiptUnavailableError,
  type CommandPayloadBinding,
  ReplayedCommandRejection,
  commandAuthorityScopeKey,
  runReceiptedCommand,
  type ReceiptDb,
} from "./command-receipts";
import type { CapsuleDb } from "./work-capsule-store-types";

const commandTransaction = new AsyncLocalStorage<{ db: CapsuleDb; bound: boolean }>();

/** The receipt transaction while a receipted command runs; the shared client otherwise. */
export function commandDb(): CapsuleDb {
  return commandTransaction.getStore()?.db ?? (prisma as unknown as CapsuleDb);
}

/** The exact server-owned client that passed the bound receipt lock prefix.
 * Prisma transaction clients may expose $transaction for nested savepoints. */
export function hasBoundCommandTransaction(candidate: CapsuleDb): boolean {
  const active = commandTransaction.getStore();
  return active?.bound === true && active.db === candidate;
}

class ToolRefusal extends Error {
  constructor(readonly result: ToolResult) {
    super(result.message ?? "refused");
    this.name = "ToolRefusal";
  }
}

type Handler = (params: Record<string, unknown>, userId: string, context: ToolExecutionContext | undefined) => Promise<ToolResult>;

const MAX_COMMAND_ID = 200;

export type BoundCommandPreparation = {
  params: Record<string, unknown>;
  payloadBinding: CommandPayloadBinding;
  expectedRoomRowId?: string;
  beforeRoomLock?: (tx: ReceiptDb) => Promise<void>;
  /** Best-effort wake-up for the actual durable receipt, outside every transaction. */
  afterCommit?: (receipt: { id: string; workCapsuleId: string }, result: ToolResult) => void | Promise<void>;
};
export type ReceiptedWorkroomToolOptions = {
  /** Establish bounded external proof before opening the receipt transaction. */
  prepareAsync?: (params: Record<string, unknown>, userId: string, context: ToolExecutionContext | undefined)
    => Promise<BoundCommandPreparation | { refusal: ToolResult } | undefined>;
  /** Validate and normalize before even a cached result is considered. Undefined retains legacy behavior. */
  prepare?: (params: Record<string, unknown>) => BoundCommandPreparation | { refusal: ToolResult } | undefined;
};

/** Wrap a Workroom tool so a `commandId` makes it run once per caller. */
export function receiptedWorkroomTool(commandType: string, handler: Handler, options: ReceiptedWorkroomToolOptions = {}): Handler {
  return async (params, userId, context) => {
    const preparation = options.prepareAsync ? await options.prepareAsync(params, userId, context) : options.prepare?.(params);
    if (preparation && "refusal" in preparation) return preparation.refusal;
    const normalized = preparation?.params ?? params;
    const raw = normalized["commandId"];
    const commandId = typeof raw === "string" ? raw.trim() : "";
    if (!commandId && !preparation) return handler(params, userId, context);
    const capsuleId = typeof normalized["capsuleId"] === "string" ? normalized["capsuleId"].trim() : "";
    if (!commandId || commandId.length > MAX_COMMAND_ID || !capsuleId) {
      return {
        success: false,
        error: "invalid_input",
        message: `commandId must be nonempty and at most ${MAX_COMMAND_ID} characters and needs a capsuleId.`,
      };
    }
    const authorityScopeKey = commandAuthorityScopeKey({ userId, agentId: context?.agentId ?? null });
    let result: ToolResult;
    try {
      result = await runReceiptedCommand<ToolResult>({
        db: prisma as unknown as ReceiptDb,
        authorityScopeKey,
        commandId,
        commandType,
        target: { kind: "workroom", id: capsuleId },
        actor: { userId, agentId: context?.agentId ?? null },
        payloadBinding: preparation?.payloadBinding,
        expectedRoomRowId: preparation?.expectedRoomRowId,
        beforeRoomLock: preparation?.beforeRoomLock,
        run: (tx) => commandTransaction.run({ db: tx as unknown as CapsuleDb, bound: preparation?.payloadBinding !== undefined }, async () => {
          const result = await handler(normalized, userId, context);
          if (!result.success) throw new ToolRefusal(result);
          return result;
        }),
        rejectionOf: (error) => error instanceof ToolRefusal
          ? { code: error.result.error ?? "refused", message: error.message, data: { result: error.result as never } }
          : null,
      });
    } catch (error) {
      if (error instanceof ToolRefusal) result = error.result;
      else if (error instanceof ReplayedCommandRejection) {
        const stored = error.rejection.data?.["result"] as ToolResult | undefined;
        result = stored ?? { success: false, error: error.code, message: error.message };
      } else if (error instanceof CommandIdConflictError || error instanceof CommandReceiptUnavailableError) {
        return { success: false, error: error.code, message: error.message };
      } else throw error;
    }
    if (preparation?.afterCommit) {
      // A result or typed stored refusal confirms durability. Unknown transport
      // or commit errors exit above, even if an effect may actually exist.
      try {
        const receipt = await prisma.workroomActivity.findFirst({
          where: { commandScopeKey: authorityScopeKey, commandKey: commandId },
          select: { id: true, workCapsuleId: true, kind: true, payload: true },
        });
        const payload = isRecord(receipt?.payload) ? receipt.payload : null;
        const binding = isRecord(payload?.payloadBinding) ? payload.payloadBinding : null;
        const target = isRecord(payload?.target) ? payload.target : null;
        if (receipt && receipt.kind === (result.success ? "command-accepted" : "command-rejected")
          && payload?.commandType === commandType && target?.kind === "workroom" && target.id === capsuleId
          && binding?.version === preparation.payloadBinding.version && binding.digest === preparation.payloadBinding.digest) {
          await preparation.afterCommit({ id: receipt.id, workCapsuleId: receipt.workCapsuleId }, result);
        }
      } catch {
        // Wake-up transport is best effort. Never turn a committed result into
        // a failure that suggests the effect should be run again.
        console.warn("[workroom-command] Committed receipt notification unavailable.");
      }
    }
    return result;
  };
}
