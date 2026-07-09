// apps/web/lib/tak/coworker-memory.ts
//
// BI-F9025BA0 (EP-CLAUDE-INSIDE-OUT): per-coworker durable working memory.
//
// The shared WWMD/WWWD corpus (org-level) and UserFact store (per-user) already
// exist. This is the missing third layer: a coworker's OWN role-local notes —
// techniques that worked, durable workspace context, cautions to avoid — that do
// not belong in the org corpus but should survive across sessions. Modeled on
// user-facts.ts: superseded-by-key so a note stays current instead of piling up.
//
// Pure data/logic only (no auth). Callers own authorization:
//   • the coworker-memory MCP pack (self-scoped: a coworker records/reads its own
//     notes via context.agentId).
// Confirmed durable learnings should be promoted onward to WWMD/WWWD via
// dpf-route-learning-to-commons; this store is the staging/working layer.

import { prisma } from "@dpf/db";

// ─── Vocabulary ──────────────────────────────────────────────────────────────

/** Closed vocabulary of note kinds. A typo never persists an unclassifiable note. */
export const COWORKER_NOTE_KINDS = [
  "technique", // a role-craft technique that worked
  "context", // durable context about the workspace/domain/customer
  "preference", // a working preference this coworker should keep
  "caution", // a pitfall to avoid / something that failed
  "reference", // a pointer to a resource or prior artifact
] as const;

export type CoworkerNoteKind = (typeof COWORKER_NOTE_KINDS)[number];

/** True iff `kind` is one of the recognised note kinds. */
export function isKnownNoteKind(kind: string): boolean {
  return (COWORKER_NOTE_KINDS as readonly string[]).includes(kind);
}

export type CoworkerMemoryNoteRecord = {
  id: string;
  noteKind: string;
  noteKey: string;
  content: string;
  createdAt: Date;
};

export type RecordNoteResult =
  | { ok: true; status: "created" | "updated" | "unchanged" }
  | { ok: false; error: string };

// ─── Record / supersede a note ───────────────────────────────────────────────

/**
 * Record a working note for a coworker (by Agent.id cuid). Superseded-by-key on
 * (agentId, noteKind, noteKey): recording the same key with new content
 * supersedes the prior active note; identical content is a no-op. Rejects a kind
 * outside the closed vocabulary and empty content before any write.
 */
export async function recordCoworkerNote(params: {
  agentCuid: string;
  noteKind: string;
  noteKey: string;
  content: string;
  sourceRef?: string | null;
  createdBy?: string | null;
}): Promise<RecordNoteResult> {
  if (!isKnownNoteKind(params.noteKind)) {
    return { ok: false, error: `Unknown note kind: ${params.noteKind}` };
  }
  const content = (params.content ?? "").trim();
  if (!content) {
    return { ok: false, error: "Note content must not be empty." };
  }
  const noteKey = (params.noteKey ?? "").trim();
  if (!noteKey) {
    return { ok: false, error: "Note key must not be empty." };
  }

  const existing = await prisma.coworkerMemoryNote.findFirst({
    where: {
      agentId: params.agentCuid,
      noteKind: params.noteKind,
      noteKey,
      supersededAt: null,
    },
    select: { id: true, content: true },
  });

  if (existing && existing.content === content) {
    return { ok: true, status: "unchanged" };
  }

  // BI-840FDD43 (EP-8C706944 P2): when there is no exact-key match, consult the
  // write-time consolidation gate against active notes of the same kind so a
  // different-key near-duplicate supersedes rather than piles up.
  let nearNeighborTargetId: string | null = null;
  if (!existing) {
    const { classifyConsolidation } = await import("./memory-consolidation");
    const siblings = await prisma.coworkerMemoryNote.findMany({
      where: { agentId: params.agentCuid, noteKind: params.noteKind, supersededAt: null },
      select: { id: true, noteKey: true, content: true },
    });
    const decision = classifyConsolidation(
      { key: noteKey, value: content },
      siblings.map((s) => ({ id: s.id, key: s.noteKey, value: s.content })),
    );
    if (decision.action === "noop") {
      return { ok: true, status: "unchanged" };
    }
    if (decision.action === "supersede") {
      nearNeighborTargetId = decision.targetId;
    }
  }

  const created = await prisma.coworkerMemoryNote.create({
    data: {
      agentId: params.agentCuid,
      noteKind: params.noteKind,
      noteKey,
      content,
      sourceRef: params.sourceRef ?? null,
      createdBy: params.createdBy ?? null,
    },
  });

  const supersedeTargetId = existing?.id ?? nearNeighborTargetId;
  if (supersedeTargetId) {
    await prisma.coworkerMemoryNote.update({
      where: { id: supersedeTargetId },
      data: { supersededAt: new Date(), supersededById: created.id },
    });
    return { ok: true, status: "updated" };
  }

  return { ok: true, status: "created" };
}

// ─── Load active notes ───────────────────────────────────────────────────────

/**
 * Load a coworker's active (non-superseded) notes, newest first, capped at
 * `limit`. Empty for every coworker that has never recorded a note.
 */
export async function loadCoworkerNotes(
  agentCuid: string,
  limit = 20,
): Promise<CoworkerMemoryNoteRecord[]> {
  const notes = await prisma.coworkerMemoryNote.findMany({
    where: { agentId: agentCuid, supersededAt: null },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, noteKind: true, noteKey: true, content: true, createdAt: true },
  });
  return notes as CoworkerMemoryNoteRecord[];
}

// ─── Format as a prompt context block ────────────────────────────────────────

/**
 * Format active notes as a system-prompt block (consumed by the prompt
 * assembler in the follow-up wiring). Returns null when there are no notes, so
 * the block is a strict no-op for any coworker without working memory.
 */
export function formatNotesAsContext(notes: CoworkerMemoryNoteRecord[]): string | null {
  if (notes.length === 0) return null;
  const lines = notes.map((n) => `- [${n.noteKind}] ${n.noteKey}: ${n.content}`);
  return [
    "",
    "YOUR WORKING NOTES:",
    "Durable role-local notes you recorded in prior sessions. Use them; supersede one when it changes.",
    ...lines,
  ].join("\n");
}
