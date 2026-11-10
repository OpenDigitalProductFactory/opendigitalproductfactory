// The probe stage of the daily harness evolution run (BI-B8DAEB71, slice 2).
//
// For the run's recorded room candidates, within the probe-replay budget:
// read the room's own trace for the candidate's tool, replay baseline versus
// each variant, ask the owning scope to choose, and record the verdict on the
// room. A scope that cannot answer files a kernel gap. Activity candidates have
// no deterministic edit model yet; they are listed as unprobed, not guessed.

import type { HarnessEvolutionStore } from "./harness-evolution-store";
import { DEFAULT_IMPROVEMENT_CRITERIA, screenCandidate, type ImprovementCriteria, type SkipReason } from "./improvement-criteria";
import { measureTrace, probeCandidate } from "./probe";
import type { HarnessLayer, RoomCandidate } from "./room-candidates";
import { decideCandidateVerdict, type HarnessVerdict, type ScopeDecider } from "./scope-verdict";

/**
 * GPP permits do not steer yet: they are minted by an approval, single-use,
 * and their lineage is unsealed (BI-6B610D94, BI-035BE8D1). Until that lands a
 * permit grant costs a person per use, which the probe counts as human load.
 */
export const GPP_PERMITS_STEER = false;

/** A probe replays the baseline plus at most three variants. */
const MAX_REPLAYS_PER_PROBE = 4;

export type ProbeStageRoom = { id: string; capsuleId: string; layer: HarnessLayer };

export type ProbeStageResult = {
  verdicts: Array<Pick<HarnessVerdict, "candidateKey" | "verdict" | "variantKey" | "decisionScope" | "decisionId" | "reasons" | "deltas" | "executorLayer">>;
  /** Every candidate not probed, with why: the criteria screen (BI-CE564FBB), no edit model, or no trace. */
  unprobed: Array<{ candidateKey: string; reason: SkipReason | "no-variant-model" | "empty-trace" }>;
  probeReplays: number;
  scopeDecisions: number;
  kernelGaps: number;
};

function verdictSummary(verdict: HarnessVerdict): string {
  if (verdict.verdict === "KERNEL_GAP") {
    return `Probe: ${verdict.decisionScope.toUpperCase()} could not decide this miss (${verdict.kernelGap?.reason}); recorded as a kernel gap, no edit`;
  }
  if (verdict.verdict === "KEEP_BASE") return `Probe: KEEP_BASE (${verdict.reasons.join(", ")})`;
  const d = verdict.deltas;
  return `Probe: ADOPT ${verdict.variantKey} — human ${d.human >= 0 ? "+" : ""}${d.human}, AI ${d.ai >= 0 ? "+" : ""}${d.ai}, `
    + `code +${d.code}, completion ${d.completionRate >= 0 ? "+" : ""}${Math.round(d.completionRate * 100)} pts`;
}

