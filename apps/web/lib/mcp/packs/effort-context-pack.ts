// Shared effort-context pack — BI-23A65B81 (EP-8C706944 P3).
//
// The door to a multi-coworker, multi-session EFFORT's shared working context:
//   • record_effort_context — append a decision / open-question / note to an effort
//   • read_effort_context   — read the shared context to rehydrate a fresh session
//
// A coworker working a cross-cutting effort names it by a stable effortKey (e.g.
// "epic:EP-XXX" or "bi:BI-YYY"); every participating coworker reads and appends to
// the same context, so work handed between coworkers and across sessions keeps a
// shared memory. Appends are attributed to the calling coworker (context.agentId).
// Ungated like the working-memory pack — appending a collaborative note to an
// effort you are working on cannot exceed authority; it is a shared scratchpad,
// not a privileged action.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";
import { EFFORT_ENTRY_KINDS, isKnownEffortEntryKind } from "@/lib/tak/effort-context";

const definitions: ToolDefinition[] = [
  {
    name: "record_effort_context",
    description:
      "Append to the SHARED working context of a multi-coworker effort — a decision made, an open question, or a working note. Name the effort with a stable key (e.g. 'epic:EP-1234' or 'bi:1234'). Every coworker working that effort reads and appends to the same context, so work handed between coworkers and across sessions keeps a shared memory. Use this to coordinate an effort that spans more than one coworker or session.",
    inputSchema: {
      type: "object",
      properties: {
        effortKey: {
          type: "string",
          description: "Stable identifier for the effort (e.g. 'epic:EP-1234', 'bi:1234').",
        },
        kind: {
          type: "string",
          enum: [...EFFORT_ENTRY_KINDS],
          description: "decision | open-question | note.",
        },
        content: { type: "string", description: "The entry, in one or two sentences." },
        title: {
          type: "string",
          description: "Optional human title for the effort (set on first write).",
        },
      },
      required: ["effortKey", "kind", "content"],
    },
    requiredCapability: null,
    sideEffect: true,
  },
  {
    name: "read_effort_context",
    description:
      "Read the SHARED working context of a multi-coworker effort by its key — the decisions, open questions, working notes, and participating coworkers. Use this at the start of work on an effort to rehydrate what other coworkers and earlier sessions established.",
    inputSchema: {
      type: "object",
      properties: {
        effortKey: { type: "string", description: "The effort's stable identifier." },
      },
      required: ["effortKey"],
    },
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

async function recordEffortContextHandler(
  params: Record<string, unknown>,
  _userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const effortKey = String(params["effortKey"] ?? "").trim();
  const kind = String(params["kind"] ?? "").trim();
  const content = String(params["content"] ?? "").trim();
  if (!effortKey) return { success: false, error: "missing_effort_key", message: "effortKey is required." };
  if (!isKnownEffortEntryKind(kind)) {
    return { success: false, error: "unknown_kind", message: `kind must be one of: ${EFFORT_ENTRY_KINDS.join(", ")}.` };
  }
  if (!content) return { success: false, error: "empty_content", message: "content must not be empty." };

  const agentCuid = await resolveCallerCuid(context?.agentId);
  const { recordEffortEntry } = await import("@/lib/tak/effort-context-runner");
  const view = await recordEffortEntry({
    effortKey,
    kind,
    content,
    agentId: agentCuid,
    title: params["title"] != null ? String(params["title"]) : null,
  });
  return {
    success: true,
    message: "Recorded to the shared effort context.",
    data: {
      effortKey: view.effortKey,
      decisions: view.decisions.length,
      openQuestions: view.openQuestions.length,
      notes: view.notes.length,
      participants: view.participantAgentIds.length,
    },
  };
}

async function readEffortContextHandler(
  params: Record<string, unknown>,
  _userId: string,
  _context?: { agentId?: string },
): Promise<ToolResult> {
  const effortKey = String(params["effortKey"] ?? "").trim();
  if (!effortKey) return { success: false, error: "missing_effort_key", message: "effortKey is required." };
  const { loadEffortContext } = await import("@/lib/tak/effort-context-runner");
  const ctx = await loadEffortContext(effortKey);
  if (!ctx) {
    return {
      success: true,
      message: `No shared context yet for effort '${effortKey}'.`,
      data: { effortKey, decisions: [], openQuestions: [], notes: [], participants: [] },
    };
  }
  return {
    success: true,
    message: `Shared context for '${ctx.title ?? effortKey}'.`,
    data: {
      effortKey: ctx.effortKey,
      title: ctx.title,
      decisions: ctx.decisions,
      openQuestions: ctx.openQuestions,
      notes: ctx.notes,
      participants: ctx.participantAgentIds,
    },
  };
}

export const effortContextPack: ToolPack = {
  packId: "effort-context",
  definitions,
  handlers: {
    record_effort_context: (params, userId, context) => recordEffortContextHandler(params, userId, context),
    read_effort_context: (params, userId, context) => readEffortContextHandler(params, userId, context),
  },
  grants: { record_effort_context: [], read_effort_context: [] },
};
