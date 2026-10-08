import "server-only";

// BI-12E5DD91 — a person's approval completes the call it approved.
//
// A coworker call made straight over MCP (no TaskRun) used to park on an
// approval card and then wait for the client to send the identical request
// again. Nothing told the client to; the approval sat `approved` and never ran
// (envelope cmue5mrlr3qw201uu09408gfh, 2026-09-23). A call parked inside an
// external task resumes that task the same way (approved-task-run.ts,
// BI-9FD11E5E); a task the platform runs for itself resumes on its own.
//
// This runs the parked call once, as the person and coworker who made it,
// through the ordinary governed executor: every grant, room, scope and
// authority check is evaluated again, and the gate spends the approval with a
// compare-and-set, so this and a racing client retry can never both run it.
// It runs nothing it cannot prove is the approved call:
//   • the stored arguments must hash to the approved input fingerprint
//     (audit redaction or bounding breaks the match, and then the client's own
//     retry remains the only path);
//   • the originating credential must still be live and still admit the tool;
//   • an OAuth credential's consent must still name the same coworker.
import { prisma } from "@dpf/db";

import { originalToolParameters } from "@/lib/attention/coworker-envelope-decision";
import { currentUserContext } from "@/lib/govern/current-user-context";
import {
  fingerprintCoworkerInput,
  type CoworkerApprovalBinding,
} from "@/lib/govern/authority/coworker-authority-decision";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import type { GovernedExecuteContext } from "@/lib/mcp-governed-execute-types";

import {
  approvalExecutionContext,
  verifyApprovalCredential,
  type ApprovalCredentialDb,
} from "./approved-request-credential";
import { runApprovedTaskRequest, type ApprovedTaskDb } from "./approved-task-run";
import type { ApprovedRequestNotRunReason, ApprovedRequestRun, PlatformRequestRun } from "./approved-request-run-types";
import { readApprovalResumeMarker, type ApprovalResumeMarker } from "./approval-resume-marker";

const NOT_RUN_COPY: Record<ApprovedRequestNotRunReason, string> = {
  "task-bound": "It resumes when your coworker's task continues.",
  "not-approved": "It is not in an approved state.",
  expired: "The approval window closed before it could run.",
  "no-pending-call": "The original request could not be found, so your coworker must send it again.",
  "arguments-not-provable":
    "The stored request could not be proven identical to what you approved, so your coworker must send it again.",
  "credential-unavailable": "The connection that made the request is no longer active, so it was not run.",
  "consent-changed": "The assistant's connection no longer carries the consent it had, so it was not run.",
  "scope-insufficient": "The connection's permissions no longer cover this action, so it was not run.",
  "task-not-waiting": "The task is no longer waiting for this approval; it is already running or settled.",
  "task-waiting-again": "The task continued and is now waiting on another approval.",
};

function notRun(reason: ApprovedRequestNotRunReason): ApprovedRequestRun {
  return { status: "not-run", reason, message: NOT_RUN_COPY[reason] };
}

type RunnerDb = ApprovalCredentialDb & Partial<ApprovedTaskDb> & {
  coworkerActionEnvelope: { findUnique(args: unknown): Promise<{
    id: string; status: string; taskRunId: string | null; expiresAt: Date | null;
    delegatingUserId: string; coworkerAgentId: string; manifestActionId: string; argsJson: unknown;
  } | null> };
  toolExecution: { findFirst(args: unknown): Promise<{ parameters: unknown; apiTokenId: string | null } | null> };
};

type Execute = typeof governedExecuteTool;

function storedBinding(argsJson: unknown): CoworkerApprovalBinding | null {
  const binding = argsJson && typeof argsJson === "object"
    ? (argsJson as Record<string, unknown>)["approvalBinding"]
    : null;
  return binding && typeof binding === "object" ? binding as CoworkerApprovalBinding : null;
}

