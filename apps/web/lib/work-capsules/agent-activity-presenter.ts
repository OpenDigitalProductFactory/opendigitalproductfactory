// BI-C41AB195 (EP-WORK-CONVERGENCE): present a Workroom's activity rows as a
// human-legible "agent session" feed — the teammate timeline a person reads to
// see what an AI coworker (or a peer) is doing on the work item, instead of raw
// logs. The typed agent activities (thought / action / question / response /
// error, written via record_agent_activity) surface prominently; lifecycle
// plumbing (created, adopted, evidence-recorded, …) is kept as muted context.
// Pure + unit-testable; the React feed renders these entries.

import { isRecord } from "@/lib/shared/coerce";

import { isAgentActivityKind, type AgentActivityKind } from "@/lib/work-capsules";

export type AgentSessionTone = AgentActivityKind | "lifecycle";
export type AgentSessionActor = "agent" | "human" | "system";

export interface AgentSessionEntry {
  id: string;
  tone: AgentSessionTone;
  label: string;
  summary: string;
  recordedAt: Date;
  actor: AgentSessionActor;
}

const AGENT_KIND_LABEL: Record<AgentActivityKind, string> = {
  thought: "Thinking",
  action: "Did",
  question: "Asked",
  response: "Responded",
  error: "Hit a problem",
};

function actorOf(row: {
  recordedByAgentId?: string | null;
  recordedById?: string | null;
}): AgentSessionActor {
  if (row.recordedByAgentId) return "agent";
  if (row.recordedById) return "human";
  return "system";
}

export interface CapsuleActivityRow {
  id: string;
  kind: string;
  payload?: unknown;
  summary: string;
  recordedAt: Date;
  recordedByAgentId?: string | null;
  recordedById?: string | null;
}

/**
 * Map raw capsule-activity rows to session entries. Typed agent activities get a
 * plain label and their own tone; everything else is toned "lifecycle" and
 * labelled from its kind (e.g. "evidence-recorded" → "Evidence recorded").
 * Input order is preserved (callers pass newest-first).
 */
function handoffPresentation(row: CapsuleActivityRow): Pick<AgentSessionEntry, "tone" | "label" | "summary"> | null {
  const payload = isRecord(row.payload) ? row.payload : null;
  // Activity JSON is caller-controlled. Only command receipts establish these outcomes.
  if (row.kind === "command-accepted" && payload?.commandType === "reassign-executor") {
    const result = isRecord(payload.result) ? payload.result : null;
    const data = isRecord(result?.data) ? result.data : null;
    const handoff = isRecord(data?.handoff) ? data.handoff : null;
    if (result?.success === true && handoff?.kind === "bounded-handoff") {
      const summary = typeof result.message === "string" ? result.message : row.summary;
      if (handoff.state === "pending-acknowledgement") return { tone: "lifecycle", label: "Waiting for receiver", summary };
      if (handoff.state === "completed") return { tone: "action", label: "Handoff completed", summary };
    }
  }
  if (row.kind !== "command-rejected" || payload?.commandType !== "reassign-executor") return null;
  const rejection = isRecord(payload.rejection) ? payload.rejection : null;
  const data = isRecord(rejection?.data) ? rejection.data : null;
  const result = isRecord(data?.result) ? data.result : null;
  const resultData = isRecord(result?.data) ? result.data : null;
  const handoff = isRecord(resultData?.handoff) ? resultData.handoff : null;
  if (!handoff) return null;
  return { tone: "error", label: "Handoff refused", summary: typeof result?.message === "string" ? result.message : row.summary };
}

export function presentAgentSession(rows: CapsuleActivityRow[]): AgentSessionEntry[] {
  return rows.map((row) => {
    const handoff = handoffPresentation(row);
    if (handoff) return { id: row.id, ...handoff, recordedAt: row.recordedAt, actor: actorOf(row) };
    if (isAgentActivityKind(row.kind)) {
      return {
        id: row.id,
        tone: row.kind,
        label: AGENT_KIND_LABEL[row.kind],
        summary: row.summary,
        recordedAt: row.recordedAt,
        actor: actorOf(row),
      };
    }
    return {
      id: row.id,
      tone: "lifecycle",
      label: row.kind
        .split("-")
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(" "),
      summary: row.summary,
      recordedAt: row.recordedAt,
      actor: actorOf(row),
    };
  });
}

/** True when the feed has at least one typed agent activity (vs only plumbing). */
export function hasAgentActivity(rows: CapsuleActivityRow[]): boolean {
  return rows.some((row) => isAgentActivityKind(row.kind) || handoffPresentation(row) !== null);
}
