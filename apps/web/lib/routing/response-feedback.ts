import { prisma, type Prisma } from "@dpf/db";
import { currentUserContext } from "@/lib/govern/current-user-context";
import { isPlatformAutomationPersona } from "@/lib/govern/automation-persona-identity";
import { resolveCanonicalWorkroomActorAccess } from "@/lib/work-management/workroom-agent-access.server";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { isRolledBackPostgresConflict } from "@/lib/shared/postgres-transaction-conflict";
import { responseContentDigest } from "./response-producer";

/** Constructed by authenticated adapters, never from feedback/tool arguments. */
export type ResponseFeedbackActor = { userId: string; agentId?: string; surface?: "portal" | "mcp" | "internal" };
export type ResponseFeedbackState = {
  messageId: string;
  available: boolean;
  unavailableReason: "unavailable" | null;
  value: boolean | null;
  source: "human" | "agent" | null;
  actorLabel: string | null;
  acceptedAt: string | null;
  revision: number;
  canWrite: boolean;
};
export type ResponseFeedbackInput = { messageId: string; value: boolean | null; expectedRevision: number };
export type ResponseFeedbackResult = ActionResult<{ state: ResponseFeedbackState; changed: boolean }>;
type FailureCode = "unavailable" | "forbidden" | "conflict" | "save-failed";
class FeedbackRejected extends Error {
  constructor(readonly code: FailureCode) { super(code); }
}
const principalSelect = { id: true, principalId: true, kind: true, status: true, displayName: true } as const;
const messageSelect = {
  id: true, threadId: true, role: true, content: true, providerId: true, modelId: true,
  responseAttemptId: true, responseContentDigest: true, responseScope: true, responseWorkroomId: true,
  thread: { select: { userId: true } },
} as const;
const attemptSelect = {
  id: true, threadId: true, agentMessageId: true, providerId: true, modelId: true,
  status: true, executionMode: true, finishedAt: true, userAccepted: true, acceptedAt: true,
  feedbackPrincipalId: true, feedbackSource: true, feedbackRevision: true,
  feedbackPrincipal: { select: { displayName: true, kind: true } },
} as const;
type Message = Prisma.AgentMessageGetPayload<{ select: typeof messageSelect }>;
type Attempt = Prisma.AdapterRunTelemetryGetPayload<{ select: typeof attemptSelect }>;
type Principal = { id: string; principalId: string; kind: string; status: string; displayName: string };
type Identity = { principal: Principal; source: "human" | "agent" };

function unavailable(messageId: string): ResponseFeedbackState {
  return { messageId, available: false, unavailableReason: "unavailable", value: null, source: null,
    actorLabel: null, acceptedAt: null, revision: 0, canWrite: false };
}

async function identity(actor: ResponseFeedbackActor, tx: Prisma.TransactionClient): Promise<Identity> {
  if (!actor.userId || !await currentUserContext(actor.userId, tx)) throw new FeedbackRejected("forbidden");
  const user = await tx.user.findUnique({ where: { id: actor.userId }, select: { email: true } });
  if (!user || (!actor.agentId && isPlatformAutomationPersona(user.email))) throw new FeedbackRejected("forbidden");
  const human = await tx.principalAlias.findFirst({
    where: { aliasType: "user", aliasValue: actor.userId, issuer: "" }, select: { principal: { select: principalSelect } },
  });
  if (!human || human.principal.kind !== "human" || human.principal.status !== "active") throw new FeedbackRejected("forbidden");
  if (actor.agentId !== undefined) {
    if (!actor.agentId.trim()) throw new FeedbackRejected("forbidden");
    const [alias, agent] = await Promise.all([
      tx.principalAlias.findFirst({ where: { aliasType: "agent", aliasValue: actor.agentId, issuer: "" }, select: { principal: { select: principalSelect } } }),
      tx.agent.findUnique({ where: { agentId: actor.agentId }, select: { status: true, archived: true } }),
    ]);
    if (!alias || alias.principal.kind !== "agent" || alias.principal.status !== "active"
      || !agent || agent.status !== "active" || agent.archived) throw new FeedbackRejected("forbidden");
    return { principal: alias.principal, source: "agent" };
  }
  return { principal: human.principal, source: "human" };
}

