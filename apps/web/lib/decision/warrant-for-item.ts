// apps/web/lib/decision/warrant-for-item.ts
//
// Compute a WorkWarrant for a backlog item at promote time from day-one
// structural signals — the corpus-free front door (EP-7B169558 / BI-8AB0E66D).
//
// Blast radius here is the INTERIM keyword+posture sensitivity
// (deriveDeliverableSensitivity, EP-QUALITY-RIGHTSIZING P1). The code-graph + EA
// provider (BI-22250BA2 == the planned BI-CFEB2B22 P3) will replace it, feeding
// the same BlastRadius shape — this helper stays the single promote-time entry.

import { classifyAltitude, type EffortSize } from "./work-warrant-altitude";
import {
  deriveWarrant,
  type WorkWarrant,
  type BlastRadius,
  type WarrantContext,
} from "./work-warrant";
import { warrantToRightsizingOpts } from "./warrant-rightsizing-bridge";
import {
  deriveDeliverableSensitivity,
  type DeliverableSensitivity,
  type RightsizingOpts,
} from "@/lib/explore/build-process-matrix";

const VALID_EFFORT: ReadonlySet<string> = new Set<EffortSize>(["small", "medium", "large", "xlarge"]);

/** Map the interim keyword sensitivity to a coarse blast radius. `low` yields no
 *  blast radius (altitude-only warrant); elevated/high can only ESCALATE rigor. */
function sensitivityToBlastRadius(s: DeliverableSensitivity): BlastRadius | undefined {
  if (s === "low") return undefined;
  return {
    downstreamCount: 0, // unknown pre-code; the code-graph provider fills this (BI-22250BA2)
    touchesCoreContract: s === "high",
    riskLevel: s === "high" ? "high" : "medium",
  };
}

export interface WarrantForItemResult {
  warrant: WorkWarrant;
  /** Rightsizing opts the phase gate reads (sensitivity + qualityFirst). */
  opts: RightsizingOpts;
}

/**
 * Derive the WorkWarrant + gate rightsizing-opts for a backlog item at promote.
 * Pure + corpus-free: altitude from effortSize/workType plus the interim keyword
 * blast radius; WWWD context passed through when known.
 */
export function warrantForBacklogItem(input: {
  effortSize?: string | null;
  workType?: string | null;
  text?: string | null;
  riskPosture?: string | null;
  context?: WarrantContext;
}): WarrantForItemResult {
  const sensitivity = deriveDeliverableSensitivity(
    { text: input.text ?? "", workType: input.workType ?? null },
    input.riskPosture ?? null,
  );
  const blastRadius = sensitivityToBlastRadius(sensitivity);
  const effortSize = (input.effortSize && VALID_EFFORT.has(input.effortSize)
    ? input.effortSize
    : null) as EffortSize | null;
  const verdict = classifyAltitude({
    effortSize,
    workType: input.workType ?? null,
    // Pre-code, `singleLeafSurface` is unknown. Optimistic cold-start default:
    // no blast-radius signal ⇒ treat as a single leaf so small task work can be
    // WSID (autonomous). If wrong it's cheap, and the verify-time code-graph
    // blast radius (BI-22250BA2) escalates it a-posteriori. Any blast-radius
    // signal ⇒ not a leaf, so it can never silently WSID risky work.
    singleLeafSurface: blastRadius == null,
    ...(blastRadius ? { touchesCoreContract: blastRadius.touchesCoreContract } : {}),
  });
  const warrant = deriveWarrant({ verdict, blastRadius, context: input.context ?? {} });
  return { warrant, opts: warrantToRightsizingOpts(warrant) };
}
