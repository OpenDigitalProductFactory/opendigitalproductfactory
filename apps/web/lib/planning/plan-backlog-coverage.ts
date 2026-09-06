import { prisma } from "@dpf/db";

import { resolveRepositoryArtifact, type InitiativeArtifactRef } from "@/lib/backlog/initiative-readiness";
import { projectMissingBaselineRecovery } from "./plan-coverage-recovery";

export {
  projectPlanBacklogDependencies,
  type PlanDependencyProjection,
} from "./plan-backlog-dependency-projection";

export type PlanBacklogCoverageDecision = "decomposed" | "atomic";

export type PlanBacklogDeliverable = {
  key: string;
  title: string;
  independentlyShippable: boolean;
  backlogItemId?: string;
  dependsOn?: string[];
};

export type PlanBacklogDeliverableV2 = PlanBacklogDeliverable & {
  requirementRefs: string[];
  contractRefs: string[];
  flowRefs: string[];
  verificationRefs: string[];
  disposition?: { decision: "deferred" | "not-applicable"; reason: string };
};

export type PlanBacklogCoverageReceipt = {
  schemaVersion?: 1 | 2;
  planPath: string;
  planArtifactRef?: {
    kind: "repo-blob-at-commit";
    repositoryFullName: string;
    commitSha: string;
    path: string;
    providerBlobId: string;
  };
  planArtifactDigest?: string;
  scopeBaselineId?: string;
  scopeBaselineArtifactDigest?: string;
  decision: PlanBacklogCoverageDecision;
  rationale?: string;
  deliverables: PlanBacklogDeliverable[] | PlanBacklogDeliverableV2[];
};

export type MappedBacklogItem = { itemId: string; status: string; workType?: string | null };

type CoverageBacklogItem = {
  id: string;
  itemId: string;
  effortSize: string | null;
  type?: string | null;
  source?: string | null;
  workType?: string | null;
  scopeKind?: string | null;
};

export type PlanBacklogCoverageValidation =
  | {
      ok: true;
      decision: PlanBacklogCoverageDecision;
      mappedItemIds: string[];
    }
  | {
      ok: false;
      code:
        | "decision-required"
        | "decomposition-required"
        | "atomic-rationale-required"
        | "atomic-conflicts-with-independent-work"
        | "invalid-deliverable-graph";
      error: string;
      missingDeliverableKeys?: string[];
      missingBacklogItemIds?: string[];
    };

type PlanBacklogCoverageErrorCode = Extract<PlanBacklogCoverageValidation, { ok: false }>["code"];

