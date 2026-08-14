// Coworker working-memory pack — BI-F9025BA0 (EP-CLAUDE-INSIDE-OUT).
//
// Owns the self-scoped door to per-coworker durable working memory:
//   • record_working_note  — the calling coworker records one of its OWN notes
//   • list_working_notes    — the calling coworker reads its OWN active notes
//
// Self-scoped by construction: both handlers resolve the target from
// context.agentId (the acting coworker) and IGNORE any caller-supplied agent, so
// a coworker can only touch its own memory. Like propose_improvement /
// report_quality_issue, these need no special grant — a coworker recording a
// note for itself cannot exceed its authority or affect anyone else. A non-agent
// caller (no context.agentId, e.g. a REST/operator call) is rejected.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";
import { COWORKER_NOTE_KINDS } from "@/lib/tak/coworker-memory";

const definitions: ToolDefinition[] = [
  {
    name: "record_working_note",
    description:
      "Record a durable role-local working note for YOURSELF (the calling coworker) — a technique that worked, durable workspace context, a preference to keep, or a caution to avoid. Notes persist across sessions and are keyed: recording the same key again supersedes your prior note. Use for role-local learning that does not belong in the shared org knowledge base.",
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: [...COWORKER_NOTE_KINDS],
          description: "The kind of note (technique, context, preference, caution, reference).",
        },
        key: {
          type: "string",
          description: "A short stable identifier for this note. Reusing a key supersedes the prior note.",
        },
        content: { type: "string", description: "The note itself, in one or two sentences." },
        sourceRef: {
          type: "string",
          description: "Optional provenance (e.g. the route or task where you learned this).",
        },
      },
      required: ["kind", "key", "content"],
    },
    requiredCapability: null,
    sideEffect: true,
  },
  {
    name: "list_working_notes",
    description:
      "List YOUR OWN active working notes (the calling coworker's durable role-local memory), newest first.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: null,
    sideEffect: false,
  },
];

async function resolveCallerCuid(agentId: string | undefined): Promise<string | null> {
  if (!agentId) return null;
  const { resolveCoworkerAgent } = await import("@/lib/tak/coworker-tool-grant-core");
  const target = await resolveCoworkerAgent(agentId);
  return target?.id ?? null;
}

async function recordWorkingNoteHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const agentCuid = await resolveCallerCuid(context?.agentId);
  if (!agentCuid) {
    return {
      success: false,
      error: "no_calling_coworker",
      message: "Only a coworker can record its own working note.",
    };
  }
  const { recordCoworkerNote } = await import("@/lib/tak/coworker-memory");
  const res = await recordCoworkerNote({
    agentCuid,
    noteKind: String(params["kind"] ?? "").trim(),
    noteKey: String(params["key"] ?? "").trim(),
    content: String(params["content"] ?? ""),
    sourceRef: params["sourceRef"] != null ? String(params["sourceRef"]) : null,
    createdBy: userId || null,
  });
  if (!res.ok) {
    return { success: false, error: "note_write_failed", message: res.error };
  }
  return {
    success: true,
    message: res.status === "unchanged" ? "That note is already on file." : "Working note recorded.",
    data: { status: res.status },
  };
}

async function listWorkingNotesHandler(
  _params: Record<string, unknown>,
  _userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const agentCuid = await resolveCallerCuid(context?.agentId);
  if (!agentCuid) {
    return {
      success: false,
      error: "no_calling_coworker",
      message: "Only a coworker can read its own working notes.",
    };
  }
  const { loadCoworkerNotes } = await import("@/lib/tak/coworker-memory");
  const notes = await loadCoworkerNotes(agentCuid);
  return {
    success: true,
    message: notes.length ? `You have ${notes.length} working note(s).` : "You have no working notes yet.",
    data: {
      notes: notes.map((n) => ({ kind: n.noteKind, key: n.noteKey, content: n.content })),
    },
  };
}

export const coworkerMemoryPack: ToolPack = {
  packId: "coworker-memory",
  definitions,
  handlers: {
    record_working_note: (params, userId, context) => recordWorkingNoteHandler(params, userId, context),
    list_working_notes: (params, userId, context) => listWorkingNotesHandler(params, userId, context),
  },
  grants: { record_working_note: [], list_working_notes: [] },
};
