/**
 * Read models for the area Work view (EP-B70E718D F4 BI-C5CD9EAE, F5 BI-0FB4A049). Server only.
 *
 * - Portfolio flow: the five measures for every portfolio, plus the points
 *   cost from the investment read model.
 * - Shape flow: one shape version drawn across every room on it, the versions
 *   that have data (for before/after), and the rooms at a chosen step.
 *
 * Both read the stage telemetry F2 writes and the rooms' drive snapshots; no
 * second store.
 */
import { prisma } from "@dpf/db";

import { encodeWorkCaseKey } from "@/lib/work-management/case-key";
import { loadPortfolioInvestment } from "@/lib/portfolio/investment-read-model";
import { PORTFOLIO_SLUG_BY_ROLE, type PortfolioRoleKey } from "@/lib/portfolio/portfolio-role";
import type { QueueTelemetryRow } from "@/lib/queue/queue-metrics-rollup";

import { computePortfolioFlow, FLOW_WINDOW_DAYS, type PortfolioFlow } from "./portfolio-flow";
import { loadRoomAiSpend } from "./room-ai-spend.server";
import { TERMINAL_WORKROOM_STATUSES } from "./standing-room-nesting";
import { getWorkShape, getWorkShapeVersion } from "./work-shapes";
import { readWorkShapeClaimRef } from "./workroom-shape-claim";
import { buildShapeFlowMap, type WorkroomFlowMapModel } from "./workroom-flow-map";
import { classifyDriveSegment, type WorkroomFlowState } from "./workroom-flow-state";
import {
  holdCauseTag,
  WORKROOM_STAGE_ITEM_KIND,
  WORKROOM_STAGE_QUEUE_PREFIX,
  readDriveObservation,
  workroomStageLiveCounts,
} from "./workroom-stage-telemetry";

const DAY_MS = 24 * 60 * 60 * 1000;

export type PortfolioFlowWithCost = PortfolioFlow & {
  /** Points from the quarter's investment read model; null for the unplaced bucket. */
  points: { inFlight: number; delivered: number } | null;
  /** AI spend on this bucket's rooms over the flow window (F6, exact by thread). Null when the read failed. */
  aiUsd: number | null;
};

const ROW_SELECT = { queueKey: true, itemKind: true, itemId: true, transition: true, outcome: true, occurredAt: true, laneKey: true } as const;

async function loadRooms() {
  const rows = await prisma.workroom.findMany({
    where: { archivedAt: null },
    select: { capsuleId: true, title: true, status: true, portfolioRole: true, scopeClaims: true, workspaceState: true },
  });
  return rows.map((row) => {
    const live = !TERMINAL_WORKROOM_STATUSES.has(row.status);
    return {
      capsuleId: row.capsuleId,
      title: row.title,
      portfolioRole: row.portfolioRole as string | null,
      shapeRef: readWorkShapeClaimRef(row.scopeClaims),
      // A finished room still owns its history, but is never "in flow" now.
      current: live ? readDriveObservation(row.workspaceState) : null,
      scopeClaims: row.scopeClaims,
      workspaceState: live ? row.workspaceState : null,
    };
  });
}

