import type { AttentionItem } from "../types";

export type CoworkerMemoryAttentionDb = {
  coworkerMemoryNote: {
    findMany(args?: unknown): Promise<CoworkerMemoryAttentionRow[]>;
  };
};

export type CoworkerMemoryAttentionRow = {
  id: string;
  noteKind: string;
  noteKey: string;
  content: string;
  sourceRef: string | null;
  createdAt: Date;
  agent: {
    agentId: string;
    displayName?: string | null;
    name?: string | null;
  };
};

const DEFAULT_LOOKBACK_DAYS = 7;

export function coworkerMemoryNoteToAttentionItem(
  row: CoworkerMemoryAttentionRow,
): AttentionItem {
  const coworkerName = row.agent.displayName ?? row.agent.name ?? row.agent.agentId;
  return {
    id: `coworker-memory:${row.id}`,
    source: "coworker-memory",
    title: "New coworker memory note",
    context: `${coworkerName} remembered a ${row.noteKind}: ${row.content}`,
    decisionClass: { scorability: "unscorable" },
    riskClass: "read",
    triage: {
      timeToAct: "none",
      residueReason: "new-memory-note",
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: row.createdAt.toISOString(),
    portfolio: "for-employees",
    actions: [
      { kind: "open-in-context", label: "Review memory", href: "/platform/ai/memory" },
      { kind: "dismiss", label: "Dismiss" },
    ],
    deepLink: "/platform/ai/memory",
    audience: { operator: true },
    proactivity: { level: "balanced", actorId: row.agent.agentId },
    technical: { detectedBy: row.sourceRef ?? "memory-distill" },
  };
}

export async function loadCoworkerMemoryItems(
  db: CoworkerMemoryAttentionDb,
  opts: { now?: Date; lookbackDays?: number; take?: number } = {},
): Promise<AttentionItem[]> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS) * 24 * 60 * 60 * 1000);
  const rows = await db.coworkerMemoryNote.findMany({
    where: {
      supersededAt: null,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 25,
    select: {
      id: true,
      noteKind: true,
      noteKey: true,
      content: true,
      sourceRef: true,
      createdAt: true,
      agent: { select: { agentId: true, displayName: true, name: true } },
    },
  });
  return rows.map((row) => coworkerMemoryNoteToAttentionItem(row));
}
