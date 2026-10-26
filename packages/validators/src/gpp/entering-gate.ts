import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import type { WorkShapeDefinition } from "./work-shape-contracts.js";
import { buildShapeFlowGraph } from "../workroom/flow-graph.js";

/** DI-7D228A48C022: a binding belongs to the gate authorizing entry, never its exit. */
export function enteringGate(document: Pick<WorkShapeDefinition, "stages" | "flow" | "stopConditions">, stageKey: string) {
  const graph = buildShapeFlowGraph(document);
  const id = `stage:${stageKey}`;
  if (graph.start === id) return undefined;
  const visiting = new Set<string>();
  const entryPredecessors = (key: string): string[] | undefined => {
    if (visiting.has(key)) return undefined;
    const node = graph.nodes.get(key);
    if (node?.kind === "stage") return [key];
    if (node?.kind !== "parallel-join") return undefined;
    visiting.add(key);
    const incoming = graph.predecessors.get(key) ?? [];
    const groups = incoming.map(entryPredecessors);
    visiting.delete(key);
    return incoming.length && groups.every((group) => group !== undefined) ? groups.flatMap((group) => group!) : undefined;
  };
  const groups = (graph.predecessors.get(id) ?? []).map(entryPredecessors);
  if (groups.some((group) => group === undefined)) return undefined;
  const predecessors = groups.flatMap((group) => group!);
  if (!predecessors.length) return undefined;
  const owners = predecessors.map((key) => {
    const node = graph.nodes.get(key);
    if (!node || node.kind !== "stage") return undefined;
    const stage = document.stages[node.index];
    if (!stage || stage.advance.kind !== "governed-decision" || !stage.advance.gate) return undefined;
    return { stageKey: stage.key, decisionScope: stage.advance.decisionScope, gate: stage.advance.gate };
  });
  const owner = owners[0];
  if (!owner || owners.some((candidate) => !candidate || candidate.decisionScope !== owner.decisionScope || canonicalJson(candidate.gate) !== canonicalJson(owner.gate))) return undefined;
  return owner;
}
