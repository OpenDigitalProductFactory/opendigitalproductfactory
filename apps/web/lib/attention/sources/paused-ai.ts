// Paused-AI source — coworker TaskRuns paused at input-required / auth-required.
// auth-required means a missing credential/authority, NOT human judgment (paused-
// work plan Locked Decision 5); input-required is a real judgment pause. The
// owning surface deep-links to operations-map until /platform/ai/paused-work
// lands. Spec §4.1; subsumes the unbuilt paused-work inbox.

import type { prisma } from "@dpf/db";
import { isProactivityLevel } from "@/lib/proactivity/proactivity-types";
import { attentionAuthorForAgent } from "../attribution";
import type { AttentionItem, AttentionRiskClass } from "../types";

type Db = typeof prisma;

export type TaskRunRow = {
  taskRunId: string;
  title: string;
  status: string;
  userId: string;
  a2aMetadata: unknown;
  progressPayload: unknown;
  startedAt: Date;
};

const RISK_VALUES: AttentionRiskClass[] = ["read", "bounded-write", "high-risk", "unknown"];

function readRisk(meta: unknown): AttentionRiskClass {
  if (meta && typeof meta === "object" && "riskClass" in meta) {
    const v = (meta as Record<string, unknown>).riskClass;
    if (typeof v === "string" && (RISK_VALUES as string[]).includes(v)) return v as AttentionRiskClass;
  }
  return "unknown";
}

function readSummary(payload: unknown): string | null {
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    const s = p.decisionBrief ?? p.summary;
    if (typeof s === "string" && s.trim()) return s.trim();
  }
  return null;
}

function readProactivity(meta: unknown): AttentionItem["proactivity"] {
  if (!meta || typeof meta !== "object") return undefined;
  const raw = (meta as Record<string, unknown>).proactivity;
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const level = value.resolvedLevel;
  if (!isProactivityLevel(level)) return undefined;
  const evidence = Array.isArray(value.evidenceRefs) ? value.evidenceRefs : [];
  const agentRef = evidence.find(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      (entry as Record<string, unknown>).kind === "agent" &&
      typeof (entry as Record<string, unknown>).id === "string",
  ) as Record<string, unknown> | undefined;
  return {
    level,
    actorId: typeof agentRef?.id === "string" ? agentRef.id : undefined,
    policyId: typeof value.policyId === "string" ? value.policyId : undefined,
  };
}

/** Pure projection of one paused coworker run into an attention item. */
export function pausedAiToAttentionItem(row: TaskRunRow): AttentionItem {
  const authRequired = row.status === "auth-required";
  const risk = readRisk(row.a2aMetadata);
  const proactivity = readProactivity(row.a2aMetadata);
  return {
    id: `paused-ai:${row.taskRunId}`,
    source: "paused-ai",
    title: row.title,
    // Thirty-four of these rendered the identical body, because the generic
    // fallback was the whole story and the run's own title was thrown away
    // (BI-79E207B9). The run names itself; say which one this is.
    context:
      readSummary(row.progressPayload) ??
      (authRequired
        ? `${row.title} — blocked on a missing credential or authority.`
        : `${row.title} — paused, and needs your input to continue.`),
    decisionClass: { scorability: "unscorable" },
    riskClass: risk,
    triage: {
      timeToAct: "none",
      residueReason: authRequired ? "needs-credential" : "input-required",
      blastRadius: "a coworker task",
      decideEffort: authRequired ? "review" : "judgment",
      // A high-risk run pauses BEFORE its side effect — resuming it is the
      // irreversible-high-risk call the override tier is meant to surface.
      irreversible: risk === "high-risk" && !authRequired,
    },
    createdAtIso: row.startedAt.toISOString(),
    actions: [
      { kind: "open-in-context", label: "Open run", href: "/platform/ai/operations-map" },
    ],
    deepLink: "/platform/ai/operations-map",
    audience: { operator: true, assigneePrincipalId: row.userId },
    proactivity: proactivity,
    ...(proactivity?.actorId ? { author: attentionAuthorForAgent(proactivity.actorId) } : {}),
  };
}

export async function loadPausedAiItems(db: Db): Promise<AttentionItem[]> {
  const rows = await db.taskRun.findMany({
    where: { status: { in: ["input-required", "auth-required"] }, archivedAt: null },
    orderBy: { startedAt: "desc" },
    take: 50,
    select: {
      taskRunId: true,
      title: true,
      status: true,
      userId: true,
      a2aMetadata: true,
      progressPayload: true,
      startedAt: true,
    },
  });
  return rows.map(pausedAiToAttentionItem);
}
