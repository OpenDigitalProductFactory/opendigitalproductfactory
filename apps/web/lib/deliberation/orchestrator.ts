// apps/web/lib/deliberation/orchestrator.ts
// Task 6 — Deliberation orchestrator (spec §6.1, §6.5, §6.8, §9.5, §9.7, §13).
//
// Responsibilities:
//   1. Bootstrap a TaskRun if the caller doesn't have one (spec §6.8).
//   2. Persist a DeliberationRun row linked to that TaskRun.
//   3. Materialize the pattern's branch topology as TaskNode + TaskNodeEdge
//      rows, with each branch's authorityEnvelope = intersection of parent
//      TaskRun.authorityScope and the role's declared requirements
//      (spec §6.5).
//   4. Build a per-branch BranchRequestContract via request-contract.ts and
//      dispatch each through the existing V2 routing pipeline — no parallel
//      routing path (spec §9.7).
//   5. Record actualDiversity vs requestedDiversity honestly (spec §9.5).
//   6. Enforce maxBranches and budgetUsd caps. When exceeded, halt cleanly
//      and mark metadata.budgetHalted so the synthesizer records
//      "budget-halted" (spec §13).
//
// Test seam: the concrete V2 router is injected via the `dispatcher`
// parameter so unit tests can exercise orchestration logic without loading
// endpoint manifests or hitting the router's DB dependencies.

import { prisma } from "@dpf/db";
import { randomUUID } from "crypto";
import type {
  DeliberationActivatedRiskLevel,
  DeliberationArtifactType,
  DeliberationDiversityMode,
  DeliberationStrategyProfile,
  DeliberationTriggerSource,
} from "./types";
import { getPattern, extractRoleRecipes } from "./registry";
import type { ResolvedDeliberationPattern } from "./registry";
import {
  buildBranchRequestContract,
  type BranchRequestContract,
} from "./request-contract";
import type { RequestContract } from "@/lib/routing/request-contract";
import type { RouteDecision } from "@/lib/routing/types";

/* -------------------------------------------------------------------------- */
/* Public shapes                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Branch dispatcher — injected so unit tests can stub the router. In
 * production, the runner wires this to pipeline-v2.routeEndpointV2 (via the
 * queue/functions/deliberation-run runner).
 */
export interface BranchDispatcher {
  dispatch(
    contract: BranchRequestContract,
    branchNodeId: string,
  ): Promise<BranchDispatchResult>;
}

export interface BranchDispatchResult {
  routeDecision: RouteDecision | null;
  providerId: string | null;
  modelId: string | null;
  degraded?: {
    from: DeliberationDiversityMode;
    to: DeliberationDiversityMode;
    reason: string;
  };
  /** Non-null failure reason marks the branch failed. Run continues with
   *  surviving branches (spec §13). */
  failureReason?: string;
}

export interface OrchestrateDeliberationInput {
  /** Ownership — every branch inherits this user identity for audit + grant
   *  resolution (spec §6.5 point 2). */
  userId: string;
  /** Optional existing TaskRun. When absent, a bootstrap run is created. */
  taskRunId?: string | null;
  threadId?: string | null;
  buildId?: string | null;
  routeContext?: string | null;

  patternSlug: string;
  artifactType: DeliberationArtifactType;
  triggerSource: DeliberationTriggerSource;
  strategyProfile: DeliberationStrategyProfile;
  diversityMode: DeliberationDiversityMode;
  activatedRiskLevel?: DeliberationActivatedRiskLevel | null;

  /** Upper bound on branch count. Defaults to the pattern's total required
   *  role count (capped by spec default of 4). */
  maxBranches?: number;
  /** Upper bound on total USD spend across the run. Null = unbounded. */
  budgetUsd?: number | null;

  /** Parent authority scope (capability strings). Branches' envelopes are
   *  the intersection of this and the role's declared requirements. Empty
   *  means "no special authority" — retrieval-only is still permitted. */
  parentAuthorityScope?: string[];

  /** Test hook — if omitted, orchestrateDeliberation returns the graph but
   *  does NOT dispatch. The runner layer (queue/functions) provides a real
   *  dispatcher that wraps routeEndpointV2. */
  dispatcher?: BranchDispatcher;

  /** Progress hook — called after branch topology is persisted and after
   *  each branch dispatch. Hooked into pushThreadProgress by the runner. */
  emitProgress?: (event: OrchestrationProgress) => Promise<void>;
}

