import { prisma } from "@dpf/db";

import {
  resolveInitiativeReviewerRecovery,
  type InitiativeReviewerRecovery,
} from "@/lib/tak/initiative-readiness-tool-grants";
import { loadCapsuleLivenessInventory } from "@/lib/work-capsules/liveness-inventory";

import { validateInitiativeBaselineChainHead } from "./baseline-repository";
import { discoverCanonicalDesignArtifact } from "./canonical-artifact-discovery";
import type { InitiativeReadinessDecision } from "./types";

export type TerminalRecoveryRoom = {
  capsuleId: string;
  backlogItemId: string | null;
  repositoryFullName: string | null;
  baseSha: string | null;
  headBranch: string | null;
  headSha: string | null;
  isLive: boolean;
};

export type TerminalRecoveryEscalationReason =
  | "workroom-not-found"
  | "workroom-ambiguous"
  | "workroom-identity-incomplete"
  | "baseline-not-found"
  | "baseline-ambiguous"
  | "canonical-artifact-unavailable";

type TerminalEscalation = {
  accountableRole: "acceptance-reviewer";
  toolName: "record_initiative_evidence";
  grant: "initiative_evidence_write";
  reason: TerminalRecoveryEscalationReason;
  nextAction: string;
};

export type TerminalInitiativeRecovery = Omit<InitiativeReviewerRecovery, "escalations"> & {
  escalations: Array<InitiativeReviewerRecovery["escalations"][number] | TerminalEscalation>;
};

type BaselinePayload = {
  baselineId: string;
  supersedesBaselineId: string | null;
  artifactRef?: {
    kind: "repo-blob-at-commit";
    repositoryFullName: string;
    path: string;
    providerBlobId: string;
  };
};

export type TerminalRecoveryPorts = {
  loadLiveRooms(args: { itemId: string; refusedWorkroomId: string | null }): Promise<TerminalRecoveryRoom[]>;
  loadBaselinePayloads(itemId: string): Promise<unknown[]>;
  discoverArtifact(args: {
    repositoryFullName: string;
    baseSha: string;
    headSha: string;
  }): Promise<Awaited<ReturnType<typeof discoverCanonicalDesignArtifact>>>;
  resolveRecovery(args: Parameters<typeof resolveInitiativeReviewerRecovery>[0]): Promise<InitiativeReviewerRecovery>;
};

function escalation(reason: TerminalRecoveryEscalationReason, nextAction: string): TerminalInitiativeRecovery {
  return {
    reviewerRoutes: [],
    unroutable: [],
    escalations: [{
      accountableRole: "acceptance-reviewer",
      toolName: "record_initiative_evidence",
      grant: "initiative_evidence_write",
      reason,
      nextAction,
    }],
  };
}

function parseBaselinePayloads(payloads: unknown[]): BaselinePayload[] | null {
  const rows: BaselinePayload[] = [];
  for (const payload of payloads) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const row = payload as Record<string, unknown>;
    if (typeof row.baselineId !== "string"
      || (row.supersedesBaselineId !== null && typeof row.supersedesBaselineId !== "string")) return null;
    const ref = row.artifactRef;
    const artifactRef = ref && typeof ref === "object" && !Array.isArray(ref)
      && (ref as Record<string, unknown>).kind === "repo-blob-at-commit"
      && typeof (ref as Record<string, unknown>).repositoryFullName === "string"
      && typeof (ref as Record<string, unknown>).path === "string"
      && typeof (ref as Record<string, unknown>).providerBlobId === "string"
      ? {
        kind: "repo-blob-at-commit" as const,
        repositoryFullName: (ref as Record<string, unknown>).repositoryFullName as string,
        path: (ref as Record<string, unknown>).path as string,
        providerBlobId: (ref as Record<string, unknown>).providerBlobId as string,
      }
      : undefined;
    rows.push({
      baselineId: row.baselineId,
      supersedesBaselineId: row.supersedesBaselineId as string | null,
      ...(artifactRef ? { artifactRef } : {}),
    });
  }
  return rows;
}

function currentBaseline(rows: BaselinePayload[]): BaselinePayload | null {
  const superseded = new Set(rows.map((row) => row.supersedesBaselineId).filter((id): id is string => Boolean(id)));
  const heads = rows.filter((row) => !superseded.has(row.baselineId));
  if (heads.length !== 1) return null;
  const expected = heads[0]!.baselineId;
  const validation = validateInitiativeBaselineChainHead(rows, expected);
  return validation.ok ? heads[0]! : null;
}

