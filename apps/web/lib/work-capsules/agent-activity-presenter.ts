// BI-C41AB195 (EP-WORK-CONVERGENCE): present a Workroom's activity rows as a
// human-legible "agent session" feed — the teammate timeline a person reads to
// see what an AI coworker (or a peer) is doing on the work item, instead of raw
// logs. The typed agent activities (thought / action / question / response /
// error, written via record_agent_activity) surface prominently; lifecycle
// plumbing (created, adopted, evidence-recorded, …) is kept as muted context.
// Pure + unit-testable; the React feed renders these entries.

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
export function presentAgentSession(rows: CapsuleActivityRow[]): AgentSessionEntry[] {
  return rows.map((row) => {
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
  return rows.some((row) => isAgentActivityKind(row.kind));
}
