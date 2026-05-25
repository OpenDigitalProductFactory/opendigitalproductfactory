import type { BuildPhase } from "@/lib/feature-build-types";

export type EpicRollupBacklogItemInput = {
  id: string;
  itemId: string;
  title: string;
  status: string;
};

export type EpicRollupBuildInput = {
  id: string;
  buildId: string;
  title: string;
  phase: BuildPhase;
  childOrder: number | null;
  updatedAt: Date | string;
};

export type EpicRollupDependencyInput = {
  dependentBuildId: string;
  dependsOnBuildId: string;
};

export type EpicRollupInput = {
  epic: {
    id: string;
    epicId: string;
    title: string;
    updatedAt: Date | string;
    originatingBacklogItemId: string | null;
    items: EpicRollupBacklogItemInput[];
    featureBuilds: EpicRollupBuildInput[];
    dependencies: EpicRollupDependencyInput[];
  };
};

export type EpicRollupView = {
  epicId: string;
  title: string;
  updatedAt: Date;
  status: "ready" | "in-progress" | "complete" | "blocked" | "needs-attention";
  backlogItems: Array<{
    itemId: string;
    title: string;
    status: string;
    isOriginating: boolean;
  }>;
  backlogSummary: string;
  childPhases: Array<{ phase: BuildPhase; count: number }>;
  children: Array<{
    buildId: string;
    title: string;
    phase: BuildPhase;
    childOrder: number | null;
    waitingOn: string[];
    updatedAt: Date;
  }>;
  rollupSummary: string;
};

const PHASE_LABELS: Partial<Record<BuildPhase, string>> = {
  ideate: "in ideate",
  plan: "planning",
  build: "in build",
  review: "in review",
  ship: "ready to ship",
  failed: "failed",
};

const PHASE_ORDER: BuildPhase[] = ["ideate", "plan", "build", "review", "ship", "complete", "failed"];

export function deriveEpicRollup({ epic }: EpicRollupInput): EpicRollupView {
  const buildsById = new Map(epic.featureBuilds.map((build) => [build.id, build]));
  const sortedChildren = [...epic.featureBuilds].sort((a, b) => {
    const orderA = a.childOrder ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.childOrder ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return a.buildId.localeCompare(b.buildId);
  });

  const dependenciesByDependent = new Map<string, EpicRollupDependencyInput[]>();
  for (const dependency of epic.dependencies) {
    const existing = dependenciesByDependent.get(dependency.dependentBuildId) ?? [];
    existing.push(dependency);
    dependenciesByDependent.set(dependency.dependentBuildId, existing);
  }

  const children = sortedChildren.map((build) => {
    const waitingOn = build.phase === "complete"
      ? []
      : (dependenciesByDependent.get(build.id) ?? [])
        .flatMap((dependency) => {
          const dependencyBuild = buildsById.get(dependency.dependsOnBuildId);
          return dependencyBuild && dependencyBuild.phase !== "complete"
            ? [dependencyBuild.title]
            : [];
        });

    return {
      buildId: build.buildId,
      title: build.title,
      phase: build.phase,
      childOrder: build.childOrder,
      waitingOn,
      updatedAt: new Date(build.updatedAt),
    };
  });

  const childPhases = PHASE_ORDER.flatMap((phase) => {
    const count = children.filter((child) => child.phase === phase).length;
    return count === 0 ? [] : [{ phase, count }];
  });

  const waitingCount = children.filter((child) => child.waitingOn.length > 0).length;
  const doneCount = children.filter((child) => child.phase === "complete").length;
  const rollupSummary = formatRollupSummary({ children, doneCount, waitingCount });

  return {
    epicId: epic.epicId,
    title: epic.title,
    updatedAt: new Date(epic.updatedAt),
    status: deriveEpicStatus(children, waitingCount),
    backlogItems: epic.items.map((item) => ({
      itemId: item.itemId,
      title: item.title,
      status: item.status,
      isOriginating: item.id === epic.originatingBacklogItemId,
    })),
    backlogSummary: formatBacklogSummary(epic.items.length),
    childPhases,
    children,
    rollupSummary,
  };
}

function deriveEpicStatus(
  children: EpicRollupView["children"],
  waitingCount: number,
): EpicRollupView["status"] {
  if (children.length === 0) return "ready";
  if (children.some((child) => child.phase === "failed")) return "needs-attention";
  if (children.every((child) => child.phase === "complete")) return "complete";
  if (waitingCount > 0 && children.every((child) => child.phase === "complete" || child.waitingOn.length > 0)) {
    return "blocked";
  }
  return "in-progress";
}

function formatRollupSummary({
  children,
  doneCount,
  waitingCount,
}: {
  children: EpicRollupView["children"];
  doneCount: number;
  waitingCount: number;
}): string {
  const total = children.length;
  if (total === 0) return "No child builds";

  const parts = [`${doneCount} of ${total} done`];
  for (const phase of PHASE_ORDER) {
    if (phase === "complete") continue;
    const count = children.filter((child) => child.phase === phase && child.waitingOn.length === 0).length;
    if (count === 0) continue;
    const label = PHASE_LABELS[phase] ?? phase;
    parts.push(`${count} ${label}`);
  }
  if (waitingCount > 0) {
    parts.push(`${waitingCount} waiting`);
  }
  return parts.join(" \u00b7 ");
}

function formatBacklogSummary(count: number): string {
  if (count === 0) return "No backlog items";
  return `${count} backlog item${count === 1 ? "" : "s"}`;
}