async function roomAccess(message: Message, actor: ResponseFeedbackActor, requested: "content" | "action", tx: Prisma.TransactionClient): Promise<boolean> {
  if (message.responseScope === "known_unroomed") return message.responseWorkroomId === null;
  if (message.responseScope !== "workroom" || !message.responseWorkroomId) return false;
  const access = await resolveCanonicalWorkroomActorAccess({
    actor: { userId: actor.userId, agentId: actor.agentId ?? null, principalId: null },
    workroomId: message.responseWorkroomId, requested,
  }, tx);
  return access.decision.level === requested;
}

async function load(messageId: string, actor: ResponseFeedbackActor, tx: Prisma.TransactionClient, requested: "content" | "action", expectedAttemptId?: string) {
  const who = await identity(actor, tx);
  const message = await tx.agentMessage.findUnique({ where: { id: messageId }, select: messageSelect });
  // Missing and foreign messages share the same refusal; neither returns a feedback state.
  if (!message || message.thread.userId !== actor.userId) throw new FeedbackRejected("forbidden");
  if (!message.responseScope || (message.responseScope === "workroom" && !message.responseWorkroomId)
    || (message.responseScope === "known_unroomed" && message.responseWorkroomId)) return null;
  if (!await roomAccess(message, actor, requested, tx)) throw new FeedbackRejected("forbidden");
  if (expectedAttemptId !== undefined && message.responseAttemptId !== expectedAttemptId) return null;
  if (message.role !== "assistant" || !message.content.trim() || !message.responseAttemptId
    || !message.responseContentDigest || !message.providerId || !message.modelId
    || responseContentDigest(message.content) !== message.responseContentDigest) return null;
  const [attempt, bindings] = await Promise.all([
    tx.adapterRunTelemetry.findUnique({ where: { id: message.responseAttemptId }, select: attemptSelect }),
    tx.agentMessage.count({ where: { responseAttemptId: message.responseAttemptId } }),
  ]);
  if (!attempt || attempt.id !== message.responseAttemptId || bindings !== 1 || attempt.agentMessageId !== message.id || attempt.threadId !== message.threadId
    || attempt.providerId !== message.providerId || attempt.modelId !== message.modelId || attempt.status !== "success"
    || !attempt.finishedAt || !["single", "shadow-primary", "race-primary"].includes(attempt.executionMode)) return null;
  return { message, attempt, who };
}

function mayReplace(attempt: Attempt, who: Identity): boolean {
  if (who.source === "human") return true;
  const hasJudgment = attempt.feedbackSource !== null || attempt.feedbackPrincipalId !== null || attempt.userAccepted !== null;
  return !hasJudgment || (attempt.feedbackSource === "agent" && attempt.feedbackPrincipalId === who.principal.id);
}
function state(messageId: string, attempt: Attempt, canWrite: boolean): ResponseFeedbackState {
  return { messageId, available: true, unavailableReason: null, value: attempt.userAccepted,
    source: attempt.feedbackSource, actorLabel: attempt.feedbackSource ? attempt.feedbackPrincipal?.displayName ?? null : null,
    acceptedAt: attempt.acceptedAt?.toISOString() ?? null, revision: attempt.feedbackRevision, canWrite };
}

/** Safe exact-message DTO. Refused actors receive no state, including legacy feedback. */
export async function getResponseFeedback(messageId: string, actor: ResponseFeedbackActor,
  db: Prisma.TransactionClient | typeof prisma = prisma): Promise<ResponseFeedbackState> {
  const loaded = await load(messageId, actor, db, "content");
  if (!loaded) return unavailable(messageId);
  return loadedState(loaded, actor, db);
}

async function loadedState(loaded: NonNullable<Awaited<ReturnType<typeof load>>>, actor: ResponseFeedbackActor,
  db: Prisma.TransactionClient): Promise<ResponseFeedbackState> {
  return state(loaded.message.id, loaded.attempt, mayReplace(loaded.attempt, loaded.who)
    && await roomAccess(loaded.message, actor, "action", db));
}

