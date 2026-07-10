// apps/web/lib/tak/effort-context-runner.ts
// Server-side read/write for the shared effort context (BI-23A65B81). Binds
// prisma to the pure apply/format logic. Upsert-by-effortKey so any participating
// coworker in any session appends to the same shared context.

import { prisma } from "@dpf/db";
import {
  applyEffortEntry,
  formatEffortContextBriefing,
  type EffortContextState,
  type EffortEntryKind,
} from "./effort-context";

export type EffortContextView = EffortContextState & {
  effortKey: string;
  title: string | null;
  epicId: string | null;
  backlogItemId: string | null;
};

function toState(row: {
  decisions: string[];
  openQuestions: string[];
  notes: string[];
  participantAgentIds: string[];
}): EffortContextState {
  return {
    decisions: row.decisions,
    openQuestions: row.openQuestions,
    notes: row.notes,
    participantAgentIds: row.participantAgentIds,
  };
}

/** Load the shared context for an effort, or null when none exists yet. */
export async function loadEffortContext(effortKey: string): Promise<EffortContextView | null> {
  const row = await prisma.effortContext.findUnique({ where: { effortKey } });
  if (!row) return null;
  return {
    effortKey: row.effortKey,
    title: row.title,
    epicId: row.epicId,
    backlogItemId: row.backlogItemId,
    ...toState(row),
  };
}

/** Load the effort context rendered as a rehydration briefing message (or null). */
export async function loadEffortContextBriefing(
  effortKey: string,
): Promise<{ role: "user"; content: string } | null> {
  const ctx = await loadEffortContext(effortKey);
  if (!ctx) return null;
  const briefing = formatEffortContextBriefing(ctx.effortKey, ctx.title, ctx);
  return briefing ? { role: "user", content: `[${briefing}]` } : null;
}

/**
 * Append an entry to an effort's shared context, creating the context on first
 * write. Any participating coworker may append; the author is recorded in the
 * participant set.
 */
export async function recordEffortEntry(params: {
  effortKey: string;
  kind: EffortEntryKind;
  content: string;
  agentId?: string | null;
  title?: string | null;
  epicId?: string | null;
  backlogItemId?: string | null;
}): Promise<EffortContextView> {
  const existing = await prisma.effortContext.findUnique({ where: { effortKey: params.effortKey } });
  const baseState: EffortContextState = existing
    ? toState(existing)
    : { decisions: [], openQuestions: [], notes: [], participantAgentIds: [] };

  const next = applyEffortEntry(baseState, {
    kind: params.kind,
    content: params.content,
    agentId: params.agentId ?? null,
  });

  const row = await prisma.effortContext.upsert({
    where: { effortKey: params.effortKey },
    create: {
      effortKey: params.effortKey,
      title: params.title ?? null,
      epicId: params.epicId ?? null,
      backlogItemId: params.backlogItemId ?? null,
      decisions: next.decisions,
      openQuestions: next.openQuestions,
      notes: next.notes,
      participantAgentIds: next.participantAgentIds,
    },
    update: {
      // Only fill title/links if provided and not already set.
      ...(params.title && !existing?.title ? { title: params.title } : {}),
      ...(params.epicId && !existing?.epicId ? { epicId: params.epicId } : {}),
      ...(params.backlogItemId && !existing?.backlogItemId
        ? { backlogItemId: params.backlogItemId }
        : {}),
      decisions: next.decisions,
      openQuestions: next.openQuestions,
      notes: next.notes,
      participantAgentIds: next.participantAgentIds,
    },
  });

  return {
    effortKey: row.effortKey,
    title: row.title,
    epicId: row.epicId,
    backlogItemId: row.backlogItemId,
    ...toState(row),
  };
}
