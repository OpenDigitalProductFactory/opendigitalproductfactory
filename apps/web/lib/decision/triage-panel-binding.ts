// Running a real governance-triage panel (BI-C62127B9, EP-0AF96937).
//
// The conductor owns the ordering and the refusals; this owns the one thing it
// deliberately does not: talking to the deliberation framework. It convenes the
// run through the existing orchestrator — no parallel dispatch path — and then
// reads the adjudicator's verdict back out of the run's own outcome.
//
// The verdict arrives as TEXT, because that is what a synthesized deliberation
// produces. Parsing it is the risky step, so it is narrow and unforgiving:
// either a JSON object comes out, or `null` does. A verdict this module cannot
// read is not repaired, re-prompted, or half-interpreted — it is handed on as
// null and the conductor refuses it. A drafted resolution assembled out of
// something nobody could parse is exactly the artifact this whole feature must
// never produce.
//
// Spec: docs/superpowers/specs/2026-08-23-decision-concierge-design.md §4.3

import type { PanelResult, TriageSubject } from "./triage-conductor";
import type { StaffingPlan } from "./triage-staffing";
import { buildPanelBrief } from "./triage-panel-brief";
export { buildPanelBrief } from "./triage-panel-brief";

/** Risk tier → the assurance the panel runs at. High stakes buy more diversity. */
function strategyFor(riskTier: string | null): "balanced" | "high-assurance" {
  return riskTier === "high" || riskTier === "critical" ? "high-assurance" : "balanced";
}

/**
 * Pull a JSON object out of an adjudicator's answer. Accepts a bare object or
 * one inside a fenced block, because both are ordinary model output; accepts
 * nothing else. Returns null rather than a partial reading.
 */
export function parseVerdictText(text: string | null | undefined): unknown {
  if (typeof text !== "string" || text.trim().length === 0) return null;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) continue;
    try {
      const parsed: unknown = JSON.parse(candidate.slice(start, end + 1));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // Not JSON. Try the next candidate; never guess at the shape.
    }
  }
  return null;
}

/**
 * Production binding for the conductor's `runPanel` seam. Returns null when the
 * run could not be convened at all — the conductor reports that as
 * panel-unavailable and writes nothing.
 */
/** How long one panel may hold a sweep pass before it yields to the next. */
const OUTCOME_WAIT_MS = 240_000;
const OUTCOME_POLL_MS = 3_000;

type OutcomeRow = { mergedRecommendation: string | null; consensusState: string | null } | null;

/**
 * Poll for the deliberation outcome rather than assuming it is already there.
 * Returns null on timeout — an unfinished panel is not a silent empty verdict.
 */
async function awaitOutcome(
  db: { deliberationOutcome: { findUnique: (args: never) => Promise<OutcomeRow> } },
  deliberationRunId: string,
): Promise<OutcomeRow> {
  const deadline = Date.now() + OUTCOME_WAIT_MS;
  for (;;) {
    const found = await db.deliberationOutcome.findUnique({
      where: { deliberationRunId },
      select: { mergedRecommendation: true, consensusState: true },
    } as never);
    if (found) return found;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, OUTCOME_POLL_MS));
  }
}

export async function runGovernanceTriagePanel(input: {
  subject: TriageSubject;
  plan: StaffingPlan;
  staffedAgentIds: string[];
  userId: string;
  optionIds: string[];
}): Promise<PanelResult | null> {
  const { prisma, Prisma } = await import("@dpf/db");
  const { orchestrateDeliberation } = await import("@/lib/deliberation/orchestrator");

  let deliberationRunId: string;
  let panelTaskRunId: string;
  let consensusState: string | null = null;

  try {
    const run = await orchestrateDeliberation({
      userId: input.userId,
      // The panel's whole case. Without it the branches convene with nothing
      // in front of them and the run can only report insufficient evidence —
      // which is exactly what 263 completed panels did.
      brief: buildPanelBrief({
        subject: input.subject,
        plan: input.plan,
        optionIds: input.optionIds,
      }),
      subject: input.subject.question,
      patternSlug: "governance-triage",
      artifactType: "policy",
      triggerSource: "risk",
      strategyProfile: strategyFor(input.subject.riskTier),
      diversityMode: "multi-model-same-provider",
      activatedRiskLevel:
        input.subject.riskTier === "critical" || input.subject.riskTier === "high"
          ? input.subject.riskTier
          : "medium",
      routeContext: `decision-concierge:${input.subject.interactionId}`,
      maxBranches: 5,
    });
    deliberationRunId = run.deliberationRunId;
    panelTaskRunId = run.taskRunId;
    consensusState = run.consensusDecision?.decision ?? null;
  } catch {
    // No provider, no budget, a wedged runner — all the same to the caller:
    // the panel did not happen, so nothing was drafted.
    return null;
  }

  // Reserve the case before dispatch. A concurrent pass must not start a second
  // panel for the same snapshot; unfinished runs remain visible for recovery.
  const reserved = await prisma.decisionInteraction.updateMany({
    where: {
      id: input.subject.interactionRowId,
      deliberationRunId: input.subject.previousPanel?.id ?? null,
      ...(input.subject.updatedAt ? { updatedAt: input.subject.updatedAt } : {}),
      humanOutcome: { equals: Prisma.DbNull },
      resolutionProposals: { none: { status: "proposed", lifecycle: "active" } },
    },
    data: { deliberationRunId },
  });
  if (reserved.count !== 1) {
    await prisma.deliberationRun.update({
      where: { id: deliberationRunId },
      data: { consensusState: "insufficient-evidence", completedAt: new Date() },
    });
    await prisma.taskRun.update({
      where: { id: panelTaskRunId },
      data: { status: "canceled", completedAt: new Date(), progressPayload: { reason: "Decision changed or another panel reserved it before dispatch." } },
    });
    return null;
  }

  // Orchestration only PERSISTS the graph; the runner executes it. Without
  // this event the run sits at `pending` with queued nodes forever — which is
  // exactly what happened on the live install: ten governance-triage runs
  // created, zero completed, zero drafts. The same send is what
  // `lib/actions/deliberation.ts` does after orchestrating.
  try {
    const { startDeliberationRun } = await import("@/lib/deliberation/start-run");
    await startDeliberationRun({
      deliberationRunId,
      taskRunId: panelTaskRunId,
      userId: input.userId,
    });
  } catch {
    // The graph exists but nothing will execute it. Say the panel did not
    // happen rather than leaving a half-started run to look like a draft.
    return null;
  }

  // Deliberation is asynchronous, so the outcome does not exist the moment the
  // graph does. Wait for it, bounded: a pass that hangs on one panel starves
  // every other decision behind it. On timeout the caller records "not
  // drafted" and leaves the pending run attached for recovery. No duplicate is
  // dispatched while that run is unfinished.
  const outcome = await awaitOutcome(
    prisma as unknown as Parameters<typeof awaitOutcome>[0],
    deliberationRunId,
  );

  return {
    deliberationRunId,
    consensusState: outcome?.consensusState ?? consensusState,
    rawVerdict: parseVerdictText(outcome?.mergedRecommendation),
  };
}
