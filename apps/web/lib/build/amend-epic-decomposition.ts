import { prisma } from "@dpf/db";

import type { BuildDesignDoc, BuildPhase } from "@/lib/feature-build-types";
import {
  failQuiescenceSwap,
  signalSwapComplete,
  signalSwapStarting,
  startQuiescence,
  type ActiveSessionBlockers,
  type QuiescenceOutcome,
} from "@/lib/self-upgrade/quiescence";
import {
  candidateToChildDesignDocs,
  validateCandidate,
  type DecompositionCandidate,
  type DecompositionChildScope,
} from "./decomposition-candidates";

// Phase 8 amendment substrate for execution-organizational Epics.
// Future reduction-gear instrumentation should emit a Ring 2 -> Ring 3
// GearInterface event whenever an amendment changes the child projections.

export type DecompositionAmendmentChild = {
  id: string;
  buildId: string;
  title: string;
  phase: BuildPhase;
  childOrder: number | null;
  designDoc: unknown;
  phaseRuns?: Array<{ phase: string; completedAt: Date | string | null }>;
};

type DecompositionAmendmentEpic = {
  id: string;
  epicId: string;
  title: string;
  designDoc: unknown;
  decompositionState: unknown;
  featureBuilds: DecompositionAmendmentChild[];
};

export type DecompositionAmendmentTx = {
  epic: {
    update: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<unknown>;
  };
  featureBuild: {
    update: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<unknown>;
  };
  buildActivity: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
};

export type AmendEpicDecompositionDb = {
  epic: {
    findUnique: (args: unknown) => Promise<DecompositionAmendmentEpic | null>;
  };
  $transaction: <T>(fn: (tx: DecompositionAmendmentTx) => Promise<T>) => Promise<T>;
};

export type AmendEpicDecompositionStartQuiescence = (args: {
  trigger: "manual";
  triggerRefId: string;
  budgetMs: number;
}) => Promise<{
  runId: string;
  awaitReady: () => Promise<QuiescenceOutcome | {
    ok: boolean;
    outcome: string;
    runId: string;
    finalSnapshot?: ActiveSessionBlockers | null;
    reason?: string;
    deferSurface?: string | null;
  }>;
}>;

export type DecompositionAmendmentImpact =
  | {
      ok: true;
      requiresQuiescence: boolean;
      completedChildBuildIds: string[];
      updatedChildren: Array<{
        id: string;
        buildId: string;
        childOrder: number;
        designDoc: BuildDesignDoc;
      }>;
    }
  | {
      ok: false;
      code:
        | "acceptance-criteria-shape-changed"
        | "execution-child-requires-operator-review"
        | "invalid-decomposition-state";
      error: string;
      blockedChildBuildIds?: string[];
    };

export function deriveDecompositionAmendmentImpact(args: {
  parentDesignDoc: BuildDesignDoc;
  decompositionState: unknown;
  children: DecompositionAmendmentChild[];
}): DecompositionAmendmentImpact {
  const candidate = candidateFromDecompositionState(args.decompositionState);
  if (!candidate) {
    return {
      ok: false,
      code: "invalid-decomposition-state",
      error: "Epic decompositionState is missing the approved child partition.",
    };
  }

  const expectedAcCount = expectedAcceptanceCriteriaCount(candidate.childScopes);
  if (args.parentDesignDoc.acceptanceCriteria.length !== expectedAcCount) {
    return {
      ok: false,
      code: "acceptance-criteria-shape-changed",
      error:
        `The amendment changes the parent acceptance-criteria count from ${expectedAcCount} to ${args.parentDesignDoc.acceptanceCriteria.length}. Choose a new decomposition partition before updating child designs.`,
    };
  }

  const validation = validateCandidate(candidate, args.parentDesignDoc);
  if (!validation.ok) {
    return {
      ok: false,
      code: "invalid-decomposition-state",
      error: `Stored decomposition partition is no longer valid: ${validation.failures.map((f) => f.code).join(", ")}`,
    };
  }

  const childrenByOrder = new Map<number, DecompositionAmendmentChild>();
  for (const child of args.children) {
    if (child.childOrder != null) {
      childrenByOrder.set(child.childOrder, child);
    }
  }

  const affectedChildren = args.children.filter((child) => child.phase !== "complete");
  const executionChildren = affectedChildren.filter((child) => isExecutionPhase(child.phase));
  if (executionChildren.length > 0) {
    return {
      ok: false,
      code: "execution-child-requires-operator-review",
      error:
        "One or more affected children has already entered build/review/ship. Narrow the amendment or file follow-up work instead of silently rewriting execution scope.",
      blockedChildBuildIds: executionChildren.map((child) => child.buildId),
    };
  }

  const childDocs = candidateToChildDesignDocs(candidate, args.parentDesignDoc);
  const updatedChildren = childDocs.flatMap((childDoc) => {
    const child = childrenByOrder.get(childDoc.childOrder);
    if (!child || child.phase === "complete") return [];
    return [{
      id: child.id,
      buildId: child.buildId,
      childOrder: childDoc.childOrder,
      designDoc: childDoc.designDoc,
    }];
  });

  const completedChildBuildIds = args.children
    .filter((child) => child.phase === "complete")
    .map((child) => child.buildId);
  const requiresQuiescence = affectedChildren.some((child) => hasInFlightPlanRun(child));

  return {
    ok: true,
    requiresQuiescence,
    completedChildBuildIds,
    updatedChildren,
  };
}