function hasDependencyCycle(deliverables: PlanBacklogDeliverable[]): boolean {
  const graph = new Map(deliverables.map((item) => [item.key, item.dependsOn ?? []]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string): boolean => {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    for (const dependency of graph.get(key) ?? []) {
      if (visit(dependency)) return true;
    }
    visiting.delete(key);
    visited.add(key);
    return false;
  };
  return [...graph.keys()].some(visit);
}

export function validatePlanBacklogCoverage(args: {
  effortSize: string | null;
  decision?: PlanBacklogCoverageDecision;
  rationale?: string;
  deliverables: PlanBacklogDeliverable[];
  mappedBacklogItems: MappedBacklogItem[];
}): PlanBacklogCoverageValidation {
  const keys = new Set<string>();
  for (const deliverable of args.deliverables) {
    const key = deliverable.key.trim();
    if (!key || keys.has(key)) {
      return {
        ok: false,
        code: "invalid-deliverable-graph",
        error: "Every deliverable needs a unique non-empty key.",
      };
    }
    keys.add(key);
  }
  if (hasDependencyCycle(args.deliverables)) {
    return {
      ok: false,
      code: "invalid-deliverable-graph",
      error: "The deliverable dependency graph contains a cycle.",
    };
  }
  for (const deliverable of args.deliverables) {
    const unknown = (deliverable.dependsOn ?? []).filter((key) => !keys.has(key));
    if (unknown.length > 0) {
      return {
        ok: false,
        code: "invalid-deliverable-graph",
        error: `Deliverable ${deliverable.key} depends on unknown key(s): ${unknown.join(", ")}.`,
      };
    }
  }

  if (!args.decision) {
    return {
      ok: false,
      code: "decision-required",
      error:
        args.effortSize === "xlarge"
          ? "xlarge work requires a decomposition decision before implementation."
          : "A plan backlog coverage decision is required.",
    };
  }

  if (args.decision === "atomic") {
    if (args.deliverables.some((deliverable) => deliverable.independentlyShippable)) {
      return {
        ok: false,
        code: "atomic-conflicts-with-independent-work",
        error:
          "An atomic decision cannot retain a deliverable marked independently shippable. Decompose it or mark the phase as sequencing-only with a rationale.",
      };
    }
    if ((args.rationale ?? "").trim().length < 20) {
      return {
        ok: false,
        code: "atomic-rationale-required",
        error:
          "Keeping one BI requires an auditable rationale explaining why the phases are not independently shippable.",
      };
    }
    return { ok: true, decision: "atomic", mappedItemIds: [] };
  }

  const liveIds = new Set(args.mappedBacklogItems.map((item) => item.itemId));
  const independent = args.deliverables.filter((deliverable) => deliverable.independentlyShippable);
  const missingDeliverableKeys = independent
    .filter((deliverable) => !deliverable.backlogItemId)
    .map((deliverable) => deliverable.key);
  const missingBacklogItemIds = independent
    .map((deliverable) => deliverable.backlogItemId)
    .filter((itemId): itemId is string => Boolean(itemId) && !liveIds.has(itemId!));

  if (missingDeliverableKeys.length > 0 || missingBacklogItemIds.length > 0) {
    return {
      ok: false,
      code: "decomposition-required",
      error:
        "Every independently shippable deliverable must map to a live BacklogItem before planning can be complete.",
      missingDeliverableKeys,
      missingBacklogItemIds,
    };
  }

  return {
    ok: true,
    decision: "decomposed",
    mappedItemIds: Array.from(
      new Set(independent.map((deliverable) => deliverable.backlogItemId).filter(Boolean) as string[]),
    ),
  };
}

export type PlanBacklogCoverageReceiptValidation =
  | { ok: true; schemaVersion: 1 | 2; decision: PlanBacklogCoverageDecision; mappedItemIds: string[] }
  | {
    ok: false;
    code:
      | "coverage-v2-required"
      | "stale-plan-artifact"
      | "stale-scope-baseline"
      | "traceability-incomplete"
      | PlanBacklogCoverageErrorCode;
    error: string;
  };

function nonEmptyRefs(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0
    && value.every((entry) => typeof entry === "string" && entry.trim().length > 0);
}

function isCanonicalPlanPath(value: string): boolean {
  return /^docs\/superpowers\/plans\/[A-Za-z0-9][A-Za-z0-9._/-]*\.md$/.test(value)
    && !value.split("/").some((segment) => segment === "." || segment === "..");
}

export type PlanTraceabilityContext = {
  planText: string;
  baselineId: string;
  baselineArtifactDigest: string;
  objectiveIds: readonly string[];
  acceptanceIds: readonly string[];
};

type ScopeBaselineRow = { payload: unknown };

export function projectCurrentScopeBaselineTraceability(rows: ScopeBaselineRow[]): {
  baselineId: string;
  artifactDigest: string;
  objectiveIds: string[];
  acceptanceIds: string[];
} | null {
  const parsed = rows.flatMap(({ payload }) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
    const row = payload as Record<string, unknown>;
    if (typeof row.baselineId !== "string" || typeof row.artifactDigest !== "string"
      || (row.supersedesBaselineId !== null && typeof row.supersedesBaselineId !== "string")
      || !Array.isArray(row.objectiveStatements) || !Array.isArray(row.acceptanceStatements)) return [];
    const objectiveIds = row.objectiveStatements.flatMap((entry) => entry && typeof entry === "object"
      && typeof (entry as Record<string, unknown>).objectiveId === "string"
      ? [(entry as Record<string, string>).objectiveId]
      : []);
    const acceptanceIds = row.acceptanceStatements.flatMap((entry) => entry && typeof entry === "object"
      && typeof (entry as Record<string, unknown>).acceptanceId === "string"
      ? [(entry as Record<string, string>).acceptanceId]
      : []);
    if (objectiveIds.length !== row.objectiveStatements.length || acceptanceIds.length !== row.acceptanceStatements.length) return [];
    return [{
      baselineId: row.baselineId,
      supersedesBaselineId: row.supersedesBaselineId as string | null,
      artifactDigest: row.artifactDigest,
      objectiveIds,
      acceptanceIds,
    }];
  });
  if (parsed.length !== rows.length) return null;
  const superseded = new Set(parsed.map((entry) => entry.supersedesBaselineId).filter(Boolean));
  const heads = parsed.filter((entry) => !superseded.has(entry.baselineId));
  return heads.length === 1 ? heads[0]! : null;
}