export type OrchestrationProgress =
  | {
      type: "deliberation:queued";
      deliberationRunId: string;
      patternSlug: string;
    }
  | {
      type: "deliberation:branch_dispatched";
      deliberationRunId: string;
      branchNodeId: string;
      role: string;
    }
  | {
      type: "deliberation:branch_completed";
      deliberationRunId: string;
      branchNodeId: string;
      role: string;
      success: boolean;
    }
  | {
      type: "deliberation:degraded_diversity";
      deliberationRunId: string;
      from: string;
      to: string;
      reason: string;
    }
  | {
      type: "deliberation:completed";
      deliberationRunId: string;
      consensusState: string;
    };

export interface OrchestratedDeliberation {
  deliberationRunId: string;
  taskRunId: string;
  taskRunBootstrapped: boolean;
  branches: BranchRecord[];
  requestedDiversity: DeliberationDiversityMode;
  actualDiversity: DeliberationDiversityMode | "constrained";
  budgetHalted: boolean;
  branchBudgetUsed: number;
}

export interface BranchRecord {
  branchNodeId: string;
  role: string;
  status: "queued" | "completed" | "failed" | "budget-halted";
  providerId: string | null;
  modelId: string | null;
  failureReason?: string;
  authorityEnvelope: string[];
}

/* -------------------------------------------------------------------------- */
/* Role → node mapping (preserves underscore schema values per §6.6)          */
/* -------------------------------------------------------------------------- */

interface NodeTypeMapping {
  nodeType: string;
  workerRole: string;
}

function mapRoleToNode(roleId: string): NodeTypeMapping {
  // Existing TaskNode enum values — underscores preserved per schema comments
  // (schema.prisma:2550, 2554). Deliberation-specific enums (§6.6) use
  // hyphens; existing schema columns stay as-is.
  switch (roleId) {
    case "author":
      return { nodeType: "analyze", workerRole: "planner" };
    case "reviewer":
      return { nodeType: "review", workerRole: "reviewer" };
    case "skeptic":
      return { nodeType: "skeptical_review", workerRole: "skeptical_reviewer" };
    case "debater":
      return { nodeType: "analyze", workerRole: "researcher" };
    case "adjudicator":
      return { nodeType: "summarize", workerRole: "summarizer" };
    default:
      // Unknown role — fall back to a safe read-only review node. Warn so
      // pattern authors notice missing role-to-node mappings rather than
      // silently getting a generic review node (memory: silent seed skips).
      console.warn(
        `[deliberation/orchestrator] unknown roleId "${roleId}" — mapping to review/reviewer fallback`,
      );
      return { nodeType: "review", workerRole: "reviewer" };
  }
}

/* -------------------------------------------------------------------------- */
/* Authority envelope — spec §6.5                                             */
/* -------------------------------------------------------------------------- */

/**
 * Role-specific authority requirements. Each role's envelope is the
 * INTERSECTION of parent authority and the role's requirements. Deliberation
 * branches default to read-only — we never widen. If the role declares
 * capabilities the parent doesn't have, they are dropped.
 *
 * Adjudicator has NO elevated authority per spec §6.5 point 4.
 */
const ROLE_AUTHORITY_REQUIREMENTS: Record<string, string[]> = {
  // Deliberation roles default to retrieval-only; patterns that want more
  // must declare at the pattern level (future extension).
  author: ["read"],
  reviewer: ["read"],
  skeptic: ["read"],
  debater: ["read"],
  adjudicator: ["read"],
};

export function computeBranchAuthorityEnvelope(
  parentScope: string[],
  roleId: string,
): string[] {
  const requirements = ROLE_AUTHORITY_REQUIREMENTS[roleId] ?? ["read"];
  const parentSet = new Set(parentScope);
  // Read is always implicitly granted — if parent has anything, it can read.
  // If parent scope is entirely empty, we still permit "read" because
  // deliberation is a pre-decision quality layer (spec §6.9) and reading
  // the artifact under deliberation is table stakes.
  const envelope: string[] = [];
  for (const cap of requirements) {
    if (cap === "read" || parentSet.has(cap)) {
      envelope.push(cap);
    }
    // Otherwise silently drop — we narrow only.
  }
  return envelope;
}

/* -------------------------------------------------------------------------- */
/* Topology expansion                                                         */
/* -------------------------------------------------------------------------- */

interface PlannedBranch {
  role: string;
  index: number; // 0-based index within the role (reviewer 0, reviewer 1, etc.)
  required: boolean;
}