export type AmendEpicDecompositionResult =
  | {
      ok: true;
      quiescenceRunId: string | null;
      updatedChildBuildIds: string[];
      skippedCompletedChildBuildIds: string[];
    }
  | {
      ok: false;
      code:
        | "epic-not-found"
        | "epic-missing-design-doc"
        | "acceptance-criteria-shape-changed"
        | "execution-child-requires-operator-review"
        | "invalid-decomposition-state"
        | "quiescence-not-ready";
      error: string;
      blockedChildBuildIds?: string[];
    };

export async function amendEpicDecomposition(args: {
  epicId: string;
  proposedDesignDoc: BuildDesignDoc;
  rationale: string;
  userId: string;
  db?: AmendEpicDecompositionDb;
  startQuiescence?: AmendEpicDecompositionStartQuiescence;
  now?: () => Date;
}): Promise<AmendEpicDecompositionResult> {
  const now = args.now ?? (() => new Date());
  const db = args.db ?? defaultDb();
  const epic = await db.epic.findUnique({
    where: { epicId: args.epicId },
    select: {
      id: true,
      epicId: true,
      title: true,
      designDoc: true,
      decompositionState: true,
      featureBuilds: {
        select: {
          id: true,
          buildId: true,
          title: true,
          phase: true,
          childOrder: true,
          designDoc: true,
          phaseRuns: {
            where: { completedAt: null },
            select: { phase: true, completedAt: true },
          },
        },
        orderBy: [{ childOrder: "asc" }, { buildId: "asc" }],
      },
    },
  });

  if (!epic) {
    return { ok: false, code: "epic-not-found", error: `Epic ${args.epicId} not found.` };
  }
  const currentDesignDoc = coerceBuildDesignDoc(epic.designDoc);
  if (!currentDesignDoc) {
    return {
      ok: false,
      code: "epic-missing-design-doc",
      error: `Epic ${epic.epicId} does not have a designDoc to amend.`,
    };
  }

  const impact = deriveDecompositionAmendmentImpact({
    parentDesignDoc: args.proposedDesignDoc,
    decompositionState: epic.decompositionState,
    children: epic.featureBuilds,
  });
  if (!impact.ok) {
    return impact;
  }

  let quiescenceRunId: string | null = null;
  const injectedQuiescence = args.startQuiescence != null;
  const startQuiescenceFn = args.startQuiescence ?? startQuiescence;
  if (impact.requiresQuiescence) {
    const started = await startQuiescenceFn({
      trigger: "manual",
      triggerRefId: `decomposition-amendment:${epic.epicId}`,
      budgetMs: 5 * 60 * 1000,
    });
    quiescenceRunId = started.runId;
    const ready = await started.awaitReady();
    if (!ready.ok) {
      return {
        ok: false,
        code: "quiescence-not-ready",
        error: formatQuiescenceFailure(ready),
      };
    }
    if (!injectedQuiescence) {
      await signalSwapStarting(quiescenceRunId);
    }
  }

  try {
    const amendedAt = now().toISOString();
    const nextState = appendAmendmentRecord({
      state: epic.decompositionState,
      amendment: {
        amendedAt,
        amendedByUserId: args.userId,
        rationale: args.rationale.trim(),
        quiescenceRunId,
        affectedChildBuildIds: impact.updatedChildren.map((child) => child.buildId),
        skippedCompletedChildBuildIds: impact.completedChildBuildIds,
        designDocDiff: summarizeDesignDocDiff(currentDesignDoc, args.proposedDesignDoc),
        gearInterfaceAlignment:
          "Future reduction-gear instrumentation emits a Ring 2 -> Ring 3 GearInterface event for this amendment.",
      },
    });

    await db.$transaction(async (tx) => {
      await tx.epic.update({
        where: { id: epic.id },
        data: {
          designDoc: args.proposedDesignDoc as unknown as Record<string, unknown>,
          decompositionState: nextState as Record<string, unknown>,
        },
      });

      for (const child of impact.updatedChildren) {
        await tx.featureBuild.update({
          where: { buildId: child.buildId },
          data: { designDoc: child.designDoc as unknown as Record<string, unknown> },
        });
        await tx.buildActivity.create({
          data: {
            buildId: child.buildId,
            tool: "amendEpicDecomposition",
            summary: `Parent Epic ${epic.epicId} design amended; child #${child.childOrder} design projection re-derived.`,
          },
        });
      }
    });
  } catch (err) {
    if (quiescenceRunId && !injectedQuiescence) {
      await failQuiescenceSwap(
        quiescenceRunId,
        err instanceof Error ? err.message : "Epic decomposition amendment failed.",
      );
    }
    throw err;
  }

  if (quiescenceRunId && !injectedQuiescence) {
    await signalSwapComplete(quiescenceRunId);
  }

  return {
    ok: true,
    quiescenceRunId,
    updatedChildBuildIds: impact.updatedChildren.map((child) => child.buildId),
    skippedCompletedChildBuildIds: impact.completedChildBuildIds,
  };
}

