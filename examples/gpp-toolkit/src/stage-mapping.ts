import type { WorkShapeDefinition } from "../kernel/gpp/browser.js";

/** Additional test facts belong to the host, not to the source schema or binding label. */
export type SyntheticStageFacts = {
  actorRef: string;
  actions: readonly string[];
  output: { kind: string; revision: number; content: string };
  profile: { id: string; version: number };
  binding?: { id: string; version: number };
  boundaryRef: string;
  effectBound: "none" | "synthetic-memory-only";
  costCeiling: number;
  qualificationRef: string;
};
export type MappedStage = {
  shapeRef: string; stageKey: string; actorRef: string; actions: string[];
  toolsDeclaration: "declared-empty" | "declared";
  expectedEvidence: readonly string[];
  output: SyntheticStageFacts["output"];
  profile: SyntheticStageFacts["profile"];
  binding: SyntheticStageFacts["binding"];
  owningScope: string | null; decisionScope: string | null; humanRequired: boolean; humanRef: string | null;
  boundaryRef: string; effectBound: SyntheticStageFacts["effectBound"]; costCeiling: number;
  qualificationRef: string; qualification: "synthetic-only";
  unsupported: readonly ["whole-actor/session-envelope-qualification"];
};

/** Sequential exchange only. The result describes supplied facts and grants no authority. */
export function mapGeneratedStage(definition: WorkShapeDefinition, stageKey: string, facts?: SyntheticStageFacts):
  { mapped: true; stage: MappedStage } | { mapped: false; reason: string } {
  const stage = definition.stages.find((value) => value.key === stageKey);
  if (!stage || definition.flow !== undefined || stage.subShape !== undefined || stage.deadline !== undefined)
    return { mapped: false, reason: "unsupported-topology" };
  if (!facts || !/^(agent|person):.+/.test(stage.accountablePrincipalRef) || facts.actorRef !== stage.accountablePrincipalRef)
    return { mapped: false, reason: "unresolved-actor" };
  if (stage.tools === undefined || stage.tools.length !== facts.actions.length || stage.tools.some((tool, index) => tool !== facts.actions[index]))
    return { mapped: false, reason: "unresolved-actions" };
  if (!facts.output.kind || !facts.output.content || !Number.isSafeInteger(facts.output.revision) || facts.output.revision < 1)
    return { mapped: false, reason: "missing-output-artifact" };
  if (!facts.profile.id || !Number.isSafeInteger(facts.profile.version) || facts.profile.version < 1
    || !facts.boundaryRef || !facts.qualificationRef || !["none", "synthetic-memory-only"].includes(facts.effectBound)
    || !Number.isFinite(facts.costCeiling) || facts.costCeiling < 0)
    return { mapped: false, reason: "missing-host-envelope" };
  if (stage.binding && (!facts.binding || stage.binding.id !== facts.binding.id || stage.binding.version !== facts.binding.version))
    return { mapped: false, reason: "binding-version-mismatch" };
  if (!stage.binding && facts.binding) return { mapped: false, reason: "undeclared-binding" };
  const advance = stage.advance;
  const gate = advance.kind === "governed-decision" ? advance.gate : undefined;
  if (advance.kind === "governed-decision" && (!gate || gate.resolution !== "accountable-human" || !gate.checkpoint?.exactAction
    || !/^person:.+/.test(gate.checkpoint.role)))
    return { mapped: false, reason: "unresolved-human-checkpoint" };
  return { mapped: true, stage: {
    shapeRef: `${definition.key}@${definition.version}`, stageKey, actorRef: facts.actorRef,
    actions: [...facts.actions], toolsDeclaration: stage.tools.length === 0 ? "declared-empty" : "declared",
    expectedEvidence: [...stage.evidence], output: { ...facts.output }, profile: { ...facts.profile },
    binding: facts.binding ? { ...facts.binding } : undefined,
    owningScope: gate?.authority ?? null, decisionScope: advance.kind === "governed-decision" ? advance.decisionScope : null,
    humanRequired: advance.kind === "governed-decision", humanRef: gate?.checkpoint?.role ?? null, boundaryRef: facts.boundaryRef,
    effectBound: facts.effectBound, costCeiling: facts.costCeiling, qualificationRef: facts.qualificationRef,
    qualification: "synthetic-only", unsupported: ["whole-actor/session-envelope-qualification"],
  } };
}

/** A test-supplied exact-content owner decision; no authentication is implemented. */
export function syntheticReceiptFor(stage: MappedStage, runKey: string, observation: string,
  decision?: { actorId: string; exactPayload: string }) {
  if (!stage.expectedEvidence[0] || !runKey || observation !== stage.output.content) return null;
  const payload = JSON.stringify({ stage, runKey, observation });
  if (stage.humanRequired && (!stage.humanRef || decision?.actorId !== stage.humanRef || decision.exactPayload !== payload)) return null;
  return { stageKey: stage.stageKey, iteration: 0, runKey, kind: stage.expectedEvidence[0] };
}
