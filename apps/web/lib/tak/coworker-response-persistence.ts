import { isPortalContextSupportedPath, normalizePortalContextPathname, resolveCapsuleIdFromPathname } from "../coworker/agent-coworker-core";
import { prisma, type Prisma } from "@dpf/db";
import { preserveResponseProducer, responseContentDigest, type ResponseProducer } from "../routing/response-producer";
type PersistenceDb = Pick<typeof prisma, "agentMessage" | "agentThread" | "taskRun" | "workroom">;
export type ResponseSaveScope = {
  userId: string;
  threadId: string;
  taskRunId: string | null;
  requestedWorkroomId: string | null;
  serverContextResolved: boolean;
};
type PersistedResponseScope = {
  responseScope: "known_unroomed" | "workroom" | null;
  responseWorkroomId: string | null;
};
type ResponseCreateData = Omit<Prisma.AgentMessageUncheckedCreateInput,
  "responseAttemptId" | "responseContentDigest" | "responseScope" | "responseWorkroomId">;

/** Scope is captured from this server save envelope, never a latest room guess. */
export async function resolveResponseSaveScope(
  input: ResponseSaveScope,
  db: PersistenceDb = prisma,
): Promise<PersistedResponseScope> {
  const unavailable: PersistedResponseScope = { responseScope: null, responseWorkroomId: null };
  try {
    const thread = await db.agentThread.findUnique({
      where: { id: input.threadId },
      select: { userId: true, contextKey: true },
    });
    if (!thread || thread.userId !== input.userId || !thread.contextKey.startsWith("coworker:/")) return unavailable;
    const pathname = normalizePortalContextPathname(thread.contextKey.slice("coworker:".length));
    const recordedRoom = resolveCapsuleIdFromPathname(pathname);
    // Ordinary routes have no portal envelope by design. A supported route whose
    // context failed, or an omitted room recorded on the thread, stays unknown.
    if ((!input.serverContextResolved && isPortalContextSupportedPath(pathname))
      || (recordedRoom && !input.requestedWorkroomId)) return unavailable;
    const task = input.taskRunId ? await db.taskRun.findUnique({
      where: { taskRunId: input.taskRunId },
      select: { id: true, taskRunId: true, userId: true, threadId: true },
    }) : null;
    if (input.taskRunId && (!task || task.userId !== input.userId || task.threadId !== input.threadId)) return unavailable;
    if (!input.taskRunId && (await db.taskRun.findMany({
      where: { userId: input.userId, threadId: input.threadId, archivedAt: null },
      select: { id: true }, take: 2,
    })).length) return unavailable;
    const linked = task ? await db.workroom.findMany({
      where: { taskRunId: task.id },
      select: { id: true, capsuleId: true, taskRunId: true }, take: 2,
    }) : [];
    if (!input.requestedWorkroomId) return linked.length
      ? unavailable
      : { responseScope: "known_unroomed", responseWorkroomId: null };
    const rooms = await db.workroom.findMany({
      where: { OR: [{ id: input.requestedWorkroomId }, { capsuleId: input.requestedWorkroomId }] },
      select: { id: true, capsuleId: true, taskRunId: true }, take: 2,
    });
    const room = rooms.length === 1 ? rooms[0] : null;
    if (!room
      || (recordedRoom && recordedRoom !== room.capsuleId && recordedRoom !== room.id)
      || (room.taskRunId && room.taskRunId !== task?.id)
      || linked.some(candidate => candidate.id !== room.id)) return unavailable;
    return { responseScope: "workroom", responseWorkroomId: room.id };
  } catch {
    return unavailable;
  }
}

