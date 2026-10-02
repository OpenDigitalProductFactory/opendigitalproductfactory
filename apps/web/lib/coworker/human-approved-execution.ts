import "server-only";
import { prisma } from "@dpf/db";
import { fingerprintCoworkerInput } from "@/lib/govern/authority/coworker-authority-decision";
import { isRecord } from "@/lib/shared/coerce";

export type HumanApprovalMarker = { userId: string; approvedAt: string };

export function humanApprovalMarker(userId: string, now = new Date()): HumanApprovalMarker {
  return { userId, approvedAt: now.toISOString() };
}

function parseHumanApprovalMarker(value: unknown, now: number): HumanApprovalMarker | null {
  if (!isRecord(value) || typeof value.userId !== "string" || typeof value.approvedAt !== "string") return null;
  const approvedAt = Date.parse(value.approvedAt);
  if (!Number.isFinite(approvedAt) || approvedAt > now) return null;
  return { userId: value.userId, approvedAt: value.approvedAt };
}

/** The monitor supplies the reserved envelope id, never tool arguments. This
 * reads the existing envelope; it creates no additional approval or grant. */
export async function humanApprovalForExecution(args: {
  envelopeId?: string | null;
  toolName: string;
  userId: string;
  agentId?: string | null;
  params: Record<string, unknown>;
}): Promise<{ envelopeId: string; userId: string } | null> {
  if (!args.envelopeId || !args.agentId) return null;
  const row = await prisma.coworkerActionEnvelope.findUnique({ where: { id: args.envelopeId } });
  const now = Date.now();
  // The executor's compare-and-set reserves once by setting resolvedAt while
  // status remains approved; it finalizes to executed after the handler.
  if (!row || row.status !== "approved" || !row.resolvedAt
    || !row.expiresAt || row.expiresAt.getTime() <= now
    || row.manifestActionId !== args.toolName
    || row.delegatingUserId !== args.userId || row.coworkerAgentId !== args.agentId
    || row.inputFingerprint !== fingerprintCoworkerInput(args.params)) return null;
  const approval = parseHumanApprovalMarker(isRecord(row.argsJson) ? row.argsJson.humanApproval : null, now);
  if (approval?.userId !== args.userId) return null;
  return { envelopeId: row.id, userId: args.userId };
}
