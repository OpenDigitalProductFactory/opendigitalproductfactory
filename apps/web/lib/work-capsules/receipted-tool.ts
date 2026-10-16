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
import type { ToolResult } from "@/lib/mcp-tool-types";

import {
  CommandIdConflictError,
  ReplayedCommandRejection,
  commandAuthorityScopeKey,
  runReceiptedCommand,
  type ReceiptDb,
} from "./command-receipts";
import type { CapsuleDb } from "./work-capsule-store-types";

const commandTransaction = new AsyncLocalStorage<CapsuleDb>();

/** The receipt transaction while a receipted command runs; the shared client otherwise. */
export function commandDb(): CapsuleDb {
  return commandTransaction.getStore() ?? (prisma as unknown as CapsuleDb);
}

class ToolRefusal extends Error {
  constructor(readonly result: ToolResult) {
    super(result.message ?? "refused");
    this.name = "ToolRefusal";
  }
}

type Handler = (params: Record<string, unknown>, userId: string, context: { agentId?: string } | undefined) => Promise<ToolResult>;

const MAX_COMMAND_ID = 200;

/** Wrap a Workroom tool so a `commandId` makes it run once per caller. */
export function receiptedWorkroomTool(commandType: string, handler: Handler): Handler {
  return async (params, userId, context) => {
    const raw = params["commandId"];
    const commandId = typeof raw === "string" ? raw.trim() : "";
    if (!commandId) return handler(params, userId, context);
    const capsuleId = typeof params["capsuleId"] === "string" ? params["capsuleId"].trim() : "";
    if (commandId.length > MAX_COMMAND_ID || !capsuleId) {
      return {
        success: false,
        error: "invalid_input",
        message: `commandId must be at most ${MAX_COMMAND_ID} characters and needs a capsuleId.`,
      };
    }
    try {
      return await runReceiptedCommand<ToolResult>({
        db: prisma as unknown as ReceiptDb,
        authorityScopeKey: commandAuthorityScopeKey({ userId, agentId: context?.agentId ?? null }),
        commandId,
        commandType,
        target: { kind: "workroom", id: capsuleId },
        actor: { userId, agentId: context?.agentId ?? null },
        run: (tx) => commandTransaction.run(tx as unknown as CapsuleDb, async () => {
          const result = await handler(params, userId, context);
          if (!result.success) throw new ToolRefusal(result);
          return result;
        }),
        rejectionOf: (error) => error instanceof ToolRefusal
          ? { code: error.result.error ?? "refused", message: error.message, data: { result: error.result as never } }
          : null,
      });
    } catch (error) {
      if (error instanceof ToolRefusal) return error.result;
      if (error instanceof ReplayedCommandRejection) {
        const stored = error.rejection.data?.["result"] as ToolResult | undefined;
        return stored ?? { success: false, error: error.code, message: error.message };
      }
      if (error instanceof CommandIdConflictError) {
        return { success: false, error: error.code, message: error.message };
      }
      throw error;
    }
  };
}