export function validatePlanBacklogCoverageReceipt(args: {
  receipt: PlanBacklogCoverageReceipt;
  mappedBacklogItems: MappedBacklogItem[];
  requireGovernedImplementation: boolean;
  currentPlanDigest: string;
  traceabilityContext?: PlanTraceabilityContext;
}): PlanBacklogCoverageReceiptValidation {
  const schemaVersion = args.receipt.schemaVersion ?? 1;
  if (args.requireGovernedImplementation && schemaVersion !== 2) {
    return { ok: false, code: "coverage-v2-required", error: "Governed implementation requires plan coverage schema version 2." };
  }
  if (schemaVersion === 2) {
    const locator = args.receipt.planArtifactRef;
    if (!locator || locator.kind !== "repo-blob-at-commit"
      || !locator.repositoryFullName || !locator.commitSha || !locator.path || !locator.providerBlobId
      || !isCanonicalPlanPath(args.receipt.planPath) || locator.path !== args.receipt.planPath
      || !args.receipt.planArtifactDigest
      || args.receipt.planArtifactDigest !== args.currentPlanDigest) {
      return { ok: false, code: "stale-plan-artifact", error: "Plan coverage is not bound to the current immutable plan artifact." };
    }
    const traceability = args.traceabilityContext;
    if (!traceability || !traceability.planText.trim()
      || traceability.objectiveIds.length === 0 || traceability.acceptanceIds.length === 0) {
      // Name which of the three inputs is absent; "could not be resolved" sent
      // two prior sessions bisecting by trial (BI-38A353B2).
      const absent = [
        !traceability || !traceability.planText.trim() ? "the plan text (the resolved plan artifact is empty)" : null,
        traceability && traceability.objectiveIds.length === 0 ? "objective ids on the scope baseline" : null,
        traceability && traceability.acceptanceIds.length === 0 ? "acceptance ids on the scope baseline" : null,
      ].filter(Boolean);
      return {
        ok: false,
        code: "traceability-incomplete",
        error: `Plan coverage needs plan text plus objective and acceptance ids from the scope baseline; missing: ${absent.join(", ") || "the scope-baseline traceability context"}. `
          + "Objective and acceptance ids come from the scope manifest in the canonical design the spec-approval gate baselined; re-approve the design if it does not declare them.",
      };
    }
    if (!args.receipt.scopeBaselineId || !args.receipt.scopeBaselineArtifactDigest
      || args.receipt.scopeBaselineId !== traceability.baselineId
      || args.receipt.scopeBaselineArtifactDigest !== traceability.baselineArtifactDigest) {
      return { ok: false, code: "stale-scope-baseline", error: "Plan coverage is not bound to the exact current scope baseline." };
    }
    const objectiveIds = new Set(traceability.objectiveIds);
    const acceptanceIds = new Set(traceability.acceptanceIds);
    const coveredAcceptance = new Set<string>();
    let firstIncompleteKey: string | null = null;
    const incomplete = args.receipt.deliverables.some((deliverable) => {
      const failed = (): true => { firstIncompleteKey ??= deliverable.key; return true; };
      if (!deliverable.independentlyShippable && args.receipt.decision !== "atomic") return false;
      const v2 = deliverable as Partial<PlanBacklogDeliverableV2>;
      if (!nonEmptyRefs(v2.requirementRefs)
        || !nonEmptyRefs(v2.contractRefs)
        || !nonEmptyRefs(v2.flowRefs)
        || !nonEmptyRefs(v2.verificationRefs)) return failed();
      const allRefs = [...v2.requirementRefs, ...v2.contractRefs, ...v2.flowRefs, ...v2.verificationRefs];
      if (allRefs.some((ref) => !traceability.planText.includes(ref))
        || v2.requirementRefs.some((ref) => !objectiveIds.has(ref))
        || v2.verificationRefs.some((ref) => !acceptanceIds.has(ref))) return failed();
      for (const ref of v2.verificationRefs) coveredAcceptance.add(ref);
      return v2.disposition && v2.verificationRefs.some((ref) => acceptanceIds.has(ref)) ? failed() : false;
    });
    if (incomplete || [...acceptanceIds].some((id) => !coveredAcceptance.has(id))) {
      // Name the offending deliverable and which leg failed, rather than
      // restating the rule the caller already read (BI-38A353B2).
      const uncovered = [...acceptanceIds].filter((id) => !coveredAcceptance.has(id));
      return {
        ok: false,
        code: "traceability-incomplete",
        error: uncovered.length > 0 && !incomplete
          ? `Every acceptance id on the scope baseline must be covered by some deliverable's verificationRefs; uncovered: ${uncovered.join(", ")}.`
          : `Deliverable ${firstIncompleteKey ?? "(unknown)"} is not fully traced: each implementation deliverable needs non-empty requirementRefs, contractRefs, flowRefs, and verificationRefs, every ref must appear verbatim in the plan text, requirementRefs must be baseline objective ids, and verificationRefs must be baseline acceptance ids.`
          + (uncovered.length > 0 ? ` Uncovered acceptance ids: ${uncovered.join(", ")}.` : ""),
      };
    }
  }

  const base = validatePlanBacklogCoverage({
    effortSize: null,
    decision: args.receipt.decision,
    rationale: args.receipt.rationale,
    deliverables: args.receipt.deliverables,
    mappedBacklogItems: args.mappedBacklogItems,
  });
  if (!base.ok) return { ok: false, code: base.code, error: base.error };
  return { ok: true, schemaVersion, decision: base.decision, mappedItemIds: base.mappedItemIds };
}