async function defaultLoadLiveRooms(args: {
  itemId: string;
  refusedWorkroomId: string | null;
}): Promise<TerminalRecoveryRoom[]> {
  const inventory = await loadCapsuleLivenessInventory(prisma as never, {
    where: {
      backlogItemId: args.itemId,
      archivedAt: null,
      ...(args.refusedWorkroomId ? { capsuleId: args.refusedWorkroomId } : {}),
    },
    take: args.refusedWorkroomId ? 2 : 3,
  });
  const liveIds = inventory.capsulesAll
    .filter((row) => row.isLive === true)
    .map((row) => row.capsuleId as string);
  if (liveIds.length === 0) return [];
  const rows = await prisma.workroom.findMany({
    where: { capsuleId: { in: liveIds } },
    select: {
      capsuleId: true,
      backlogItemId: true,
      repositoryFullName: true,
      baseSha: true,
      headBranch: true,
      headSha: true,
    },
  });
  return rows.map((row) => ({ ...row, isLive: true }));
}

async function defaultLoadBaselinePayloads(itemId: string): Promise<unknown[]> {
  const item = await prisma.backlogItem.findFirst({
    where: { OR: [{ itemId }, { id: itemId }] },
    select: { id: true },
  });
  if (!item) return [];
  const rows = await prisma.backlogItemActivity.findMany({
    where: { backlogItemId: item.id, kind: "initiative_scope_baseline" },
    orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
    select: { payload: true },
  });
  return rows.map((row) => row.payload);
}

const DEFAULT_PORTS: TerminalRecoveryPorts = {
  loadLiveRooms: defaultLoadLiveRooms,
  loadBaselinePayloads: defaultLoadBaselinePayloads,
  discoverArtifact: discoverCanonicalDesignArtifact,
  resolveRecovery: (args) => resolveInitiativeReviewerRecovery({ ...args, db: prisma as never }),
};

/** Build an exact, executable reviewer handoff after — and only after — denial. */
export async function resolveTerminalInitiativeRecovery(args: {
  decision: InitiativeReadinessDecision;
  currentAgentId: string | null;
  refusedWorkroomId: string | null;
  ports?: TerminalRecoveryPorts;
}): Promise<TerminalInitiativeRecovery> {
  const ports = args.ports ?? DEFAULT_PORTS;
  const rooms = await ports.loadLiveRooms({
    itemId: args.decision.subject.id,
    refusedWorkroomId: args.refusedWorkroomId,
  });
  if (rooms.length === 0) {
    return escalation("workroom-not-found", "No live Workroom is bound to this item. Claim or resume the exact Workroom, then retry completion.");
  }
  if (rooms.length !== 1) {
    return escalation("workroom-ambiguous", "More than one live Workroom is bound to this item. Reconcile ownership before dispatching an acceptance reviewer.");
  }
  const room = rooms[0]!;
  if (!room.repositoryFullName || !room.baseSha || !room.headBranch || !room.headSha) {
    return escalation("workroom-identity-incomplete", "The Workroom lacks repository, branch, immutable base, or immutable head. Re-sync it with adopt_worktree, then retry.");
  }

  const payloads = await ports.loadBaselinePayloads(args.decision.subject.id);
  if (payloads.length === 0) {
    return escalation("baseline-not-found", "No current objective baseline exists. Complete independent spec approval before acceptance mapping.");
  }
  const baselineRows = parseBaselinePayloads(payloads);
  const baseline = baselineRows ? currentBaseline(baselineRows) : null;
  if (!baseline) {
    return escalation("baseline-ambiguous", "The objective baseline chain has no unique valid head. Reconcile or supersede the conflicting baseline before dispatch.");
  }

  const baselineArtifact = baseline.artifactRef?.repositoryFullName.toLocaleLowerCase("en-US")
      === room.repositoryFullName.toLocaleLowerCase("en-US")
    ? { path: baseline.artifactRef.path, providerBlobId: baseline.artifactRef.providerBlobId }
    : null;
  const discovered = baselineArtifact ? null : await ports.discoverArtifact({
      repositoryFullName: room.repositoryFullName,
      baseSha: room.baseSha,
      headSha: room.headSha,
    });
  if (discovered && !discovered.resolved) {
    return escalation("canonical-artifact-unavailable", discovered.nextAction);
  }
  const artifact = baselineArtifact ?? (discovered?.resolved ? discovered.artifact : null);
  if (!artifact) {
    return escalation("canonical-artifact-unavailable", "The current baseline has no provider-verified canonical source binding.");
  }

  return ports.resolveRecovery({
    decision: args.decision,
    currentAgentId: args.currentAgentId,
    db: prisma as never,
    dispatchContext: {
      workroomId: room.capsuleId,
      repositoryFullName: room.repositoryFullName,
      branchName: room.headBranch,
      headSha: room.headSha,
    },
    canonicalArtifact: { resolved: true, ...artifact },
    expectedCurrentBaselineId: baseline.baselineId,
  });
}
