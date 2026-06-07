// Per-action audit for browser-driving (EP-BROWSER-DRIVE, spec §8.6).
//
// Reuses ToolExecution — no parallel browser action log (Verdict 2). Every
// browser tool call records one row. executionMode conventions:
//   - "immediate"  : read-only (browser_read) actions
//   - "permission" : attended operator-live driving (operator posture active)
//   - "proposal"   : the final envelope-gated side effect (carries envelopeId)

import { prisma } from "@dpf/db";
import type { Prisma } from "@dpf/db";

/** capabilityId stamped on browser-driving executions so the authority surface rolls them up. */
export const BROWSER_DRIVE_CAPABILITY_ID = "browser-drive";

export type BrowserExecutionMode = "immediate" | "permission" | "proposal";

export type BrowserToolExecutionInput = {
  threadId: string;
  agentId: string;
  /** Executing identity (the service/coworker principal). */
  userId: string;
  toolName: string;
  parameters: unknown;
  result: unknown;
  success: boolean;
  executionMode: BrowserExecutionMode;
  routeContext?: string | null;
  durationMs?: number | null;
  /** Human the coworker acted for (distinct from userId). */
  delegatingUserId?: string | null;
  /** CoworkerActionEnvelope that approved a destructive action. */
  envelopeId?: string | null;
};

/** Record one browser tool call to ToolExecution with the browser-driving conventions. */
export async function recordBrowserToolExecution(input: BrowserToolExecutionInput) {
  return prisma.toolExecution.create({
    data: {
      threadId: input.threadId,
      agentId: input.agentId,
      userId: input.userId,
      toolName: input.toolName,
      parameters: (input.parameters ?? {}) as Prisma.InputJsonValue,
      result: (input.result ?? {}) as Prisma.InputJsonValue,
      success: input.success,
      executionMode: input.executionMode,
      routeContext: input.routeContext ?? null,
      durationMs: input.durationMs ?? null,
      delegatingUserId: input.delegatingUserId ?? null,
      envelopeId: input.envelopeId ?? null,
      capabilityId: BROWSER_DRIVE_CAPABILITY_ID,
    },
  });
}
