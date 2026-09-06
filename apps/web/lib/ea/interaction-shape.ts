// apps/web/lib/ea/interaction-shape.ts
//
// Pure contract and measurement helpers for the human-interaction shape graph.
// This stays beside navigation-extract because the shape graph composes the same
// route/navigation facts; it is not a second route inventory.

export const INTERACTION_STEP_ROLES = [
  "entry",
  "progress",
  "decide",
  "delegate",
  "complete",
  "reference",
] as const;

export type InteractionStepRole = (typeof INTERACTION_STEP_ROLES)[number];

export interface InteractionShapeNode {
  key: string;
  label: string;
  jobLane: string;
  stepRole: InteractionStepRole;
  continuesTo?: readonly string[];
  path?: string;
  spineStage?: string;
}

export type InteractionTerminalRole =
  | "complete"
  | "delegate"
  | "dead-end"
  | "cycle"
  | "missing-entry";

export interface InteractionFlowLoad {
  entryKey: string;
  jobLane: string | null;
  terminalRole: InteractionTerminalRole;
  /** Human-visible nodes traversed from entry to `complete` or `delegate`. */
  stepsToOutcome: number | null;
  traversedNodeKeys: string[];
  /** For `delegate`, the receiving job lane(s), not additional human steps. */
  delegatedTo: string[];
  deadEndNodeKeys: string[];
  missingContinuationKeys: string[];
}

const STEP_ROLE_SET: ReadonlySet<string> = new Set(INTERACTION_STEP_ROLES);
const DEAD_END_ROLES: ReadonlySet<InteractionStepRole> = new Set(["progress", "decide"]);

export function isInteractionStepRole(value: string): value is InteractionStepRole {
  return STEP_ROLE_SET.has(value);
}

export function isDelegationNode(
  node: Pick<InteractionShapeNode, "stepRole">,
): boolean {
  return node.stepRole === "delegate";
}

/**
 * Measures the operator's traversal from one entry node.
 *
 * `delegate` is terminal for the human path. Its `continuesTo` values name the
 * receiving job lane(s), so following them as more surface steps would recreate
 * the very cognitive-load inversion BI-5A1A3C13 exists to prevent.
 */
export function measureInteractionFlowLoad(
  nodes: readonly InteractionShapeNode[],
  entryKey: string,
): InteractionFlowLoad {
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const entry = byKey.get(entryKey);

  if (!entry) {
    return {
      entryKey,
      jobLane: null,
      terminalRole: "missing-entry",
      stepsToOutcome: null,
      traversedNodeKeys: [],
      delegatedTo: [],
      deadEndNodeKeys: [],
      missingContinuationKeys: [entryKey],
    };
  }

  const queue: Array<{ key: string; path: string[] }> = [{ key: entryKey, path: [entryKey] }];
  const visitedShortestPath = new Map<string, number>();
  const deadEndNodeKeys = new Set<string>();
  const missingContinuationKeys = new Set<string>();
  let sawCycle = false;

  while (queue.length > 0) {
    const current = queue.shift()!;
    const node = byKey.get(current.key);

    if (!node) {
      missingContinuationKeys.add(current.key);
      continue;
    }

    const previousLength = visitedShortestPath.get(current.key);
    if (previousLength !== undefined && previousLength <= current.path.length) {
      continue;
    }
    visitedShortestPath.set(current.key, current.path.length);

    if (node.stepRole === "complete" || node.stepRole === "delegate") {
      return {
        entryKey,
        jobLane: entry.jobLane,
        terminalRole: node.stepRole,
        stepsToOutcome: current.path.length,
        traversedNodeKeys: current.path,
        delegatedTo: node.stepRole === "delegate" ? [...(node.continuesTo ?? [])] : [],
        deadEndNodeKeys: [...deadEndNodeKeys],
        missingContinuationKeys: [...missingContinuationKeys],
      };
    }

    const nextKeys = node.continuesTo ?? [];
    if (nextKeys.length === 0) {
      if (DEAD_END_ROLES.has(node.stepRole)) {
        deadEndNodeKeys.add(node.key);
      }
      continue;
    }

    for (const nextKey of nextKeys) {
      if (current.path.includes(nextKey)) {
        sawCycle = true;
        continue;
      }
      queue.push({ key: nextKey, path: [...current.path, nextKey] });
    }
  }

  return {
    entryKey,
    jobLane: entry.jobLane,
    terminalRole: deadEndNodeKeys.size > 0 ? "dead-end" : sawCycle ? "cycle" : "dead-end",
    stepsToOutcome: null,
    traversedNodeKeys: [entryKey],
    delegatedTo: [],
    deadEndNodeKeys: [...deadEndNodeKeys],
    missingContinuationKeys: [...missingContinuationKeys],
  };
}