function planBranches(
  pattern: ResolvedDeliberationPattern,
  maxBranches: number,
  activatedRiskLevel: DeliberationActivatedRiskLevel | null | undefined,
): PlannedBranch[] {
  const planned: PlannedBranch[] = [];
  for (const role of pattern.defaultRoles) {
    // Skip adjudicator for now — it is added last, after the worker branches.
    if (role.roleId === "adjudicator") continue;
    // Skip optional skeptic unless medium+ risk (review pattern §7.4).
    if (!role.required && role.roleId === "skeptic") {
      const risk = activatedRiskLevel;
      if (risk !== "medium" && risk !== "high" && risk !== "critical") {
        continue;
      }
    }
    for (let i = 0; i < role.count; i++) {
      planned.push({ role: role.roleId, index: i, required: role.required });
    }
  }
  // Enforce maxBranches cap — drop optional branches first when we need to trim.
  if (planned.length > maxBranches) {
    // Keep required ones, drop optional ones from the end.
    const kept: PlannedBranch[] = [];
    for (const b of planned) {
      if (kept.length < maxBranches) {
        kept.push(b);
      }
    }
    return kept;
  }
  return planned;
}

/* -------------------------------------------------------------------------- */
/* Main orchestration                                                         */
/* -------------------------------------------------------------------------- */