/** Final stored bytes are chosen once before hashing and persistence. */
export async function finalizeCoworkerResponse(input: { content: string; providerId: string | null; modelId: string | null; routeContext: string; responseProducer?: ResponseProducer }) {
  let responseContent = input.content;
  const responseProviderId = input.providerId, responseModelId = input.modelId;
  // Sanitize: strip only agent self-talk that is never useful to the user.
  // The agentic loop's continuation nudge handles "narrate instead of act" — so
  // we only strip filler/apologies here, NOT action-intent language.
  const rawResponseBeforeSanitize = responseContent;
  responseContent = responseContent
    // "Action: tool_name(...)" — raw tool-call narration leaked as text
    .replace(/^Action:?\s*\w+\([^\n]*$/gm, "")
    // "Self-correction:" — agent internal monologue
    .replace(/^Self-correction:?\s*[^\n]*$/gim, "")
    // Filler apologies
    .replace(/^(?:I (?:apologize|appreciate)|My apologies|I'm sorry)[^\n]*$/gim, "")
    // Stalling ("Give me a moment", "This will take...")
    .replace(/^(?:Give me|Let me take|This (?:will|may|might) take)[^\n]*$/gim, "")
    // Clean up excessive whitespace
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Quality gate: if the response was almost entirely stripped (agent was all questions/narration),
  // replace with an honest fallback rather than showing empty or useless text.
  if (responseContent.length < 20) {
    // CodeQL js/log-injection: .length values are numeric but CodeQL
    // tracks them as tainted via the source string. Number() coercion is
    // a recognised sanitiser.
    console.warn(
      `[quality-gate] Response too short (${Number(responseContent.length)} chars). ` +
      `Raw from loop (${Number(rawResponseBeforeSanitize.length)} chars): ${JSON.stringify(rawResponseBeforeSanitize.slice(0, 500))} | ` +
      `After sanitize: ${JSON.stringify(responseContent)} | ` +
      `Provider: ${JSON.stringify(responseProviderId)}/${JSON.stringify(responseModelId)} | ` +
      `Route: ${JSON.stringify(input.routeContext)}`,
    );
    const providerHint = responseProviderId
      ? `Provider ${responseProviderId}/${responseModelId} returned an empty response.`
      : "No AI provider was matched by the routing pipeline.";
    responseContent = `**Unable to process this request.** ${providerHint} Check AI Workforce settings (Platform > AI) to verify provider configuration.`;
  }

  // BI-F0005EB0 — never persist a raw provider/CLI error string as a
  // user-visible assistant message. When the loop smuggled a raw error into
  // `content` (e.g. `API Error: Unable to connect to API (ConnectionRefused)`),
  // replace it with provider-detail-free copy; the raw string stays in server
  // logs for engineers. The sanitized copy is still classifiable, so the
  // progress-visibility signal + "Retry the AI call" affordance still fire.
  {
    const { isRawProviderError, classifyInferenceFailure, friendlyInferenceFailureMessage } =
      await import("@/lib/build/inference-failure");
    if (isRawProviderError(responseContent)) {
      const kind = classifyInferenceFailure(responseContent) ?? "provider-unavailable";
      console.warn(
        `[coworker] raw inference error hidden from user (kind=${kind}, route=${JSON.stringify(input.routeContext)}): ${JSON.stringify(responseContent.slice(0, 300))}`,
      );
      responseContent = friendlyInferenceFailureMessage(kind);
    }
  }


  return { content: responseContent, responseProducer: responseProviderId && responseModelId ? preserveResponseProducer(input.responseProducer, responseContent, { providerId: responseProviderId, modelId: responseModelId }) : undefined };
}
export async function persistCoworkerResponse(input: {
  data: ResponseCreateData;
  responseProducer?: ResponseProducer;
  scope: ResponseSaveScope;
}, db: PersistenceDb = prisma) {
  const finalized = await finalizeCoworkerResponse({
    content: input.data.content,
    providerId: input.data.providerId ?? null,
    modelId: input.data.modelId ?? null,
    routeContext: input.data.routeContext ?? "",
    responseProducer: input.data.role === "assistant" ? input.responseProducer : undefined,
  });
  const envelopeMatches = input.data.threadId === input.scope.threadId
    && (input.data.taskRunId ?? null) === input.scope.taskRunId;
  const producer = envelopeMatches ? finalized.responseProducer : undefined;
  const scope = producer ? await resolveResponseSaveScope(input.scope, db)
    : { responseScope: null, responseWorkroomId: null };
  const message = await db.agentMessage.create({
    data: {
      ...input.data,
      content: finalized.content,
      responseAttemptId: producer?.attemptId ?? null,
      responseContentDigest: producer ? responseContentDigest(finalized.content) : null,
      ...scope,
    },
    select: {
      id: true, role: true, content: true, agentId: true, routeContext: true, createdAt: true,
      responseAttemptId: true, responseContentDigest: true, responseScope: true, responseWorkroomId: true,
    },
  });
  return { message, content: finalized.content };
}