export async function runProbeStage(input: {
  store: HarnessEvolutionStore;
  decide: ScopeDecider;
  candidates: readonly RoomCandidate[];
  rooms: ReadonlyMap<string, ProbeStageRoom>;
  /** Human-actor miss activities per room id in the window (status overrides, drive attention). */
  humanActivityByRoom: ReadonlyMap<string, number>;
  since: Date;
  /** Window length in weeks, for frequencies. */
  windowWeeks: number;
  /** Active rooms per shape key in the window, as runs per week. */
  shapeRunsPerWeek: ReadonlyMap<string, number>;
  periodKey: string;
  agentId: string;
  maxProbeReplays: number;
  criteria?: ImprovementCriteria;
}): Promise<ProbeStageResult> {
  const criteria = input.criteria ?? DEFAULT_IMPROVEMENT_CRITERIA;
  const result: ProbeStageResult = { verdicts: [], unprobed: [], probeReplays: 0, scopeDecisions: 0, kernelGaps: 0 };
  const ordered = [...input.candidates].sort(
    (a, b) => b.recurrence - a.recurrence || a.candidateKey.localeCompare(b.candidateKey),
  );
  for (const candidate of ordered) {
    const room = input.rooms.get(candidate.capsuleId);
    const [kind, toolName, code] = candidate.missKey.split(":");
    if (kind !== "tool" || !toolName || !code || !room) {
      result.unprobed.push({ candidateKey: candidate.candidateKey, reason: "no-variant-model" });
      continue;
    }
    if (result.probeReplays + MAX_REPLAYS_PER_PROBE > input.maxProbeReplays) {
      result.unprobed.push({ candidateKey: candidate.candidateKey, reason: "budget-exhausted" });
      continue;
    }
    // Cheap screen first: runs, shape repetition and parking need no trace.
    const shapeRunsPerWeek = input.shapeRunsPerWeek.get(candidate.shapeRef.split("@")[0] ?? candidate.shapeRef) ?? 0;
    const consecutiveKeepBase = await input.store.countConsecutiveKeepBase(room.id, candidate.candidateKey);
    const preScreen = screenCandidate({
      distinctRuns: candidate.distinctRuns, shapeRunsPerWeek, consecutiveKeepBase, insideControlLimits: null,
      costPerOccurrence: Number.POSITIVE_INFINITY, occurrencesPerWeek: Number.POSITIVE_INFINITY, probeCost: 0,
    }, criteria);
    if (!preScreen.eligible) {
      result.unprobed.push({ candidateKey: candidate.candidateKey, reason: preScreen.reason });
      continue;
    }
    const trace = await input.store.listRoomToolTrace(candidate.capsuleId, toolName, input.since);
    if (!trace.length) {
      result.unprobed.push({ candidateKey: candidate.candidateKey, reason: "empty-trace" });
      continue;
    }
    // Cost per occurrence: the refusal plus the turns spent recovering from it.
    // Probe spend must not exceed frequency × cost × horizon.
    const recorded = measureTrace(trace, { toolName, code }, { humanEvents: 0 });
    const occurrences = Math.max(recorded.gate.refusals, 1);
    const screen = screenCandidate({
      distinctRuns: candidate.distinctRuns, shapeRunsPerWeek, consecutiveKeepBase, insideControlLimits: null,
      costPerOccurrence: (recorded.gate.refusals + recorded.gate.recoveryTurns) / occurrences,
      occurrencesPerWeek: recorded.gate.refusals / Math.max(input.windowWeeks, 1 / 7),
      probeCost: MAX_REPLAYS_PER_PROBE,
    }, criteria);
    if (!screen.eligible) {
      result.unprobed.push({ candidateKey: candidate.candidateKey, reason: screen.reason });
      continue;
    }
    const humanEvents = (input.humanActivityByRoom.get(room.id) ?? 0)
      + await input.store.countRoomHumanEscalations(candidate.capsuleId, input.since);
    const probe = probeCandidate({ trace, target: { toolName, code }, humanEvents, gppPermitsSteer: GPP_PERMITS_STEER });
    result.probeReplays += probe.replays;

    const verdict = await decideCandidateVerdict({ candidate, probe, decide: input.decide });
    // Every probed candidate consults its scope, except a scope with no route here.
    if (verdict.kernelGap?.reason !== "scope-route-unavailable") result.scopeDecisions += 1;
    let kernelGapSignalId: string | null = null;
    if (verdict.verdict === "KERNEL_GAP" && verdict.kernelGap) {
      kernelGapSignalId = await input.store.recordKernelGap({
        decisionScope: verdict.decisionScope,
        missKey: candidate.missKey,
        capsuleId: candidate.capsuleId,
        reason: verdict.kernelGap.reason,
        question: verdict.kernelGap.question,
        agentId: input.agentId,
      });
      result.kernelGaps += 1;
    }
    await input.store.recordRoomVerdict({
      roomId: room.id,
      capsuleId: candidate.capsuleId,
      missKey: candidate.missKey,
      periodKey: input.periodKey,
      agentId: input.agentId,
      summary: verdictSummary(verdict),
      payload: { periodKey: input.periodKey, layer: room.layer.key, traceCalls: probe.traceCalls, kernelGapSignalId, ...verdict },
    });
    result.verdicts.push({
      candidateKey: verdict.candidateKey,
      verdict: verdict.verdict,
      variantKey: verdict.variantKey,
      decisionScope: verdict.decisionScope,
      decisionId: verdict.decisionId,
      reasons: verdict.reasons,
      deltas: verdict.deltas,
      executorLayer: verdict.executorLayer,
    });
  }
  return result;
}