export type PlanBacklogCoverageDb = {
  $queryRaw?: <T>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
  $transaction?: <T>(
    work: (tx: PlanBacklogCoverageDb) => Promise<T>,
    options?: { isolationLevel: "Serializable" },
  ) => Promise<T>;
  backlogItem: {
    findUnique: (args: {
      where: { itemId: string };
      select: { id: true; itemId: true; effortSize: true; type?: true; source?: true; workType?: true; scopeKind?: true };
    }) => Promise<CoverageBacklogItem | null>;
    findMany: (args: {
      where: { itemId: { in: string[] } };
      select: { itemId: true; status: true; workType?: true };
    }) => Promise<MappedBacklogItem[]>;
  };
  backlogItemActivity: {
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
    findMany: (args: Record<string, unknown>) => Promise<ScopeBaselineRow[]>;
    findUnique?: (args: {
      where: { id: string };
      select: { id: true; backlogItemId: true; kind: true; payload: true };
    }) => Promise<{ id: string; backlogItemId: string; kind: string; payload: unknown } | null>;
  };
};

export type CheckPlanBacklogCoverageResult =
  | { ok: true; valid: true; decision: PlanBacklogCoverageDecision; mappedItemIds: string[] }
  | {
      ok: false;
      valid: false;
      code:
        | "backlog-item-not-found"
        | "receipt-not-found"
        | "receipt-parent-mismatch"
        | "receipt-plan-mismatch"
        | "receipt-invalid";
      error: string;
    }
  | Extract<PlanBacklogCoverageValidation, { ok: false }>;

export type BranchPlanBacklogGateDb = {
  workroom: {
    findFirst: (args: Record<string, unknown>) => Promise<{ backlogItemId: string | null } | null>;
  };
  backlogItem: PlanBacklogCoverageDb["backlogItem"];
  backlogItemActivity: {
    findFirst: (args: Record<string, unknown>) => Promise<{ id: string; payload: unknown } | null>;
    findMany: (args: Record<string, unknown>) => Promise<ScopeBaselineRow[]>;
  };
};

export async function checkBranchPlanBacklogGate(args: {
  branchName: string;
  db?: BranchPlanBacklogGateDb;
  resolveArtifact?: typeof resolveRepositoryArtifact;
}): Promise<
  | { ok: true; required: false; itemId?: string }
  | { ok: true; required: true; itemId: string; receiptId: string; decision: PlanBacklogCoverageDecision }
  | { ok: false; required: true; code: "decomposition-decision-required" | "receipt-invalid"; error: string; itemId: string }
