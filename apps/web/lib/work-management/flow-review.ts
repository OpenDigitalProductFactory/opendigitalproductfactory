/**
 * The flow review (BI-3C98682D, EP-B70E718D F8).
 *
 * Spec: docs/superpowers/specs/2026-10-02-workroom-flow-map-and-measurement-design.md §8.
 *
 * Once a day, every place where rooms pile up becomes an improvement signal
 * through the platform's existing improvement facility (ImprovementSignal,
 * deduplicated by source). The facility files exactly one backlog item once a
 * signal recurs to its threshold — so a bottleneck that persists for several
 * daily reviews becomes one attributable item, and one that clears on its own
 * never reaches the backlog. No second loop, no second dedupe.
 *
 * The signal's source id is the stage queue and the cause, so the same pile
 * keeps one identity across reviews; a different cause at the same step is a
 * different problem. A step's rooms can sit in several portfolios, so the
 * review merges them into one finding per step and cause: one touch per pile
 * per review, counting every room held there.
 */
import type { CreateOrTouchImprovementSignalInput } from "@/lib/improvement-flywheel/signals";

import type { PortfolioFlow } from "./portfolio-flow";
import { describeHoldCause, workroomStageQueueKey } from "./workroom-stage-telemetry";

export const FLOW_BOTTLENECK_SOURCE = "workroom-flow-bottleneck";
/** A step needs this many rooms held at once before it is worth a signal. */
export const MIN_ROOMS_HELD = 3;

export type FlowBottleneckFinding = {
  queueKey: string;
  shapeRef: string;
  stageKey: string;
  cause: string;
  roomsHeld: number;
  /** Every portfolio with rooms held at this step for this cause. */
  portfolios: PortfolioFlow["key"][];
};

export function findFlowBottlenecks(flows: readonly Pick<PortfolioFlow, "key" | "shapes">[]): FlowBottleneckFinding[] {
  const byPile = new Map<string, FlowBottleneckFinding>();
  for (const flow of flows) {
    for (const shape of flow.shapes) {
      if (!shape.bottleneck) continue;
      const queueKey = workroomStageQueueKey(shape.shapeRef, shape.bottleneck.stageKey);
      const key = `${queueKey}|${shape.bottleneck.cause}`;
      const pile = byPile.get(key);
      if (pile) {
        pile.roomsHeld += shape.bottleneck.roomsHeld;
        if (!pile.portfolios.includes(flow.key)) pile.portfolios.push(flow.key);
        continue;
      }
      byPile.set(key, {
        queueKey,
        shapeRef: shape.shapeRef,
        stageKey: shape.bottleneck.stageKey,
        cause: shape.bottleneck.cause,
        roomsHeld: shape.bottleneck.roomsHeld,
        portfolios: [flow.key],
      });
    }
  }
  // The threshold applies to the whole pile, not to one portfolio's share of it.
  return [...byPile.values()].filter((pile) => pile.roomsHeld >= MIN_ROOMS_HELD).sort((a, b) => b.roomsHeld - a.roomsHeld);
}

export function bottleneckSignal(finding: FlowBottleneckFinding, shapeTitle: string): CreateOrTouchImprovementSignalInput {
  const why = finding.cause === "awaiting-person" ? describeHoldCause(finding.cause) : `blocked: ${describeHoldCause(finding.cause)}`;
  return {
    sourceType: FLOW_BOTTLENECK_SOURCE,
    sourceId: `${finding.queueKey}|${finding.cause}`,
    title: `Work piles up at "${finding.stageKey}" in ${shapeTitle} (${why})`,
    description: [
      `The daily flow review found ${finding.roomsHeld} rooms held at step "${finding.stageKey}" of ${finding.shapeRef} at once (${why}).`,
      `${finding.portfolios.length > 1 ? "Portfolios" : "Portfolio"}: ${finding.portfolios.join(", ")}. Stage queue: ${finding.queueKey}.`,
      "Where to look: the shape's flow map on the area Work view shows the step's queue and typical time; each room's page shows why it is held.",
      "This item is filed once the same pile recurs across daily reviews; one that clears on its own never reaches the backlog.",
    ].join("\n\n"),
    evidence: { ...finding },
    suspectedRootCause: finding.cause === "awaiting-person" ? "The step waits on a person's decision" : `Drive hold reason ${finding.cause}`,
    objectiveImpactHypothesis: "Clearing the pile shortens this shape's flow time and raises its flow efficiency, visible on the area's flow tiles and the shape's version trend.",
  };
}
