// apps/web/lib/tak/coworker-briefing-runner.ts
// Server-side generation + read of the session-start briefing (BI-A9052DCB).
// Gathers governed source records, assembles the block with the pure builder, and
// upserts the CoworkerBriefing projection. Generation is offline/lazy: the read
// path prepends the stored briefing and fire-and-forget refreshes it when stale,
// so no session ever waits on regeneration.
//
// The briefing is keyed by the business agentId (Agent.agentId — the same value
// AgentMessage/ToolExecution use), consistent with the rest of the coworker
// surface. The notes lookup resolves the Agent row's cuid internally, since
// CoworkerMemoryNote is keyed by Agent.id.

import { prisma } from "@dpf/db";
import {
  buildBriefingContent,
  briefingSourceDigest,
  formatBriefingMessage,
  type BriefingSources,
} from "./coworker-briefing";
import { loadUserFacts } from "./user-facts";
import { loadCoworkerNotes } from "./coworker-memory";

/** Refresh the briefing when it is older than this (offline projection cadence). */
export const BRIEFING_STALE_MS = 24 * 60 * 60 * 1000;

async function loadNotesForBusinessAgent(agentId: string) {
  try {
    const { resolveCoworkerAgent } = await import("./coworker-tool-grant-core");
    const resolved = await resolveCoworkerAgent(agentId);
    if (!resolved) return [];
    return await loadCoworkerNotes(resolved.id, 6);
  } catch {
    return [];
  }
}

async function gatherUserBriefingSources(
  agentId: string,
  userId: string,
): Promise<BriefingSources> {
  const [user, facts, notes, recentThread] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    loadUserFacts(userId, undefined, 8),
    loadNotesForBusinessAgent(agentId),
    // The user's most recent thread with a durable checkpoint provides a
    // one-line "recent context" carry-forward without RAG over transcripts.
    prisma.agentThread.findFirst({
      where: { userId, compactedSummary: { not: null } },
      orderBy: { updatedAt: "desc" },
      select: { compactedSummary: true },
    }),
  ]);

  return {
    subjectLabel: user?.email ?? userId,
    businessLine: null,
    topFacts: facts.map((f) => ({ key: f.key, value: f.value })),
    notes: notes.map((n) => ({ noteKind: n.noteKind, noteKey: n.noteKey, content: n.content })),
    recentDecisions: recentThread?.compactedSummary ? [recentThread.compactedSummary] : [],
    spendLine: null,
  };
}

/**
 * Regenerate the user-scoped briefing for (coworker, user). Skips the write when
 * the source digest is unchanged. Returns whether it wrote.
 */
export async function generateUserBriefing(
  agentId: string,
  userId: string,
): Promise<{ written: boolean }> {
  const sources = await gatherUserBriefingSources(agentId, userId);
  const content = buildBriefingContent(sources);
  const digest = briefingSourceDigest(sources);
  const key = { agentId_scope_scopeKey: { agentId, scope: "user", scopeKey: userId } };

  const existing = await prisma.coworkerBriefing.findUnique({
    where: key,
    select: { sourceDigest: true },
  });
  if (existing && existing.sourceDigest === digest) return { written: false };

  // Nothing worth briefing → remove any stale row so we stop injecting it.
  if (content === null) {
    if (existing) await prisma.coworkerBriefing.delete({ where: key });
    return { written: false };
  }

  await prisma.coworkerBriefing.upsert({
    where: key,
    create: { agentId, scope: "user", scopeKey: userId, content, sourceDigest: digest },
    update: { content, sourceDigest: digest, generatedAt: new Date() },
  });
  return { written: true };
}

/**
 * Read the user-scoped briefing as a prependable history message, and
 * fire-and-forget refresh it when stale/missing. Null when there is no briefing
 * (strict no-op). Non-fatal on any error.
 */
export async function loadUserBriefingMessage(
  agentId: string,
  userId: string,
): Promise<{ role: "user"; content: string } | null> {
  try {
    const row = await prisma.coworkerBriefing.findUnique({
      where: { agentId_scope_scopeKey: { agentId, scope: "user", scopeKey: userId } },
      select: { content: true, generatedAt: true },
    });
    const stale = !row || Date.now() - row.generatedAt.getTime() > BRIEFING_STALE_MS;
    if (stale) {
      generateUserBriefing(agentId, userId).catch((e) =>
        console.warn("[coworker-briefing] refresh failed:", e),
      );
    }
    return formatBriefingMessage(row?.content ?? null);
  } catch (err) {
    console.warn("[coworker-briefing] load failed:", err);
    return null;
  }
}