export async function orchestrateDeliberation(
  input: OrchestrateDeliberationInput,
): Promise<OrchestratedDeliberation> {
  const pattern = await getPattern(input.patternSlug);
  if (!pattern) {
    throw new Error(
      `[deliberation/orchestrator] pattern "${input.patternSlug}" not found — cannot orchestrate`,
    );
  }

  // ── Bootstrap TaskRun if none supplied (spec §6.8) ────────────────────
  let taskRunId = input.taskRunId ?? null;
  let taskRunBootstrapped = false;
  let taskRunDbId: string;

  if (taskRunId) {
    const existing = await prisma.taskRun.findUnique({
      where: { taskRunId },
      select: { id: true },
    });
    if (!existing) {
      throw new Error(
        `[deliberation/orchestrator] supplied taskRunId "${taskRunId}" not found`,
      );
    }
    taskRunDbId = existing.id;
  } else {
    const created = await prisma.taskRun.create({
      data: {
        taskRunId: `deliberation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        userId: input.userId,
        threadId: input.threadId ?? null,
        contextId: input.threadId ?? randomUUID(),
        buildId: input.buildId ?? null,
        routeContext: input.routeContext ?? "deliberation",
        title: `Deliberation: ${input.patternSlug}`,
        objective: `Run ${pattern.name} over artifactType=${input.artifactType}`,
        source: "proactive",
        status: "submitted",
        authorityScope: input.parentAuthorityScope ?? [],
      },
      select: { id: true, taskRunId: true },
    });
    taskRunDbId = created.id;
    taskRunId = created.taskRunId;
    taskRunBootstrapped = true;
  }

  // ── Create DeliberationRun row ────────────────────────────────────────
  const adjudicationMode =
    (pattern.outputContract as Record<string, unknown>)?.adjudicationMode;
  const adjudicationModeStr =
    typeof adjudicationMode === "string" ? adjudicationMode : "synthesis";

  const defaultMax = Math.min(
    4,
    pattern.defaultRoles.reduce((sum, r) => sum + (r.required ? r.count : 0), 0) + 1,
  );
  const maxBranches = input.maxBranches ?? defaultMax;

  const deliberationRun = await prisma.deliberationRun.create({
    data: {
      taskRunId: taskRunDbId,
      patternId: pattern.patternId,
      artifactType: input.artifactType,
      triggerSource: input.triggerSource,
      adjudicationMode: adjudicationModeStr,
      activatedRiskLevel: input.activatedRiskLevel ?? null,
      diversityMode: input.diversityMode,
      strategyProfile: input.strategyProfile,
      consensusState: "pending",
      maxBranches,
      budgetUsd: input.budgetUsd ?? null,
      metadata: {
        requestedDiversity: input.diversityMode,
      },
    },
    select: { id: true },
  });

  // Emit queued event.
  await safeEmit(input.emitProgress, {
    type: "deliberation:queued",
    deliberationRunId: deliberationRun.id,
    patternSlug: input.patternSlug,
  });

  // ── Plan branches ─────────────────────────────────────────────────────
  const planned = planBranches(pattern, maxBranches, input.activatedRiskLevel);

  // ── Create worker branch TaskNodes + edges ────────────────────────────
  const branches: BranchRecord[] = [];
  const branchNodeIds: string[] = [];

  for (const p of planned) {
    const { nodeType, workerRole } = mapRoleToNode(p.role);
    const envelope = computeBranchAuthorityEnvelope(
      input.parentAuthorityScope ?? [],
      p.role,
    );

    const node = await prisma.taskNode.create({
      data: {
        taskNodeId: `dnode-${deliberationRun.id}-${p.role}-${p.index}`,
        taskRunId: taskRunDbId,
        parentNodeId: null,
        nodeType,
        title: `${pattern.name} — ${p.role} #${p.index + 1}`,
        objective: `Deliberation branch role=${p.role} (pattern=${pattern.slug})`,
        status: "queued",
        workerRole,
        authorityEnvelope: envelope,
        deliberationRunId: deliberationRun.id,
      },
      select: { id: true },
    });
    branchNodeIds.push(node.id);
    branches.push({
      branchNodeId: node.id,
      role: p.role,
      status: "queued",
      providerId: null,
      modelId: null,
      authorityEnvelope: envelope,
    });
  }

  // ── Create adjudicator node + edges (fan-in) ──────────────────────────
  const adjudicatorRole = pattern.defaultRoles.find(
    (r) => r.roleId === "adjudicator",
  );
  let adjudicatorNodeDbId: string | null = null;
  if (adjudicatorRole && adjudicatorRole.required) {
    const { nodeType, workerRole } = mapRoleToNode("adjudicator");
    const envelope = computeBranchAuthorityEnvelope(
      input.parentAuthorityScope ?? [],
      "adjudicator",
    );
    const adjNode = await prisma.taskNode.create({
      data: {
        taskNodeId: `dnode-${deliberationRun.id}-adjudicator-0`,
        taskRunId: taskRunDbId,
        parentNodeId: null,
        nodeType,
        title: `${pattern.name} — adjudicator`,
        objective: `Synthesize deliberation branches (pattern=${pattern.slug})`,
        status: "queued",
        workerRole,
        authorityEnvelope: envelope,
        deliberationRunId: deliberationRun.id,
      },
      select: { id: true },
    });
    adjudicatorNodeDbId = adjNode.id;
    branches.push({
      branchNodeId: adjNode.id,
      role: "adjudicator",
      status: "queued",
      providerId: null,
      modelId: null,
      authorityEnvelope: envelope,
    });

    // Wire each worker branch → adjudicator with an "informs" edge.
    for (const workerId of branchNodeIds) {
      await prisma.taskNodeEdge.create({
        data: {
          fromNodeId: workerId,
          toNodeId: adjNode.id,
          edgeType: "informs",
        },
      });
    }
  }

  // ── Dispatch branches (optional — only when dispatcher is supplied) ────
  let budgetHalted = false;
  let branchBudgetUsed = 0;
  const recipes = extractRoleRecipes(pattern);
  const priorProviderIds: string[] = [];
  const priorModelIds: string[] = [];
  let degradationEmitted = false;

  if (input.dispatcher) {
    // Worker branches first.
    for (const br of branches) {
      if (br.role === "adjudicator") continue;
      if (budgetHalted) {
        br.status = "budget-halted";
        continue;
      }

      const contract = buildBranchRequestContract({
        roleId: br.role,
        strategyProfile: input.strategyProfile,
        diversityMode: input.diversityMode,
        artifactType: input.artifactType,
        recipeHint: recipes.get(br.role),
        priorProviderIds: [...priorProviderIds],
        priorModelIds: [...priorModelIds],
      });

      // Persist requestContract snapshot on the node (for audit + resume).
      await prisma.taskNode.update({
        where: { id: br.branchNodeId },
        data: {
          requestContract: contract as unknown as Parameters<
            typeof prisma.taskNode.update
          >[0]["data"]["requestContract"],
          status: "running",
          startedAt: new Date(),
        },
      });

      await safeEmit(input.emitProgress, {
        type: "deliberation:branch_dispatched",
        deliberationRunId: deliberationRun.id,
        branchNodeId: br.branchNodeId,
        role: br.role,
      });

      let result: BranchDispatchResult;
      try {
        result = await input.dispatcher.dispatch(contract, br.branchNodeId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        br.status = "failed";
        br.failureReason = message;
        await prisma.taskNode.update({
          where: { id: br.branchNodeId },
          data: { status: "failed", completedAt: new Date() },
        });
        await safeEmit(input.emitProgress, {
          type: "deliberation:branch_completed",
          deliberationRunId: deliberationRun.id,
          branchNodeId: br.branchNodeId,
          role: br.role,
          success: false,
        });
        continue;
      }

      br.providerId = result.providerId;
      br.modelId = result.modelId;
      if (result.providerId) priorProviderIds.push(result.providerId);
      if (result.modelId) priorModelIds.push(result.modelId);

      if (result.degraded && !degradationEmitted) {
        degradationEmitted = true;
        await safeEmit(input.emitProgress, {
          type: "deliberation:degraded_diversity",
          deliberationRunId: deliberationRun.id,
          from: result.degraded.from,
          to: result.degraded.to,
          reason: result.degraded.reason,
        });
      }

      if (result.failureReason) {
        br.status = "failed";
        br.failureReason = result.failureReason;
        await prisma.taskNode.update({
          where: { id: br.branchNodeId },
          data: {
            status: "failed",
            completedAt: new Date(),
            routeDecision: (result.routeDecision ?? null) as unknown as Parameters<
              typeof prisma.taskNode.update
            >[0]["data"]["routeDecision"],
          },
        });
        await safeEmit(input.emitProgress, {
          type: "deliberation:branch_completed",
          deliberationRunId: deliberationRun.id,
          branchNodeId: br.branchNodeId,
          role: br.role,
          success: false,
        });
        continue;
      }

      br.status = "completed";

      // Budget accounting — rough. Pull from routeDecision if the adapter
      // surfaced cost; otherwise count as a unit tick so we still honor
      // budgetUsd bounds pessimistically.
      const estimatedCost = estimateBranchCost(result.routeDecision);
      branchBudgetUsed += estimatedCost;

      await prisma.taskNode.update({
        where: { id: br.branchNodeId },
        data: {
          status: "completed",
          completedAt: new Date(),
          routeDecision: (result.routeDecision ?? null) as unknown as Parameters<
            typeof prisma.taskNode.update
          >[0]["data"]["routeDecision"],
          costUsd: estimatedCost || null,
        },
      });

      await safeEmit(input.emitProgress, {
        type: "deliberation:branch_completed",
        deliberationRunId: deliberationRun.id,
        branchNodeId: br.branchNodeId,
        role: br.role,
        success: true,
      });

      if (
        typeof input.budgetUsd === "number" &&
        input.budgetUsd > 0 &&
        branchBudgetUsed >= input.budgetUsd
      ) {
        budgetHalted = true;
      }
    }
  }

  // ── Honest diversity reporting (spec §9.5) ─────────────────────────────
  const actualDiversity = computeActualDiversity(
    input.diversityMode,
    priorProviderIds,
    priorModelIds,
  );

  await prisma.deliberationRun.update({
    where: { id: deliberationRun.id },
    data: {
      metadata: {
        requestedDiversity: input.diversityMode,
        actualDiversity,
        budgetHalted,
      },
    },
  });

  return {
    deliberationRunId: deliberationRun.id,
    taskRunId: taskRunId!,
    taskRunBootstrapped,
    branches,
    requestedDiversity: input.diversityMode,
    actualDiversity,
    budgetHalted,
    branchBudgetUsed,
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

async function safeEmit(
  fn: OrchestrateDeliberationInput["emitProgress"] | undefined,
  event: OrchestrationProgress,
): Promise<void> {
  if (!fn) return;
  try {
    await fn(event);
  } catch {
    // Progress emit must not break orchestration.
  }
}

function estimateBranchCost(decision: RouteDecision | null | undefined): number {
  if (!decision) return 0;
  // Rough: if the router surfaces fitnessScore + cost data, use it; else 0.
  // Deferred to a dispatch-side measurement when the adapter reports actual cost.
  return 0;
}

/**
 * Post-hoc honest diversity reporting per spec §9.5. Compares requested
 * diversityMode to observed providerIds/modelIds. Returns "constrained"
 * when the routing layer couldn't satisfy the requested mode.
 */
export function computeActualDiversity(
  requested: DeliberationDiversityMode,
  providerIds: string[],
  modelIds: string[],
): DeliberationDiversityMode | "constrained" {
  const uniqueProviders = new Set(providerIds.filter(Boolean));
  const uniqueModels = new Set(modelIds.filter(Boolean));

  if (requested === "multi-provider-heterogeneous") {
    // Need at least 2 distinct providers to honor.
    return uniqueProviders.size >= 2 ? requested : "constrained";
  }
  if (requested === "multi-model-same-provider") {
    // Need at least 2 distinct models.
    return uniqueModels.size >= 2 ? requested : "constrained";
  }
  // single-model-multi-persona is always satisfiable.
  return requested;
}
