import { prisma } from "@dpf/db";

export type PlanBacklogCoverageDecision = "decomposed" | "atomic";

export type PlanBacklogDeliverable = {
  key: string;
  title: string;
  independentlyShippable: boolean;
  backlogItemId?: string;
  dependsOn?: string[];
};

type MappedBacklogItem = { itemId: string; status: string };

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

export type PlanBacklogCoverageDb = {
  backlogItem: {
    findUnique: (args: {
      where: { itemId: string };
      select: { id: true; itemId: true; effortSize: true };
    }) => Promise<{ id: string; itemId: string; effortSize: string | null } | null>;
    findMany: (args: {
      where: { itemId: { in: string[] } };
      select: { itemId: true; status: true };
    }) => Promise<MappedBacklogItem[]>;
  };
  backlogItemActivity: {
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
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
  workCapsule: {
    findFirst: (args: Record<string, unknown>) => Promise<{ backlogItemId: string | null } | null>;
  };
  backlogItem: PlanBacklogCoverageDb["backlogItem"];
  backlogItemActivity: {
    findFirst: (args: Record<string, unknown>) => Promise<{ id: string; payload: unknown } | null>;
  };
};

export async function checkBranchPlanBacklogGate(args: {
  branchName: string;
  db?: BranchPlanBacklogGateDb;
}): Promise<
  | { ok: true; required: false; itemId?: string }
  | { ok: true; required: true; itemId: string; receiptId: string; decision: PlanBacklogCoverageDecision }
  | { ok: false; required: true; code: "decomposition-decision-required" | "receipt-invalid"; error: string; itemId: string }
> {
  const db: BranchPlanBacklogGateDb = args.db ?? {
    workCapsule: {
      findFirst: prisma.workCapsule.findFirst.bind(prisma.workCapsule) as unknown as BranchPlanBacklogGateDb["workCapsule"]["findFirst"],
    },
    backlogItem: {
      findUnique: prisma.backlogItem.findUnique.bind(prisma.backlogItem) as unknown as BranchPlanBacklogGateDb["backlogItem"]["findUnique"],
      findMany: prisma.backlogItem.findMany.bind(prisma.backlogItem) as unknown as BranchPlanBacklogGateDb["backlogItem"]["findMany"],
    },
    backlogItemActivity: {
      findFirst: prisma.backlogItemActivity.findFirst.bind(prisma.backlogItemActivity) as unknown as BranchPlanBacklogGateDb["backlogItemActivity"]["findFirst"],
    },
  };
  const capsule = await db.workCapsule.findFirst({
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
  const payload = activity.payload as { decision?: unknown; rationale?: unknown; deliverables?: unknown };
  if (
    (payload.decision !== "atomic" && payload.decision !== "decomposed") ||
    !Array.isArray(payload.deliverables)
  ) {
    return { ok: false, required: true, code: "receipt-invalid", error: "Latest coverage receipt is invalid.", itemId: parent.itemId };
  }
  const deliverables = payload.deliverables as PlanBacklogDeliverable[];
  const requestedIds = Array.from(new Set(deliverables.map((d) => d.backlogItemId).filter((id): id is string => Boolean(id))));
  const mappedBacklogItems = requestedIds.length
    ? await db.backlogItem.findMany({ where: { itemId: { in: requestedIds } }, select: { itemId: true, status: true } })
    : [];
  const validation = validatePlanBacklogCoverage({
    effortSize: parent.effortSize,
    decision: payload.decision,
    rationale: typeof payload.rationale === "string" ? payload.rationale : undefined,
    deliverables,
    mappedBacklogItems,
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
}): Promise<CheckPlanBacklogCoverageResult> {
  const db: PlanBacklogCoverageDb = args.db ?? {
    backlogItem: {
      findUnique: prisma.backlogItem.findUnique.bind(prisma.backlogItem) as unknown as PlanBacklogCoverageDb["backlogItem"]["findUnique"],
      findMany: prisma.backlogItem.findMany.bind(prisma.backlogItem) as unknown as PlanBacklogCoverageDb["backlogItem"]["findMany"],
    },
    backlogItemActivity: {
      create: prisma.backlogItemActivity.create.bind(prisma.backlogItemActivity) as unknown as PlanBacklogCoverageDb["backlogItemActivity"]["create"],
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
  const payload = rawPayload as {
    planPath?: unknown;
    decision?: unknown;
    rationale?: unknown;
    deliverables?: unknown;
  } | null;
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
  const validation = validatePlanBacklogCoverage({
    effortSize: parent.effortSize,
    decision: payload.decision,
    rationale: typeof payload.rationale === "string" ? payload.rationale : undefined,
    deliverables,
    mappedBacklogItems,
  });
  if (!validation.ok) return validation;
  return { ok: true, valid: true, decision: validation.decision, mappedItemIds: validation.mappedItemIds };
}

export type RecordPlanBacklogCoverageResult =
  | {
      ok: true;
      receiptId: string;
      decision: PlanBacklogCoverageDecision;
      mappedItemIds: string[];
    }
  | ({ ok: false; code: "backlog-item-not-found"; error: string } & Record<string, unknown>)
  | Extract<PlanBacklogCoverageValidation, { ok: false }>;

export async function recordPlanBacklogCoverage(args: {
  itemId: string;
  planPath: string;
  decision: PlanBacklogCoverageDecision;
  rationale?: string;
  deliverables: PlanBacklogDeliverable[];
  userId: string;
  agentId?: string | null;
  db?: PlanBacklogCoverageDb;
  now?: () => Date;
}): Promise<RecordPlanBacklogCoverageResult> {
  const db: PlanBacklogCoverageDb = args.db ?? {
    backlogItem: {
      findUnique: prisma.backlogItem.findUnique.bind(prisma.backlogItem) as unknown as PlanBacklogCoverageDb["backlogItem"]["findUnique"],
      findMany: prisma.backlogItem.findMany.bind(prisma.backlogItem) as unknown as PlanBacklogCoverageDb["backlogItem"]["findMany"],
    },
    backlogItemActivity: {
      create: prisma.backlogItemActivity.create.bind(prisma.backlogItemActivity) as unknown as PlanBacklogCoverageDb["backlogItemActivity"]["create"],
    },
  };
  const parent = await db.backlogItem.findUnique({
    where: { itemId: args.itemId },
    select: { id: true, itemId: true, effortSize: true },
  });
  if (!parent) {
    return {
      ok: false,
      code: "backlog-item-not-found",
      error: `BacklogItem ${args.itemId} was not found.`,
    };
  }

  const requestedIds = Array.from(
    new Set(
      args.deliverables
        .map((deliverable) => deliverable.backlogItemId)
        .filter((itemId): itemId is string => Boolean(itemId)),
    ),
  );
  const mappedBacklogItems = requestedIds.length
    ? await db.backlogItem.findMany({
        where: { itemId: { in: requestedIds } },
        select: { itemId: true, status: true },
      })
    : [];
  const validation = validatePlanBacklogCoverage({
    effortSize: parent.effortSize,
    decision: args.decision,
    rationale: args.rationale,
    deliverables: args.deliverables,
    mappedBacklogItems,
  });
  if (!validation.ok) return validation;

  const recordedAt = (args.now ?? (() => new Date()))().toISOString();
  const activity = await db.backlogItemActivity.create({
    data: {
      backlogItemId: parent.id,
      kind: "plan_backlog_coverage",
      summary:
        validation.decision === "atomic"
          ? "Plan coverage accepted as atomic with operator rationale."
          : `Plan coverage validated across ${validation.mappedItemIds.length} live BacklogItem(s).`,
      payload: {
        planPath: args.planPath,
        decision: validation.decision,
        rationale: args.rationale?.trim() || null,
        mappedItemIds: validation.mappedItemIds,
        deliverables: args.deliverables,
        recordedAt,
      },
      recordedById: args.userId,
      recordedByAgentId: args.agentId ?? null,
    },
  });

  return {
    ok: true,
    receiptId: activity.id,
    decision: validation.decision,
    mappedItemIds: validation.mappedItemIds,
  };
}