export async function runApprovedExternalRequest(
  envelopeId: string,
  deps: { db?: RunnerDb; execute?: Execute; now?: Date; resumeTask?: typeof runApprovedTaskRequest } = {},
): Promise<ApprovedRequestRun> {
  const db = deps.db ?? (prisma as unknown as RunnerDb);
  const execute = deps.execute ?? governedExecuteTool;
  const now = deps.now ?? new Date();

  const envelope = await db.coworkerActionEnvelope.findUnique({ where: { id: envelopeId } });
  if (!envelope || envelope.status !== "approved") return notRun("not-approved");
  if (!envelope.expiresAt || envelope.expiresAt.getTime() <= now.getTime()) return notRun("expired");
  if (envelope.taskRunId) {
    const outcome = await (deps.resumeTask ?? runApprovedTaskRequest)({ ...envelope, taskRunId: envelope.taskRunId }, { db: db as never });
    return outcome.status === "not-run" ? notRun(outcome.reason) : outcome;
  }
  const binding = storedBinding(envelope.argsJson);
  if (!binding || binding.taskRunId || binding.routeContext || binding.chainId) return notRun("task-bound");

  const pending = await db.toolExecution.findFirst({
    where: {
      // Rows written before the audit carried the column name it in the result.
      OR: [{ envelopeId }, { result: { path: ["data", "envelopeId"], equals: envelopeId } }],
      success: false,
      toolName: envelope.manifestActionId,
      userId: envelope.delegatingUserId,
      apiTokenId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { parameters: true, apiTokenId: true },
  });
  if (!pending?.apiTokenId) return notRun("no-pending-call");
  const params = originalToolParameters(pending.parameters) ?? {};
  if (fingerprintCoworkerInput(params) !== binding.inputFingerprint) return notRun("arguments-not-provable");

  const credential = await verifyApprovalCredential(db, pending.apiTokenId, {
    delegatingUserId: envelope.delegatingUserId,
    assistantAgentId: envelope.coworkerAgentId,
    manifestActionId: envelope.manifestActionId,
  });
  if (typeof credential === "string") return notRun(credential);

  const userContext = await currentUserContext(envelope.delegatingUserId).catch(() => null)
    ?? { userId: envelope.delegatingUserId, platformRole: null, isSuperuser: false };
  const result = await execute({
    toolName: envelope.manifestActionId,
    rawParams: params,
    userId: envelope.delegatingUserId,
    userContext,
    context: approvalExecutionContext(credential, envelope.coworkerAgentId),
    source: "external-jsonrpc",
  });
  return result.success
    ? { status: "executed", message: result.message ?? "Done." }
    : { status: "failed", message: result.message ?? result.error ?? "The action did not complete." };
}

// ─── Platform-origin requests (BI-C8EC05C9, spec D3) ────────────────────────
//
// A call a platform caller (chat, a scheduled run) parked with
// `approvalCompletion: "platform"` carries the `_approvalResume` marker on its
// park row. Once the person approves, it runs here, once, through the governed
// executor, as the person and coworker who made it. The approve route checks
// for it BEFORE the external runner, because a converted scheduled request has
// a TaskRun and must never be resumed as an external task. Without the marker
// this returns null and the route behaves exactly as before.

type PlatformRunnerDb = {
  coworkerActionEnvelope: { findUnique(args: unknown): Promise<{
    id: string; status: string; taskRunId: string | null; expiresAt: Date | null; threadId: string;
    delegatingUserId: string; coworkerAgentId: string; manifestActionId: string; argsJson: unknown;
  } | null> };
  toolExecution: { findFirst(args: unknown): Promise<{ parameters?: unknown; result?: unknown; threadId?: string | null } | null> };
  agentMessage: { create(args: unknown): Promise<unknown> };
};

/** Re-resolved room authority and external access for a recorded room (room-turn-authority.server.ts). */
export type ResolveApprovalRoom = (input: { agentId: string; workroomId: string }) => Promise<{
  roomAuthority: GovernedExecuteContext["roomAuthority"] | null;
  externalAccessEnabled: boolean;
}>;
/** Re-resolved standing external access for an unroomed turn (scheduled-external-access.ts). */
export type ResolveStandingAccess = (agentId: string) => Promise<boolean>;

const resolveRoomLive: ResolveApprovalRoom = async ({ agentId, workroomId }) => {
  const { loadRoomTurnAuthority } = await import("@/lib/work-management/room-turn-authority.server");
  const { toRoomAuthorityContext } = await import("@/lib/work-management/room-turn-authority");
  const authority = await loadRoomTurnAuthority({ agentId, capsuleId: workroomId });
  return { roomAuthority: toRoomAuthorityContext(authority), externalAccessEnabled: authority.externalAccess.enabled };
};

const resolveStandingAccessLive: ResolveStandingAccess = async (agentId) => {
  const { resolveScheduledTurnExternalAccess } = await import("@/lib/tak/scheduled-external-access");
  return (await resolveScheduledTurnExternalAccess(agentId)).enabled;
};

function resultRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function entityIdOf(result: Record<string, unknown>): { entityId?: string } {
  return typeof result.entityId === "string" ? { entityId: result.entityId } : {};
}

/** The outcome an earlier run of this envelope recorded, for a second call. */
async function recordedPlatformOutcome(
  db: PlatformRunnerDb,
  envelope: { id: string; status: string; manifestActionId: string },
): Promise<PlatformRequestRun> {
  const outcome = envelope.status === "executed" ? "executed" : "failed";
  const run = await db.toolExecution.findFirst({
    where: {
      envelopeId: envelope.id,
      toolName: envelope.manifestActionId,
      ...(outcome === "executed" ? { success: true } : { success: false, NOT: { result: { path: ["error"], equals: "approval_required" } } }),
    },
    orderBy: { createdAt: "desc" },
    select: { result: true },
  });
  const recorded = resultRecord(run?.result);
  const message = typeof recorded.message === "string" ? recorded.message
    : outcome === "executed" ? "It already ran." : "It did not complete.";
  return { status: "settled", outcome, message, ...entityIdOf(recorded) };
}

async function platformExecutionContext(input: {
  envelope: { coworkerAgentId: string; threadId: string };
  binding: CoworkerApprovalBinding;
  parkThreadId: string | null | undefined;
  marker: ApprovalResumeMarker;
  resolveRoom: ResolveApprovalRoom;
  resolveStandingAccess: ResolveStandingAccess;
}): Promise<GovernedExecuteContext> {
  const { binding, marker } = input;
  const agentId = input.envelope.coworkerAgentId;
  const access = marker.externalAccess;
  const room = marker.workroomId ? await input.resolveRoom({ agentId, workroomId: marker.workroomId }) : null;
  const externalAccessEnabled = !access ? undefined
    : access.workroomId && room ? room.externalAccessEnabled
      : await input.resolveStandingAccess(access.standingGrantAgentId ?? agentId);
  const routeContext = binding.routeContext ?? undefined;
  return {
    agentId,
    threadId: input.parkThreadId || input.envelope.threadId,
    ...(binding.taskRunId ? { taskRunId: binding.taskRunId } : {}),
    ...(routeContext ? { routeContext } : {}),
    ...(binding.chainId ? { delegationChainId: binding.chainId } : {}),
    ...(marker.proposeBoundary ? { proposeBoundary: true } : {}),
    approvalCompletion: "platform",
    ...(marker.coworkerReadBaseline ? { coworkerReadBaseline: true } : {}),
    ...(marker.coworkerAuthorizedSurfaceBaseline ? {
      coworkerAuthorizedSurfaceBaseline: true,
      authorizedSurfaceContext: {
        mode: marker.authorizedSurfaceMode ?? "background",
        route: routeContext,
        ...(marker.workroomId ? { workroomId: marker.workroomId } : {}),
      },
    } : {}),
    ...(marker.featureBuildId ? { featureBuildId: marker.featureBuildId } : {}),
    ...(room?.roomAuthority ? { roomAuthority: room.roomAuthority } : {}),
    ...(externalAccessEnabled !== undefined ? { externalAccessEnabled } : {}),
  };
}

export async function runApprovedPlatformRequest(
  envelopeId: string,
  deps: {
    db?: PlatformRunnerDb;
    execute?: Execute;
    now?: Date;
    resolveRoom?: ResolveApprovalRoom;
    resolveStandingAccess?: ResolveStandingAccess;
  } = {},
): Promise<PlatformRequestRun | null> {
  const db = deps.db ?? (prisma as unknown as PlatformRunnerDb);
  const execute = deps.execute ?? governedExecuteTool;
  const now = deps.now ?? new Date();

  const envelope = await db.coworkerActionEnvelope.findUnique({ where: { id: envelopeId } });
  if (!envelope) return null;
  const park = await db.toolExecution.findFirst({
    where: {
      // A re-raised request's copied park row names the new envelope only in its result (envelope-reraise.ts).
      OR: [{ envelopeId }, { result: { path: ["data", "envelopeId"], equals: envelopeId } }],
      success: false,
      toolName: envelope.manifestActionId,
      userId: envelope.delegatingUserId,
      apiTokenId: null,
    },
    orderBy: { createdAt: "desc" },
    select: { parameters: true, result: true, threadId: true },
  });
  const marker = readApprovalResumeMarker(park?.parameters);
  if (!park || !marker) return null;

  if (envelope.status === "executed" || envelope.status === "failed") return recordedPlatformOutcome(db, envelope);
  if (envelope.status !== "approved") return notRun("not-approved");
  if (!envelope.expiresAt || envelope.expiresAt.getTime() <= now.getTime()) return notRun("expired");
  if (resultRecord(park.result).error !== "approval_required") return notRun("no-pending-call");
  const binding = storedBinding(envelope.argsJson);
  if (!binding) return notRun("arguments-not-provable");
  const params = originalToolParameters(park.parameters) ?? {};
  if (fingerprintCoworkerInput(params) !== binding.inputFingerprint) return notRun("arguments-not-provable");

  const userContext = await currentUserContext(envelope.delegatingUserId).catch(() => null)
    ?? { userId: envelope.delegatingUserId, platformRole: null, isSuperuser: false };
  const context = await platformExecutionContext({
    envelope, binding, parkThreadId: park.threadId, marker,
    resolveRoom: deps.resolveRoom ?? resolveRoomLive,
    resolveStandingAccess: deps.resolveStandingAccess ?? resolveStandingAccessLive,
  });
  const result = await execute({
    toolName: envelope.manifestActionId,
    rawParams: params,
    userId: envelope.delegatingUserId,
    userContext,
    context,
    // The marker's source, never the row's executionMode (Ask again rewrites it).
    source: marker.source,
  });

  // Tell the coworker what happened in the thread it asked from, as
  // approveProposal does today, so it does not ask again.
  const summary = result.success
    ? `${envelope.manifestActionId} completed successfully.${result.message ? ` ${result.message.slice(0, 500)}` : ""}`
    : `${envelope.manifestActionId} failed: ${result.error ?? result.message ?? "unknown error"}`;
  await db.agentMessage.create({
    data: { threadId: context.threadId, role: "system", content: summary, agentId: envelope.coworkerAgentId },
  }).catch(() => undefined);

  const entity = entityIdOf(result as unknown as Record<string, unknown>);
  if (result.governance?.approvalReplayOf) {
    return { status: "settled", outcome: result.success ? "executed" : "failed", message: result.message ?? "", ...entity };
  }
  return result.success
    ? { status: "executed", message: result.message ?? "Done.", ...entity }
    : { status: "failed", message: result.message ?? result.error ?? "The action did not complete." };
}