function defaultDb(): AmendEpicDecompositionDb {
  return {
    epic: {
      findUnique: prisma.epic.findUnique.bind(prisma.epic) as AmendEpicDecompositionDb["epic"]["findUnique"],
    },
    $transaction: ((fn) => prisma.$transaction(fn as never)) as AmendEpicDecompositionDb["$transaction"],
  };
}

function candidateFromDecompositionState(state: unknown): DecompositionCandidate | null {
  if (!isRecord(state) || !Array.isArray(state.partition)) return null;
  const childScopes: DecompositionChildScope[] = [];
  for (const rawScope of state.partition) {
    if (!isRecord(rawScope)) return null;
    const childOrder = numberValue(rawScope.childOrder);
    const title = stringValue(rawScope.title);
    const summary = stringValue(rawScope.summary);
    const acceptanceCriteriaIndices = numberArray(rawScope.acceptanceCriteriaIndices);
    const dependsOn = numberArray(rawScope.dependsOn);
    if (
      childOrder == null
      || title == null
      || summary == null
      || acceptanceCriteriaIndices == null
      || dependsOn == null
    ) {
      return null;
    }
    childScopes.push({
      childOrder,
      title,
      summary,
      acceptanceCriteriaIndices,
      dependsOn,
    });
  }

  return {
    candidateId: stringValue(state.candidateId) ?? "approved-partition",
    rationale: stringValue(state.candidateRationale) ?? "Approved decomposition partition.",
    childScopes,
  };
}

function expectedAcceptanceCriteriaCount(childScopes: DecompositionChildScope[]): number {
  const indices = new Set<number>();
  for (const scope of childScopes) {
    for (const index of scope.acceptanceCriteriaIndices) {
      indices.add(index);
    }
  }
  return indices.size;
}

function isExecutionPhase(phase: BuildPhase): boolean {
  return phase === "build" || phase === "review" || phase === "ship";
}

function hasInFlightPlanRun(child: DecompositionAmendmentChild): boolean {
  return (child.phaseRuns ?? []).some((run) => run.phase === "plan" && run.completedAt == null);
}

export function coerceBuildDesignDoc(value: unknown): BuildDesignDoc | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.problemStatement !== "string"
    || typeof value.reusePlan !== "string"
    || typeof value.proposedApproach !== "string"
    || !Array.isArray(value.acceptanceCriteria)
    || !value.acceptanceCriteria.every((item) => typeof item === "string")
  ) {
    return null;
  }
  return value as BuildDesignDoc;
}

function appendAmendmentRecord(args: {
  state: unknown;
  amendment: Record<string, unknown>;
}): Record<string, unknown> {
  const state = isRecord(args.state) ? args.state : {};
  const prior = Array.isArray(state.amendments) ? state.amendments : [];
  return {
    ...state,
    amendments: [...prior, args.amendment],
  };
}

function summarizeDesignDocDiff(
  before: BuildDesignDoc,
  after: BuildDesignDoc,
): Record<string, unknown> {
  const changedFields: string[] = [];
  const scalarFields = [
    "problemStatement",
    "dataModel",
    "existingCodeAudit",
    "existingFunctionalityAudit",
    "reusePlan",
    "proposedApproach",
    "accessibility",
  ] as const;
  for (const field of scalarFields) {
    if (before[field] !== after[field]) {
      changedFields.push(field);
    }
  }
  const acceptanceCriteria = after.acceptanceCriteria.flatMap((afterText, index) => {
    const beforeText = before.acceptanceCriteria[index];
    return beforeText === afterText
      ? []
      : [{ index, before: beforeText ?? null, after: afterText }];
  });
  if (acceptanceCriteria.length > 0) {
    changedFields.push("acceptanceCriteria");
  }

  return {
    changedFields,
    acceptanceCriteria,
  };
}

type AmendmentQuiescenceReadyOutcome = Awaited<
  ReturnType<Awaited<ReturnType<AmendEpicDecompositionStartQuiescence>>["awaitReady"]>
>;

function formatQuiescenceFailure(outcome: AmendmentQuiescenceReadyOutcome): string {
  if (outcome.outcome === "deferred") {
    return `Quiescence deferred amendment for ${"deferSurface" in outcome ? outcome.deferSurface ?? "unknown surface" : "unknown surface"}.`;
  }
  if ("reason" in outcome && outcome.reason) {
    return `Quiescence ${outcome.outcome}: ${outcome.reason}`;
  }
  return `Quiescence ${outcome.outcome}; parent design was not amended.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function numberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const out: number[] = [];
  for (const item of value) {
    if (typeof item !== "number" || !Number.isInteger(item)) return null;
    out.push(item);
  }
  return out;
}