> {
  const db: BranchPlanBacklogGateDb = args.db ?? {
    workroom: {
      findFirst: prisma.workroom.findFirst.bind(prisma.workroom) as unknown as BranchPlanBacklogGateDb["workroom"]["findFirst"],
    },
    backlogItem: {
      findUnique: prisma.backlogItem.findUnique.bind(prisma.backlogItem) as unknown as BranchPlanBacklogGateDb["backlogItem"]["findUnique"],
      findMany: prisma.backlogItem.findMany.bind(prisma.backlogItem) as unknown as BranchPlanBacklogGateDb["backlogItem"]["findMany"],
    },
    backlogItemActivity: {
      findFirst: prisma.backlogItemActivity.findFirst.bind(prisma.backlogItemActivity) as unknown as BranchPlanBacklogGateDb["backlogItemActivity"]["findFirst"],
      findMany: prisma.backlogItemActivity.findMany.bind(prisma.backlogItemActivity) as unknown as BranchPlanBacklogGateDb["backlogItemActivity"]["findMany"],
    },
  };
  const capsule = await db.workroom.findFirst({
    where: { headBranch: args.branchName, status: { in: ["draft", "active", "blocked"] } },
    orderBy: { updatedAt: "desc" },
    select: { backlogItemId: true },
  });
  if (!capsule?.backlogItemId) return { ok: true, required: false };
  const parent = await db.backlogItem.findUnique({
    where: { itemId: capsule.backlogItemId },
    select: { id: true, itemId: true, effortSize: true },
  });
  if (!parent || parent.effortSize !== "xlarge") {
    return { ok: true, required: false, itemId: capsule.backlogItemId };
  }
  const activity = await db.backlogItemActivity.findFirst({
    where: { backlogItemId: parent.id, kind: "plan_backlog_coverage" },
    orderBy: { recordedAt: "desc" },
    select: { id: true, payload: true },
  });
  if (!activity) {
    return {
      ok: false,
      required: true,
      code: "decomposition-decision-required",
      error: `xlarge BacklogItem ${parent.itemId} requires a decomposition decision before implementation.`,
      itemId: parent.itemId,
    };
  }
  const payload = activity.payload as (PlanBacklogCoverageReceipt & Record<string, unknown>) | null;
  if (
    !payload
    || payload.schemaVersion !== 2
    || (payload.decision !== "atomic" && payload.decision !== "decomposed")
    || !Array.isArray(payload.deliverables)
    || !payload.planArtifactRef
  ) {
    return { ok: false, required: true, code: "receipt-invalid", error: "Latest coverage receipt is invalid; governed implementation requires schema version 2.", itemId: parent.itemId };
  }
  const deliverables = payload.deliverables as PlanBacklogDeliverable[];
  const requestedIds = Array.from(new Set(deliverables.map((d) => d.backlogItemId).filter((id): id is string => Boolean(id))));
  const mappedBacklogItems = requestedIds.length
    ? await db.backlogItem.findMany({ where: { itemId: { in: requestedIds } }, select: { itemId: true, status: true } })
    : [];
  const resolved = await (args.resolveArtifact ?? resolveRepositoryArtifact)({
    locator: payload.planArtifactRef,
    subject: { kind: "backlog-item", id: parent.itemId },
  });
  if (!resolved.ok) {
    return { ok: false, required: true, code: "receipt-invalid", error: resolved.error, itemId: parent.itemId };
  }
  const baseline = projectCurrentScopeBaselineTraceability(await db.backlogItemActivity.findMany({
    where: { backlogItemId: parent.id, kind: "initiative_scope_baseline" },
    orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
    select: { payload: true },
  }));
  const validation = validatePlanBacklogCoverageReceipt({
    receipt: payload,
    mappedBacklogItems,
    requireGovernedImplementation: true,
    currentPlanDigest: resolved.artifact.digest,
    traceabilityContext: baseline ? {
      planText: Buffer.from(resolved.artifact.bytes).toString("utf8"),
      baselineId: baseline.baselineId,
      baselineArtifactDigest: baseline.artifactDigest,
      objectiveIds: baseline.objectiveIds,
      acceptanceIds: baseline.acceptanceIds,
    } : undefined,
  });
  if (!validation.ok) {
    return { ok: false, required: true, code: "receipt-invalid", error: validation.error, itemId: parent.itemId };
  }
  return { ok: true, required: true, itemId: parent.itemId, receiptId: activity.id, decision: validation.decision };
}