export async function loadPortfolioFlowView(now: Date = new Date()): Promise<PortfolioFlowWithCost[]> {
  const [rooms, rows, investment, portfolios, aiByRoom] = await Promise.all([
    loadRooms(),
    prisma.queueTelemetryEvent.findMany({
      where: { itemKind: WORKROOM_STAGE_ITEM_KIND, occurredAt: { gte: new Date(now.getTime() - 2 * FLOW_WINDOW_DAYS * DAY_MS) } },
      select: ROW_SELECT,
    }) as Promise<QueueTelemetryRow[]>,
    loadPortfolioInvestment(prisma as never, now).catch(() => null),
    prisma.portfolio.findMany({ select: { id: true, slug: true } }),
    loadRoomAiSpend({ since: new Date(now.getTime() - FLOW_WINDOW_DAYS * DAY_MS), until: now }).catch(() => null),
  ]);
  const flows = computePortfolioFlow({ rooms, rows, now });
  const aiByBucket = new Map<string, number>();
  if (aiByRoom) {
    for (const room of rooms) {
      const usd = aiByRoom.get(room.capsuleId);
      if (!usd) continue;
      const bucket = room.portfolioRole && flows.some((f) => f.key === room.portfolioRole) ? room.portfolioRole : "unplaced";
      aiByBucket.set(bucket, (aiByBucket.get(bucket) ?? 0) + usd);
    }
  }
  const aiUsdFor = (key: string) => (aiByRoom ? aiByBucket.get(key) ?? 0 : null);
  const slugById = new Map(portfolios.map((p) => [p.id, p.slug]));
  return flows.map((flow) => {
    if (flow.key === "unplaced" || !investment) return { ...flow, points: null, aiUsd: aiUsdFor(flow.key) };
    const slug = PORTFOLIO_SLUG_BY_ROLE[flow.key as PortfolioRoleKey];
    const row = investment.rows.find((candidate) => candidate.portfolioId && slugById.get(candidate.portfolioId) === slug);
    return { ...flow, points: row ? { inFlight: row.inFlightPoints, delivered: row.deliveredPoints } : { inFlight: 0, delivered: 0 }, aiUsd: aiUsdFor(flow.key) };
  });
}

export type ShapeRoomAtStep = { capsuleId: string; title: string; href: string; state: WorkroomFlowState; cause: string | null };

export type ShapeFlowView = {
  model: WorkroomFlowMapModel;
  /** Versions of this shape with stage data, newest first, for before/after. */
  versions: string[];
  roomsAtStep: ShapeRoomAtStep[] | null;
};

export async function loadShapeFlowView(input: {
  shapeKey: string;
  version?: string | null;
  portfolioRole?: string | null;
  stageKey?: string | null;
  now?: Date;
}): Promise<ShapeFlowView | null> {
  const now = input.now ?? new Date();
  const current = getWorkShape(input.shapeKey);
  const definition = input.version ? getWorkShapeVersion(input.shapeKey, input.version) : current;
  if (!definition) return null;
  const shapeRef = `${definition.key}@${definition.version}`;

  const [rooms, snapshots, keyed] = await Promise.all([
    loadRooms(),
    prisma.queueMetricSnapshot.findMany({
      where: {
        queueKey: { startsWith: `${WORKROOM_STAGE_QUEUE_PREFIX}${shapeRef}:` },
        period: { gte: new Date(now.getTime() - FLOW_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10) },
      },
      select: { queueKey: true, cycleP50Ms: true, throughput: true },
    }),
    prisma.queueMetricSnapshot.findMany({
      where: { queueKey: { startsWith: `${WORKROOM_STAGE_QUEUE_PREFIX}${definition.key}@` } },
      select: { queueKey: true },
      distinct: ["queueKey"],
    }),
  ]);

  const inScope = rooms.filter((room) =>
    room.shapeRef === shapeRef && (!input.portfolioRole || room.portfolioRole === input.portfolioRole));
  const liveCounts = workroomStageLiveCounts(inScope.map((room) => ({ scopeClaims: room.scopeClaims, workspaceState: room.workspaceState })));
  const model = buildShapeFlowMap({ definition, snapshots, liveCounts, now });

  const versions = [...new Set([
    ...(current ? [current.version] : []),
    ...keyed.map((row) => row.queueKey.slice(WORKROOM_STAGE_QUEUE_PREFIX.length).split(":")[0]!.split("@")[1]!),
  ])].filter(Boolean).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

  const roomsAtStep = input.stageKey
    ? inScope.flatMap((room): ShapeRoomAtStep[] => {
        const obs = room.current;
        if (!obs?.action || !obs.reason || obs.stageKey !== input.stageKey) return [];
        const classified = classifyDriveSegment({ action: obs.action, reason: obs.reason });
        if (!classified || classified.state === "done" || classified.state === "awaiting-trigger") return [];
        return [{
          capsuleId: room.capsuleId,
          title: room.title,
          href: `/workspace/cases/${encodeWorkCaseKey({ sourceType: "work-capsule", sourceId: room.capsuleId })}`,
          state: classified.state,
          cause: classified.state === "blocked" ? holdCauseTag(classified.cause, obs.detail) : classified.cause,
        }];
      })
    : null;

  return { model, versions, roomsAtStep };
}
