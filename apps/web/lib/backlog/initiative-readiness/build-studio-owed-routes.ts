import { prisma } from "@dpf/db";

import { resolveRepoIdentity } from "@/lib/contributor-change-lanes/github-rest-reader";
import {
  resolveInitiativeReviewerRecovery,
  type InitiativeReviewerRecovery,
} from "@/lib/tak/initiative-readiness-tool-grants";

import {
  resolveBuildStudioDispatchContext,
  type BuildStudioDispatchResolution,
} from "./build-studio-dispatch-context";
import { designPhaseReviewDecision } from "./design-phase-recovery";
import { currentBaseline, parseBaselinePayloads } from "./terminal-recovery";
import type { InitiativeReadinessDecision } from "./types";

// BI-926A7E90 PR-3 — the independent reviews a Build Studio build in plan owes.
//
// The dispatcher's awaiting-acceptance path asks the terminal recovery for the
// completion decision's routes. A Build Studio build is refused at plan→build
// by its IMPLEMENTATION decision, and the terminal recovery cannot serve it: it
// needs a live room head and discovers the design from a branch compare, and a
// Build Studio room has neither. This module routes the design-phase gates of
// the implementation decision directly through the reviewer recovery, with the
// dispatch context and the revision-bound canonical artifact PR-2 derives.
//
// Ports are injected so the routing is unit-tested without the install.

export const BUILD_STUDIO_ASSISTANT_AGENT_ID = "AGT-WS-BUILD";

export type BuildStudioOwedRoutesPorts = {
  loadImplementationDecision(itemId: string, agentId: string): Promise<InitiativeReadinessDecision | null>;
  resolveDispatch(capsuleId: string): Promise<BuildStudioDispatchResolution>;
  loadCurrentBaselineId(itemId: string): Promise<string | null>;
  resolveRecovery(args: Parameters<typeof resolveInitiativeReviewerRecovery>[0]): Promise<InitiativeReviewerRecovery>;
};

export type BuildStudioOwedRoutesResult =
  | { ok: true; routes: Array<{ workroomId: string; requestCoworker: Record<string, unknown> }> }
  | { ok: false; reason: string };

async function defaultLoadImplementationDecision(itemId: string, agentId: string): Promise<InitiativeReadinessDecision | null> {
  const { getBacklogItem } = await import("@/lib/mcp/packs/backlog-pack-read-tools");
  const item = await getBacklogItem({ itemId }, agentId);
  const decision = (item.data?.readiness as { decisions?: { implementation?: unknown } } | undefined)?.decisions?.implementation;
  return item.success && decision ? decision as InitiativeReadinessDecision : null;
}

async function defaultLoadCurrentBaselineId(itemId: string): Promise<string | null> {
  const item = await prisma.backlogItem.findUnique({ where: { itemId }, select: { id: true } });
  if (!item) return null;
  const rows = await prisma.backlogItemActivity.findMany({
    where: { backlogItemId: item.id, kind: "initiative_scope_baseline" },
    orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
    select: { payload: true },
  });
  const parsed = parseBaselinePayloads(rows.map((row) => row.payload));
  return parsed ? currentBaseline(parsed)?.baselineId ?? null : null;
}

export const DEFAULT_BUILD_STUDIO_OWED_ROUTES_PORTS: BuildStudioOwedRoutesPorts = {
  loadImplementationDecision: defaultLoadImplementationDecision,
  resolveDispatch: (capsuleId) => resolveBuildStudioDispatchContext({
    db: prisma as never,
    capsuleId,
    canonicalRepositoryFullName: async () => {
      const repo = await resolveRepoIdentity(prisma);
      return `${repo.owner}/${repo.name}`;
    },
  }),
  loadCurrentBaselineId: defaultLoadCurrentBaselineId,
  resolveRecovery: (args) => resolveInitiativeReviewerRecovery({ ...args, db: prisma as never }),
};

/**
 * The independent design-phase reviews a Build Studio build in plan owes right
 * now, as server-issued `request_coworker` packets bound to its design revision.
 * Empty when the implementation decision is allowed or owes no design review;
 * a typed reason when the room cannot be resolved into a dispatch context.
 */
export async function buildStudioOwedRoutes(args: {
  itemId: string;
  capsuleId: string;
  authorAgentId: string;
  ports?: BuildStudioOwedRoutesPorts;
}): Promise<BuildStudioOwedRoutesResult> {
  const ports = args.ports ?? DEFAULT_BUILD_STUDIO_OWED_ROUTES_PORTS;
  const decision = await ports.loadImplementationDecision(args.itemId, args.authorAgentId);
  if (!decision) return { ok: false, reason: "implementation-decision-unavailable" };
  if (decision.verdict === "allowed") return { ok: true, routes: [] };
  const designPhase = designPhaseReviewDecision(decision);
  if (!designPhase) return { ok: true, routes: [] };
  const dispatch = await ports.resolveDispatch(args.capsuleId);
  if (!dispatch.available) return { ok: false, reason: dispatch.reason };
  const recovery = await ports.resolveRecovery({
    decision: designPhase,
    currentAgentId: args.authorAgentId,
    db: prisma as never,
    dispatchContext: dispatch.dispatchContext,
    canonicalArtifact: dispatch.canonicalArtifact,
    planArtifact: dispatch.planArtifact ?? undefined,
    expectedCurrentBaselineId: await ports.loadCurrentBaselineId(args.itemId),
  });
  return {
    ok: true,
    routes: recovery.reviewerRoutes
      .filter((route) => route.independent)
      .map((route) => ({ workroomId: route.workroomId, requestCoworker: route.requestCoworker as unknown as Record<string, unknown> })),
  };
}