export async function checkPlanBacklogCoverage(args: {
  itemId: string;
  planPath: string;
  receiptId: string;
  db?: PlanBacklogCoverageDb;
  resolveArtifact?: typeof resolveRepositoryArtifact;
}): Promise<CheckPlanBacklogCoverageResult> {
  const db: PlanBacklogCoverageDb = args.db ?? {
    backlogItem: {
      findUnique: prisma.backlogItem.findUnique.bind(prisma.backlogItem) as unknown as PlanBacklogCoverageDb["backlogItem"]["findUnique"],
      findMany: prisma.backlogItem.findMany.bind(prisma.backlogItem) as unknown as PlanBacklogCoverageDb["backlogItem"]["findMany"],
    },
    backlogItemActivity: {
      create: prisma.backlogItemActivity.create.bind(prisma.backlogItemActivity) as unknown as PlanBacklogCoverageDb["backlogItemActivity"]["create"],
      findMany: prisma.backlogItemActivity.findMany.bind(prisma.backlogItemActivity) as unknown as PlanBacklogCoverageDb["backlogItemActivity"]["findMany"],
      findUnique: prisma.backlogItemActivity.findUnique.bind(prisma.backlogItemActivity) as unknown as NonNullable<PlanBacklogCoverageDb["backlogItemActivity"]["findUnique"]>,
    },
  };
  const parent = await db.backlogItem.findUnique({
    where: { itemId: args.itemId },
    select: { id: true, itemId: true, effortSize: true },
  });
  if (!parent) {
    return { ok: false, valid: false, code: "backlog-item-not-found", error: `BacklogItem ${args.itemId} was not found.` };
  }
  const activity = db.backlogItemActivity.findUnique
    ? await db.backlogItemActivity.findUnique({
        where: { id: args.receiptId },
        select: { id: true, backlogItemId: true, kind: true, payload: true },
      })
    : null;
  if (!activity) {
    return { ok: false, valid: false, code: "receipt-not-found", error: `Coverage receipt ${args.receiptId} was not found.` };
  }
  if (activity.backlogItemId !== parent.id) {
    return { ok: false, valid: false, code: "receipt-parent-mismatch", error: "Coverage receipt belongs to a different BacklogItem." };
  }
  let rawPayload = activity.payload;
  if (activity.kind === "manual_check") {
    const wrapper = activity.payload as { body?: unknown };
    try {
      const parsed = typeof wrapper.body === "string" ? JSON.parse(wrapper.body) : null;
      rawPayload = parsed?.bootstrapPlanBacklogCoverage ?? null;
    } catch {
      rawPayload = null;
    }
  } else if (activity.kind !== "plan_backlog_coverage") {
    rawPayload = null;
  }
  const payload = rawPayload as (PlanBacklogCoverageReceipt & Record<string, unknown>) | null;
  if (!payload) {
    return { ok: false, valid: false, code: "receipt-not-found", error: `Coverage receipt ${args.receiptId} was not found.` };
  }
  if (payload.planPath !== args.planPath) {
    return { ok: false, valid: false, code: "receipt-plan-mismatch", error: "Coverage receipt belongs to a different plan." };
  }
  if (
    (payload.decision !== "atomic" && payload.decision !== "decomposed") ||
    !Array.isArray(payload.deliverables)
  ) {
    return { ok: false, valid: false, code: "receipt-invalid", error: "Coverage receipt payload is invalid." };
  }
  const deliverables = payload.deliverables as PlanBacklogDeliverable[];
  const requestedIds = Array.from(
    new Set(deliverables.map((deliverable) => deliverable.backlogItemId).filter((id): id is string => Boolean(id))),
  );
  const mappedBacklogItems = requestedIds.length
    ? await db.backlogItem.findMany({
        where: { itemId: { in: requestedIds } },
        select: { itemId: true, status: true },
      })
    : [];
  if (payload.schemaVersion === 2) {
    if (!payload.planArtifactRef) {
      return { ok: false, valid: false, code: "receipt-invalid", error: "Version 2 coverage has no immutable plan locator." };
    }
    const resolved = await (args.resolveArtifact ?? resolveRepositoryArtifact)({
      locator: payload.planArtifactRef,
      subject: { kind: "backlog-item", id: parent.itemId },
    });
    if (!resolved.ok) {
      return { ok: false, valid: false, code: "receipt-invalid", error: resolved.error };
    }
    const baseline = projectCurrentScopeBaselineTraceability(await db.backlogItemActivity.findMany({
      where: { backlogItemId: parent.id, kind: "initiative_scope_baseline" },
      orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
      select: { payload: true },
    }));
    const governed = validatePlanBacklogCoverageReceipt({
      receipt: payload,
      mappedBacklogItems,
      requireGovernedImplementation: true,
      currentPlanDigest: resolved.artifact.digest,
      traceabilityContext: baseline ? {
        planText: Buffer.from(resolved.artifact.bytes).toString("utf8"),
        baselineId: baseline.baselineId,
        baselineArtifactDigest: baseline.artifactDigest,
        objectiveIds: baseline.objectiveIds,
        acceptanceIds: baseline.acceptanceIds,
      } : undefined,
    });
    if (!governed.ok) return { ok: false, valid: false, code: "receipt-invalid", error: governed.error };
    return { ok: true, valid: true, decision: governed.decision, mappedItemIds: governed.mappedItemIds };
  }
  return {
    ok: false,
    valid: false,
    code: "receipt-invalid",
    error: "Legacy plan coverage remains visible but cannot satisfy governed implementation; schema version 2 is required.",
  };
}

