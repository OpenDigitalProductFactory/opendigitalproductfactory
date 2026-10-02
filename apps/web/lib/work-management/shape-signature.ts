/**
 * A work shape in one line (BI-2A3C63FA, EP-B70E718D).
 *
 * Spec: docs/superpowers/specs/2026-10-02-workroom-flow-map-and-measurement-design.md §4.1, §4.2.
 *
 * Where a diagram does not fit — a room header, a coworker brief, an MCP result,
 * a notification — the shape still reads as trigger → steps → gate → end:
 *
 *   ⏱ cadence · AI sweep → AI raise → ◇ Person decide [role:owner] → ● success | ⊗ failure
 *
 * Lanes are DERIVED, never declared, so the signature and the flow map can never
 * disagree about who does a step:
 *   - `agent:`           → AI
 *   - `role:` / `person:` → Person
 *   - a stage whose evidence is a conversation with someone outside the
 *     organization is marked ⇄ (an outside touchpoint). Stage tool capability
 *     classes would make this stricter once they resolve per stage.
 *
 * The gate shows who decides, not an authority (WWMD/WWWD/WSID): shapes do not
 * declare one yet (`decisionScope` is a decision name), and a signature that
 * guessed would state something the runtime does not hold.
 *
 * Pure and deterministic.
 */
import type { WorkShapeDefinitionContract, WorkShapeStage, WorkShapeTriggerClass } from "./work-shapes";

export type ShapeLane = "AI" | "Person" | "Unknown";

const TRIGGER_GLYPH: Record<WorkShapeTriggerClass, string> = {
  claim: "✋",
  cadence: "⏱",
  "deadline-horizon": "📅",
  "authority-change": "🛡",
  "estate-drift": "〰",
  "evidence-decay": "⌛",
  escalation: "⬆",
};

const OUTSIDE_EVIDENCE = new Set<string>(["conversation-turn", "org-business-answer"]);

const STOP_GLYPH = { success: "●", failure: "⊗", budget: "⧖" } as const;

export function shapeLane(stage: Pick<WorkShapeStage, "accountablePrincipalRef">): ShapeLane {
  const ref = stage.accountablePrincipalRef;
  if (ref.startsWith("agent:")) return "AI";
  if (ref.startsWith("role:") || ref.startsWith("person:")) return "Person";
  return "Unknown";
}

export function touchesOutside(stage: Pick<WorkShapeStage, "evidence">): boolean {
  return stage.evidence.some((kind) => OUTSIDE_EVIDENCE.has(kind));
}

function stageToken(stage: WorkShapeStage): string {
  const step = `${shapeLane(stage)} ${stage.key}${touchesOutside(stage) ? " ⇄" : ""}`;
  if (stage.advance.kind !== "governed-decision") return step;
  return `◇ ${step} [${stage.accountablePrincipalRef}]`;
}

export function shapeSignature(
  definition: Pick<WorkShapeDefinitionContract, "triggers" | "stages" | "stopConditions">,
): string {
  const triggers = definition.triggers.map((trigger) => `${TRIGGER_GLYPH[trigger]} ${trigger}`).join(" ");
  const steps = definition.stages.map(stageToken).join(" → ");
  const stopKinds = (["success", "failure", "budget"] as const).filter((kind) =>
    definition.stopConditions.some((stop) => stop.kind === kind),
  );
  const ends = stopKinds.map((kind) => `${STOP_GLYPH[kind]} ${kind}`).join(" | ");
  return `${triggers} · ${steps}${ends ? ` → ${ends}` : ""}`;
}
