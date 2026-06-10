// apps/web/lib/queue/admission-observability.ts
//
// Instance admission control — §4.5 observability. Surfaces, for the operator,
// what the admission lane is doing: whether the build-pipeline lane is capped,
// and how much work is currently holding capacity. Derived from data the
// Self-Upgrade page already fetches (the quiescence blocker summary), so it adds
// no query — a pure projection.
//
// Spec: docs/superpowers/specs/2026-06-09-instance-admission-control-design.md §4.5

import { BUILD_PIPELINE_LANE_KEY } from "./admission";
import type { QuiescenceBlockerLine } from "@/lib/self-upgrade/quiescence";

export type AdmissionSnapshot = {
  lane: { enabled: boolean; limit: number | null; key: string };
  /** Build-pipeline phases currently holding capacity. */
  buildHolders: number;
  /** All surfaces holding capacity (builds + coworker loops + recent activity). */
  totalHolders: number;
  /** One operator-facing line summarising the above. */
  summary: string;
};

const BUILD_PHASE_PREFIX = "build-studio.phase.";

/**
 * One operator-facing line. Pure. Explains the lane state (capped vs uncapped,
 * with the env hint when uncapped) and what is holding capacity right now.
 */
export function summarizeAdmission(
  laneLimit: number | null,
  buildHolders: number,
  totalHolders: number,
): string {
  const lanePart =
    laneLimit != null
      ? `Build-pipeline lane capped at ${laneLimit} concurrent`
      : "Build-pipeline lane uncapped — set DPF_BUILD_PIPELINE_CONCURRENCY to reserve self-upgrade headroom";

  if (totalHolders === 0) return `${lanePart}; nothing holding capacity.`;

  const others = totalHolders - buildHolders;
  const buildPart = `${buildHolders} build phase${buildHolders === 1 ? "" : "s"}`;
  const otherPart = others > 0 ? ` + ${others} other surface${others === 1 ? "" : "s"}` : "";
  return `${lanePart}; ${buildPart}${otherPart} holding capacity.`;
}

/**
 * Project the admission snapshot from the configured lane limit and the
 * already-summarised quiescence blockers. Pure.
 */
export function buildAdmissionSnapshot(
  laneLimit: number | null,
  blockers: QuiescenceBlockerLine[],
): AdmissionSnapshot {
  const buildHolders = blockers
    .filter((b) => b.surface.startsWith(BUILD_PHASE_PREFIX))
    .reduce((sum, b) => sum + b.count, 0);
  const totalHolders = blockers.reduce((sum, b) => sum + b.count, 0);
  return {
    lane: { enabled: laneLimit != null, limit: laneLimit, key: BUILD_PIPELINE_LANE_KEY },
    buildHolders,
    totalHolders,
    summary: summarizeAdmission(laneLimit, buildHolders, totalHolders),
  };
}