export type RecordPlanBacklogCoverageResult =
  | {
      ok: true;
      receiptId: string;
      decision: PlanBacklogCoverageDecision;
      mappedItemIds: string[];
    }
  | ({ ok: false; code: "backlog-item-not-found"; error: string } & Record<string, unknown>)
  | ({ ok: false; code: "plan-artifact-invalid"; error: string } & Record<string, unknown>)
  | Extract<PlanBacklogCoverageReceiptValidation, { ok: false }>;

export async function recordPlanBacklogCoverage(args: {
  itemId: string;
  planPath: string;
  planArtifactRef: Extract<InitiativeArtifactRef, { kind: "repo-blob-at-commit" }>;
  decision: PlanBacklogCoverageDecision;
  rationale?: string;
  deliverables: PlanBacklogDeliverableV2[];
  userId: string;
  agentId?: string | null;
  db?: PlanBacklogCoverageDb;
  now?: () => Date;
  resolveArtifact?: typeof resolveRepositoryArtifact;
}): Promise<RecordPlanBacklogCoverageResult> {
  const db = args.db ?? (prisma as unknown as PlanBacklogCoverageDb);
  const parent = await db.backlogItem.findUnique({
    where: { itemId: args.itemId },
    select: { id: true, itemId: true, effortSize: true, type: true, source: true, workType: true, scopeKind: true },
  });
  if (!parent) {
    return {
      ok: false,
      code: "backlog-item-not-found",
      error: `BacklogItem ${args.itemId} was not found.`,
    };
  }
  if (!isCanonicalPlanPath(args.planPath) || args.planArtifactRef.path !== args.planPath) {
    return { ok: false, code: "plan-artifact-invalid", error: "Plan artifact must be a canonical docs/superpowers/plans/*.md path." };
  }
  if (!db.$transaction) {
    return { ok: false, code: "plan-artifact-invalid", error: "Serializable plan coverage persistence is unavailable." };
  }

  // Provider I/O is immutable and may exceed the interactive transaction
  // budget. Resolve it before opening the serializable transaction; mutable
  // Workroom/head identity is revalidated under lock below.
  const resolvedPlan = await (args.resolveArtifact ?? resolveRepositoryArtifact)({
    locator: args.planArtifactRef,
    subject: { kind: "backlog-item", id: parent.itemId },
  });
  if (!resolvedPlan.ok) {
    return { ok: false, code: "plan-artifact-invalid", error: resolvedPlan.error };
  }

  return db.$transaction(async (tx) => {
    if (!tx.$queryRaw) {
      return { ok: false as const, code: "plan-artifact-invalid" as const, error: "Plan coverage lock support is unavailable." };
    }
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "BacklogItem" WHERE "id" = ${parent.id} FOR UPDATE
    `;
    if (locked.length !== 1) {
      return { ok: false as const, code: "backlog-item-not-found" as const, error: `BacklogItem ${args.itemId} was not found.` };
    }
    const currentParent = await tx.backlogItem.findUnique({
      where: { itemId: args.itemId },
      select: { id: true, itemId: true, effortSize: true, type: true, source: true, workType: true, scopeKind: true },
    });
    if (!currentParent || currentParent.id !== parent.id) {
      return { ok: false as const, code: "backlog-item-not-found" as const, error: `BacklogItem ${args.itemId} was not found.` };
    }
    const matchingHeads = await tx.$queryRaw<Array<{ id: string; createdByPrincipalId: string | null }>>`
      SELECT "id", "createdByPrincipalId" FROM "WorkCapsule"
      WHERE "backlogItemId" = ${currentParent.itemId}
        AND "repositoryFullName" = ${args.planArtifactRef.repositoryFullName}
        AND "headSha" = ${args.planArtifactRef.commitSha}
        AND "archivedAt" IS NULL
        AND "status" NOT IN ('abandoned', 'cancelled')
      FOR SHARE
    `;
    if (
      matchingHeads.length !== 1
      || matchingHeads[0]?.createdByPrincipalId !== resolvedPlan.artifact.authorPrincipalId
    ) {
      return {
        ok: false as const,
        code: "plan-artifact-invalid" as const,
        error: "The immutable plan commit and author no longer match exactly one live governed Workroom head.",
      };
    }
    const requestedIds = Array.from(new Set(
      args.deliverables.map((deliverable) => deliverable.backlogItemId).filter((id): id is string => Boolean(id)),
    ));
    const mappedBacklogItems = requestedIds.length
      ? await tx.backlogItem.findMany({
          where: { itemId: { in: requestedIds } },
          select: { itemId: true, status: true, workType: true },
        })
      : [];
    const baseline = projectCurrentScopeBaselineTraceability(await tx.backlogItemActivity.findMany({
      where: { backlogItemId: currentParent.id, kind: "initiative_scope_baseline" },
      orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
      select: { payload: true },
    }));
    if (!baseline) {
      const { recovery, instruction } = projectMissingBaselineRecovery({
        item: currentParent,
        mappedItems: mappedBacklogItems,
      });
      // The remediation text names the CONDITION, never a blocker id. It used
      // to instruct callers to "cite BI-B9403248 for the blocked receipt";
      // that BI closed on 2026-08-21 (PR #4422) while the block stayed live,
      // so every contributor who followed the message literally blamed a
      // fixed defect for a live gate, and every auditor who checked the id
      // found it closed and concluded the block was stale (BI-38A353B2). An
      // id written as a literal goes stale silently; a condition does not.
      return {
        ok: false as const,
        code: "traceability-incomplete" as const,
        error: `BacklogItem ${currentParent.itemId} has no initiative scope baseline, so plan coverage cannot be bound to a governed scope. `
          + instruction + " "
          + "Until this item carries a baseline, record the plan's coverage table in the plan itself and state the blocking CONDITION — \"no initiative scope baseline exists for <item>\" — rather than citing a backlog id, which goes stale when that id closes.",
        recovery,
      };
    }
    const receipt: PlanBacklogCoverageReceipt = {
      schemaVersion: 2,
      planPath: args.planPath,
      planArtifactRef: args.planArtifactRef,
      planArtifactDigest: resolvedPlan.artifact.digest,
      scopeBaselineId: baseline.baselineId,
      scopeBaselineArtifactDigest: baseline.artifactDigest,
      decision: args.decision,
      rationale: args.rationale,
      deliverables: args.deliverables,
    };
    const validation = validatePlanBacklogCoverageReceipt({
      receipt,
      mappedBacklogItems,
      requireGovernedImplementation: true,
      currentPlanDigest: resolvedPlan.artifact.digest,
      traceabilityContext: {
        planText: Buffer.from(resolvedPlan.artifact.bytes).toString("utf8"),
        baselineId: baseline.baselineId,
        baselineArtifactDigest: baseline.artifactDigest,
        objectiveIds: baseline.objectiveIds,
        acceptanceIds: baseline.acceptanceIds,
      },
    });
    if (!validation.ok) return validation;

    const recordedAt = (args.now ?? (() => new Date()))().toISOString();
    const activity = await tx.backlogItemActivity.create({
      data: {
        backlogItemId: currentParent.id,
        kind: "plan_backlog_coverage",
        summary: validation.decision === "atomic"
          ? "Plan coverage accepted as atomic with operator rationale."
          : `Plan coverage validated across ${validation.mappedItemIds.length} live BacklogItem(s).`,
        payload: {
          ...receipt,
          rationale: args.rationale?.trim() || null,
          mappedItemIds: validation.mappedItemIds,
          recordedAt,
        },
        recordedById: args.userId,
        recordedByAgentId: args.agentId ?? null,
      },
    });
    return {
      ok: true as const,
      receiptId: activity.id,
      decision: validation.decision,
      mappedItemIds: validation.mappedItemIds,
    };
  }, { isolationLevel: "Serializable" });
}