/** One transactional writer shared by portal, MCP and authorized surfaces. */
export async function recordResponseFeedback(input: ResponseFeedbackInput, actor: ResponseFeedbackActor,
  db: typeof prisma = prisma): Promise<ResponseFeedbackResult> {
  if (!input || typeof input.messageId !== "string" || !input.messageId.trim()
    || (input.value !== null && typeof input.value !== "boolean")
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) return err("unavailable");
  for (let retry = 0; retry < 2; retry++) {
    try {
      return await db.$transaction(async (tx) => {
        const loaded = await load(input.messageId, actor, tx, "action");
        if (!loaded) throw new FeedbackRejected("unavailable");
        const { message, attempt, who } = loaded;
        if (!mayReplace(attempt, who)) throw new FeedbackRejected("forbidden");
        if (attempt.feedbackRevision !== input.expectedRevision) throw new FeedbackRejected("conflict");
        const unchanged = attempt.userAccepted === input.value && (
          (attempt.feedbackPrincipalId === who.principal.id && attempt.feedbackSource === who.source)
          || (input.value === null && attempt.feedbackSource === null && attempt.feedbackPrincipalId === null));
        if (unchanged) return ok({ state: state(message.id, attempt, true), changed: false });
        const acceptedAt = input.value === null ? null : new Date();
        const updated = await tx.adapterRunTelemetry.updateMany({
          where: { id: attempt.id, feedbackRevision: input.expectedRevision },
          data: { userAccepted: input.value, acceptedAt, feedbackPrincipalId: who.principal.id,
            feedbackSource: who.source, feedbackRevision: { increment: 1 } },
        });
        if (updated.count !== 1) throw new FeedbackRejected("conflict");
        // This audit is mandatory and shares the state transaction. A failed write rolls both back.
        await tx.adminActivity.create({ data: {
          userId: actor.userId, toolName: "record_response_feedback", result: "success", tier: 1,
          parameters: { messageId: message.id, threadId: message.threadId, attemptId: attempt.id,
            actingAgentId: actor.agentId ?? null, callingSurface: actor.surface ?? "internal", recordedAt: new Date().toISOString(),
            actorPrincipalId: who.principal.id, source: who.source, workroomId: message.responseWorkroomId,
            previous: { value: attempt.userAccepted, source: attempt.feedbackSource, principalId: attempt.feedbackPrincipalId,
              revision: attempt.feedbackRevision, acceptedAt: attempt.acceptedAt?.toISOString() ?? null },
            next: { value: input.value, source: who.source, revision: input.expectedRevision + 1, acceptedAt: acceptedAt?.toISOString() ?? null } },
          summary: input.value === null ? "Cleared response feedback." : input.value ? "Kept response." : "Response needs revision.",
        } });
        return ok({ changed: true, state: state(message.id, { ...attempt,
          userAccepted: input.value, acceptedAt, feedbackPrincipalId: who.principal.id, feedbackSource: who.source,
          feedbackRevision: input.expectedRevision + 1, feedbackPrincipal: { displayName: who.principal.displayName, kind: who.principal.kind } }, true) });
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error instanceof FeedbackRejected) return err(error.code);
      if (isRolledBackPostgresConflict(error)) {
        if (retry === 0) continue;
        return err("conflict");
      }
      // An unconfirmed outcome is never automatically resubmitted.
      return err("save-failed");
    }
  }
  return err("conflict");
}

export type ResponseFeedbackAnswer = { content: string; state: ResponseFeedbackState; attemptId: string; providerId: string; modelId: string };
/** Explicit content read only. Routine feedback state never includes saved answer text. */
export async function getResponseFeedbackAnswer(messageId: string, expectedAttemptId: string, actor: ResponseFeedbackActor,
  db: Prisma.TransactionClient | typeof prisma = prisma): Promise<ResponseFeedbackAnswer | null> {
  if (typeof expectedAttemptId !== "string" || !expectedAttemptId.trim()) return null;
  const loaded = await load(messageId, actor, db, "content", expectedAttemptId);
  return loaded ? { content: loaded.message.content, state: await loadedState(loaded, actor, db),
    attemptId: loaded.attempt.id, providerId: loaded.attempt.providerId, modelId: loaded.attempt.modelId } : null;
}
