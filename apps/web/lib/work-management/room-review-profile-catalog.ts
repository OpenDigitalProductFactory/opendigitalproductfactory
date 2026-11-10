import type { RoomReviewLayer, RoomReviewRequirement } from "./room-definition-contract";
import { getCanonicalWorkCaseSourceEntry } from "./source-registry";

/** Requirement extensions of the source registry, not another Workroom registry. */
const COMMON: RoomReviewLayer = {
  ref: "workroom-review:common@1", kind: "common",
  requirements: [
    { ref: "attributed-outcome", outcome: "Compare the requested and observed outcome with attributable evidence", denominator: "eligible occurrences including unsuccessful and interrupted work", evidence: ["identity", "objective", "owner", "profile-version", "expected-result", "observed-result", "evidence-refs"], criticalFailures: ["fabricated-evidence", "missing-attribution"] },
    { ref: "safe-continuation", outcome: "Resume authorized work from durable evidence", denominator: "eligible handoffs and interruptions", evidence: ["checkpoint", "last-confirmed-effect", "next-action", "blocker-owner", "authority", "wait-class"], criticalFailures: ["duplicate-side-effect", "authority-expansion", "lost-recovery-context"] },
    { ref: "independent-learning", outcome: "Assess applied changes on subsequent comparable work", denominator: "eligible comparable occurrences with exclusions and unknowns recorded", evidence: ["baseline", "candidate-version", "counterevidence", "independent-assessor", "opportunity-window"], criticalFailures: ["self-approved-benefit", "replay-counted-as-recurrence"] },
  ],
};

function requirement(ref: string, outcome: string, denominator: string, evidence: string[], criticalFailures: string[]): RoomReviewRequirement {
  return { ref, outcome, denominator, evidence, criticalFailures };
}

/**
 * Known domain deltas from the approved design's representative scenarios.
 * This does not claim every catalog archetype has been assessed or qualified.
 * Callers compose other governed facet/category/leaf constraints explicitly.
 */
export function roomReviewLayers(sourceKey: string, archetypeId?: string): RoomReviewLayer[] {
  if (archetypeId !== undefined && !["pet-rescue", "campground"].includes(archetypeId)) {
    throw new Error(`No representative review extension for ${archetypeId}; applicability is unknown.`);
  }
  const source = getCanonicalWorkCaseSourceEntry(sourceKey);
  const layers: RoomReviewLayer[] = [COMMON];
  if (!source) return copyLayers(layers);
  layers.push({
    ref: `workroom-review:source:${source.sourceKey}@${source.definitionVersion}`, kind: "source",
    requirements: [requirement("source-contract", "Retain the source definition's evidence and authority obligations", "eligible occurrences of this source definition", [
      ...source.roomProjection.outcomePacket.requiredCategories,
      ...(source.receiptPolicy.receiptRequiredForConsequentialTransition ? ["consequential-receipt"] : []),
      "standing-grant-intersection",
    ], ["missing-required-receipt", "room-grants-new-authority"])],
  });
  if (["backlog-item", "work-capsule"].includes(source.sourceKey)) {
    layers.push({ ref: "workroom-review:development@1", kind: "facet", requirements: [requirement("development-acceptance", "Verify the delivered change on its installed version", "eligible development deliveries including failed attempts", ["repository", "commit", "installed-version", "dirty-artifacts", "review-receipts", "acceptance"], ["merge-claimed-as-installed-acceptance", "unrecoverable-source"])] });
  }
  if (source.roomProjection.mode === "standing") {
    layers.push({ ref: "workroom-review:standing@1", kind: "shape", requirements: [requirement("standing-cycles", "Keep due work and carry-over visible across cycles", "due cycles including missed cycles", ["cadence", "due-at", "cursor", "carry-over", "stop-condition"], ["missed-cycle-hidden", "legitimate-wait-cancelled"])] });
  }
  if (source.sourceKey === "bookkeeping-period") {
    layers.push({ ref: "workroom-review:bookkeeping@1", kind: "facet", requirements: [requirement("period-reconciliation", "Reconcile the period and retain authorized adjustments", "eligible periods and unresolved reconciliation items", ["source-completeness", "reconciliation", "adjustments", "sign-off"], ["unreconciled-period-closed", "unauthorized-adjustment"])] });
  }
  if (archetypeId === "pet-rescue") {
    layers.push({ ref: "workroom-review:pet-rescue@1", kind: "leaf", requirements: [requirement("welfare-capacity", "Maintain custody, suitable capacity and welfare handoff", "relevant intake and custody transitions", ["custody", "kennel-or-foster-fit", "welfare-handoff", "veterinary-escalation", "adoption-evidence"], ["capacity-bypassed", "welfare-harm", "veterinary-authority-bypassed"])] });
  }
  if (archetypeId === "campground") {
    layers.push({ ref: "workroom-review:campground@1", kind: "leaf", requirements: [requirement("site-fit", "Match the rig to a suitable available site", "relevant bookings and site assignments by occupancy type", ["rig-fit", "reservation-conflicts", "occupancy-episode", "maintenance", "meter-evidence"], ["unsuitable-site", "conflicting-reservation"])] });
  }
  return copyLayers(layers);
}

/** Return independent payloads so a caller cannot mutate shared requirements. */
function copyLayers(layers: readonly RoomReviewLayer[]): RoomReviewLayer[] {
  return layers.map(layer => ({ ...layer, requirements: layer.requirements.map(r => ({ ...r, evidence: [...r.evidence], criticalFailures: [...r.criticalFailures] })) }));
}
