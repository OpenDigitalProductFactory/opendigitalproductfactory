// EP-REMOTE-ACTION · P2 slice 2 — the pull-channel orchestrators (DB-injected).
//
// Spec: docs/superpowers/specs/2026-06-25-convergent-remote-action-execution-design.md.
// Threat model: docs/superpowers/specs/2026-06-25-remote-action-edge-dispatch-threat-model.md.
//
// The channel is PULL: a trusted, action.execute-enabled Edge Node POLLS for the
// queued read-only RemoteActions in its own estate scope (claimActionsForNode), runs
// them, and reports the outcome (recordActionResult). Single-claim is enforced by the
// queued→claimed transition + edgeNodeId binding — a second node racing the same
// action loses the conditional update. The pure eligibility gate lives in
// @dpf/db/remote-action-dispatch; this wraps it with the DB writes.
//
// Nothing here runs until the route layer's DPF_REMOTE_ACTION_DISPATCH_ENABLED flag
// AND the node's action.execute capability are both on. No mutation: P2 is read-only.

import {
  canTransitionDispatch,
  claimableActionsForNode,
  type ClaimingNodeView,
  type DispatchableActionView,
  type RemoteActionDispatchState,
} from "@dpf/db/remote-action-dispatch";

const MAX_CLAIM_BATCH = 25;

export interface ClaimableActionRow {
  actionKey: string;
  actionType: string;
  riskClass: string;
  approvalState: string;
  status: string;
  customerAccountId: string | null;
  customerSiteId: string | null;
  edgeNodeId: string | null;
  parameters: unknown;
}

export interface DispatchOrchestratorDb {
  remoteAction: {
    findMany(args: unknown): Promise<ClaimableActionRow[]>;
    updateMany(args: unknown): Promise<{ count: number }>;
    findUnique(args: unknown): Promise<{ actionKey: string; status: string; edgeNodeId: string | null } | null>;
    update(args: unknown): Promise<unknown>;
  };
}

export interface ClaimedAction {
  actionKey: string;
  actionType: string;
  parameters: unknown;
}

export interface ClaimResult {
  claimed: ClaimedAction[];
  /** Eligible-but-lost-the-race (claimed by another node between read and write). */
  skipped: number;
}

/**
 * Pull + atomically claim the read-only RemoteActions this node may run. The DB
 * query is a coarse scope filter; `claimableActionsForNode` is the precise gate
 * (read-only allow-list, exact scope, trust, capability). The claim itself is a
 * guarded conditional update — only an action STILL `queued` flips to `claimed`,
 * so concurrent pollers can't double-claim.
 */
export async function claimActionsForNode(
  db: DispatchOrchestratorDb,
  node: ClaimingNodeView,
  opts: { limit?: number; now?: Date } = {},
): Promise<ClaimResult> {
  // Belt-and-suspenders: the route already auth-gates trust + capability, but a
  // disabled/untrusted node claims nothing here either.
  if (node.trustState !== "trusted" || !node.actionExecuteEnabled) {
    return { claimed: [], skipped: 0 };
  }
  const take = Math.min(Math.max(1, opts.limit ?? MAX_CLAIM_BATCH), MAX_CLAIM_BATCH);
  const candidates = await db.remoteAction.findMany({
    where: {
      status: "queued",
      approvalState: "approved",
      riskClass: "read-only",
      customerAccountId: node.customerAccountId, // null matches the internal estate
    },
    take,
  });

  const views: DispatchableActionView[] = candidates.map((c) => ({
    actionKey: c.actionKey,
    actionType: c.actionType,
    riskClass: c.riskClass,
    approvalState: c.approvalState,
    status: c.status,
    customerAccountId: c.customerAccountId,
    customerSiteId: c.customerSiteId,
    edgeNodeId: c.edgeNodeId,
  }));
  const eligible = claimableActionsForNode(node, views);

  const now = opts.now ?? new Date();
  const claimed: ClaimedAction[] = [];
  for (const e of eligible) {
    // Single-claim guard: only an action still `queued` is claimable; the first
    // updater wins (count 1), a racing poller sees count 0.
    const res = await db.remoteAction.updateMany({
      where: { actionKey: e.actionKey, status: "queued" },
      data: { status: "claimed", edgeNodeId: node.edgeNodeId, startedAt: now },
    });
    if (res.count === 1) {
      const row = candidates.find((c) => c.actionKey === e.actionKey);
      claimed.push({ actionKey: e.actionKey, actionType: e.actionType, parameters: row?.parameters ?? {} });
    }
  }
  return { claimed, skipped: eligible.length - claimed.length };
}

export interface ActionResultInput {
  actionKey: string;
  /** The reporting node (EdgeNode.id from auth) — must own the claim. */
  edgeNodeRowId: string;
  outcome: "running" | "succeeded" | "failed";
  evidence?: Record<string, unknown>;
}

export type ActionResultResult =
  | { ok: true; status: RemoteActionDispatchState }
  | { ok: false; reason: string };

/**
 * Record a node's report for an action it claimed. Verifies the action exists,
 * is bound to THIS node (claim ownership — a node cannot report another's
 * action), and that the lifecycle transition is legal. Terminal outcomes stamp
 * completedAt + evidence; the node's id is recorded on the evidence so a lying
 * node is attributable.
 */
export async function recordActionResult(
  db: DispatchOrchestratorDb,
  input: ActionResultInput,
  opts: { now?: Date } = {},
): Promise<ActionResultResult> {
  const row = await db.remoteAction.findUnique({ where: { actionKey: input.actionKey } });
  if (!row) return { ok: false, reason: "action-not-found" };
  if (row.edgeNodeId !== input.edgeNodeRowId) return { ok: false, reason: "not-claimed-by-this-node" };

  const from = row.status as RemoteActionDispatchState;
  const to = input.outcome as RemoteActionDispatchState;
  if (!canTransitionDispatch(from, to)) {
    return { ok: false, reason: `illegal-transition ${from}->${to}` };
  }

  const now = opts.now ?? new Date();
  const terminal = to === "succeeded" || to === "failed";
  await db.remoteAction.update({
    where: { actionKey: input.actionKey },
    data: {
      status: to,
      ...(terminal ? { completedAt: now } : {}),
      ...(terminal
        ? {
            result: { outcome: to } as never,
            evidence: { ...(input.evidence ?? {}), reportedByNode: input.edgeNodeRowId, reportedAt: now.toISOString() } as never,
          }
        : {}),
    },
  });
  return { ok: true, status: to };
}
