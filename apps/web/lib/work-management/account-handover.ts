// Hand over an account's live work in one governed approval (BI-F25A5FC7).
//
// An account nobody uses can still own live work: on the live install the
// seeded admin@dpf.local coordinated 187 rooms, had created 127 live builds and
// owned 93 scheduled coworker tasks. Each kept routing approvals and actions to
// an inbox nobody reads, and no screen or tool could re-home more than one room
// at a time (each needing its own fifteen-minute approval).
//
// The handover is two steps:
//   1. plan  - read-only. Every live room the account alone coordinates, every
//              live build it created, every scheduled task it owns, with the
//              new owner of each from the portfolio rule (resolveWorkOwner),
//              plus a digest of exactly that set.
//   2. apply - recomputes the plan, refuses if the digest moved, and re-homes
//              each item: rooms through the one coordinator rule
//              (executeCoordinatorAppointment), builds and tasks by owner field,
//              each with an activity row.
//
// It never assigns the guessed install owner (`fallback`) and never hands work
// back to the account it is leaving. It runs under the approving person's
// authority: the MCP tool is an authority-consequence write, so a person with
// manage_platform approves the exact digest before anything moves.

import { createHash } from "node:crypto";

import type { prisma } from "@dpf/db";

import { resolveWorkOwner, type WorkOwnerSource } from "@/lib/portfolio/accountable-owner";
import { PORTFOLIO_SLUG_BY_ROLE } from "@/lib/portfolio/portfolio-role";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";

import { executeCoordinatorAppointment } from "./execute-coordinator-appointment.server";

type Db = typeof prisma;

export type HandoverKind = "room" | "build" | "scheduled-task";

export type HandoverItem = {
  kind: HandoverKind;
  /** Row id. */
  id: string;
  /** Human reference: WC-*, FB-* or the task id. */
  ref: string;
  toUserId: string;
  toPrincipalRef: string;
  source: WorkOwnerSource;
};

export type HandoverRefusal = { kind: HandoverKind; ref: string; reason: string };

export type HandoverPlan = {
  sourceUserId: string;
  sourceEmail: string;
  items: HandoverItem[];
  refused: HandoverRefusal[];
  digest: string;
};

export type AccountHandoverDb = {
  user: Pick<Db["user"], "findFirst">;
  principalAlias: Pick<Db["principalAlias"], "findFirst">;
  portfolio: Pick<Db["portfolio"], "findMany">;
  agent: Pick<Db["agent"], "findMany">;
  workroom: Pick<Db["workroom"], "findMany">;
  featureBuild: Pick<Db["featureBuild"], "findMany" | "update">;
  buildActivity: Pick<Db["buildActivity"], "create">;
  scheduledAgentTask: Pick<Db["scheduledAgentTask"], "findMany" | "update">;
};

const TERMINAL_ROOM_STATUSES = ["complete", "abandoned", "archived"];
const TERMINAL_BUILD_PHASES = ["complete", "failed", "abandoned"];

/** Workroom.portfolioRole -> Portfolio.slug. */
const SLUG_BY_ROLE: Record<string, string> = PORTFOLIO_SLUG_BY_ROLE;

const KIND_ORDER: Record<HandoverKind, number> = { build: 0, room: 1, "scheduled-task": 2 };

function sortItems<T extends { kind: HandoverKind; ref: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.ref.localeCompare(b.ref));
}

/** A stable fingerprint of exactly what would move, so one approval binds one set. */
export function handoverDigest(items: HandoverItem[], sourceUserId: string): string {
  const lines = sortItems(items).map((i) => `${i.kind}|${i.id}|${sourceUserId}|${i.toUserId}`);
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

async function principalOf(db: AccountHandoverDb, userId: string) {
  const alias = await db.principalAlias.findFirst({
    where: { aliasType: "user", aliasValue: userId },
    select: { principal: { select: { id: true, principalId: true } } },
  });
  return alias?.principal ?? null;
}

export async function planAccountHandover(
  db: AccountHandoverDb,
  input: { sourceAccount: string },
): Promise<ActionResult<HandoverPlan>> {
  const ref = input.sourceAccount.trim();
  const source = ref
    ? await db.user.findFirst({ where: { OR: [{ id: ref }, { email: ref }] }, select: { id: true, email: true } })
    : null;
  if (!source) return err(`No account ${ref || "(empty)"} exists.`);
  const sourcePrincipal = await principalOf(db, source.id);

  const portfolios = await db.portfolio.findMany({ select: { id: true, slug: true } });
  const portfolioIdBySlug = new Map(portfolios.map((p) => [p.slug, p.id]));

  const [builds, rooms, tasks] = await Promise.all([
    db.featureBuild.findMany({
      where: { createdById: source.id, phase: { notIn: TERMINAL_BUILD_PHASES } },
      select: { id: true, buildId: true, portfolioId: true },
    }),
    sourcePrincipal
      ? db.workroom.findMany({
          where: {
            status: { notIn: TERMINAL_ROOM_STATUSES },
            participants: { some: { principalId: sourcePrincipal.id, lifecycle: "active", roles: { has: "coordinator" } } },
          },
          select: {
            id: true,
            capsuleId: true,
            portfolioRole: true,
            participants: { where: { lifecycle: "active", roles: { has: "coordinator" } }, select: { principalId: true } },
          },
        })
      : Promise.resolve([]),
    db.scheduledAgentTask.findMany({
      where: { ownerUserId: source.id },
      select: { id: true, taskId: true, agentId: true },
    }),
  ]);
  // ScheduledAgentTask holds the agent's id as a plain string, with no relation.
  const taskAgentIds = [...new Set((tasks as Array<{ agentId: string }>).map((t) => t.agentId))];
  const agentPortfolio = new Map(
    (taskAgentIds.length
      ? await db.agent.findMany({ where: { agentId: { in: taskAgentIds } }, select: { agentId: true, portfolioId: true } })
      : []
    ).map((a) => [a.agentId, a.portfolioId] as const),
  );

  // Only rooms the leaving account coordinates ALONE: anyone else's room stays theirs.
  const ownRooms = (rooms as Array<{ id: string; capsuleId: string; portfolioRole: string | null; participants: Array<{ principalId: string }> }>)
    .filter((r) => r.participants.length > 0 && r.participants.every((p) => p.principalId === sourcePrincipal?.id));

  const candidates: Array<{ kind: HandoverKind; id: string; ref: string; portfolioId: string | null }> = sortItems([
    ...builds.map((b) => ({ kind: "build" as const, id: b.id, ref: b.buildId, portfolioId: b.portfolioId ?? null })),
    ...ownRooms.map((r) => ({
      kind: "room" as const,
      id: r.id,
      ref: r.capsuleId,
      portfolioId: (r.portfolioRole && portfolioIdBySlug.get(SLUG_BY_ROLE[r.portfolioRole] ?? "")) || null,
    })),
    ...(tasks as Array<{ id: string; taskId: string; agentId: string }>).map((t) => ({
      kind: "scheduled-task" as const, id: t.id, ref: t.taskId, portfolioId: agentPortfolio.get(t.agentId) ?? null,
    })),
  ]);

  const items: HandoverItem[] = [];
  const refused: HandoverRefusal[] = [];
  for (const c of candidates) {
    const owner = await resolveWorkOwner(db as never, { portfolioId: c.portfolioId });
    if (owner.source === "fallback") {
      refused.push({ kind: c.kind, ref: c.ref, reason: "No accountable person is set for its portfolio, Foundational or the organization; nobody has been chosen." });
      continue;
    }
    if (owner.userId === source.id) {
      refused.push({ kind: c.kind, ref: c.ref, reason: "Its accountable person is already the account being handed over." });
      continue;
    }
    const principal = await principalOf(db, owner.userId);
    if (!principal) {
      refused.push({ kind: c.kind, ref: c.ref, reason: "Its accountable person has no principal to appoint." });
      continue;
    }
    items.push({ kind: c.kind, id: c.id, ref: c.ref, toUserId: owner.userId, toPrincipalRef: principal.principalId, source: owner.source });
  }

  return ok({ sourceUserId: source.id, sourceEmail: source.email, items, refused, digest: handoverDigest(items, source.id) });
}

export type HandoverResult = {
  rooms: number;
  builds: number;
  scheduledTasks: number;
  failed: Array<{ kind: HandoverKind; ref: string; reason: string }>;
};

export async function applyAccountHandover(
  db: AccountHandoverDb,
  input: { sourceAccount: string; digest: string; reason: string; actor: { userId: string } },
): Promise<ActionResult<HandoverResult>> {
  const reason = input.reason.trim();
  if (!reason) return err("Say why this account's work is being handed over; the reason is recorded on every item.");
  const plan = await planAccountHandover(db, { sourceAccount: input.sourceAccount });
  if (!plan.ok) return plan;
  if (plan.data.digest !== input.digest) {
    return err("The account's work changed since the dry run, so nothing was moved. Run the dry run again and approve the new set.");
  }

  const result: HandoverResult = { rooms: 0, builds: 0, scheduledTasks: 0, failed: [] };
  const note = `Handed over from ${plan.data.sourceEmail} (BI-F25A5FC7): ${reason}`;
  for (const item of plan.data.items) {
    try {
      if (item.kind === "room") {
        const done = await executeCoordinatorAppointment({
          capsuleId: item.ref, principalRef: item.toPrincipalRef, replaceExisting: true, reason: note,
        });
        if (!done.ok) {
          result.failed.push({ kind: item.kind, ref: item.ref, reason: done.error });
          continue;
        }
        result.rooms += 1;
      } else if (item.kind === "build") {
        await db.featureBuild.update({ where: { id: item.id }, data: { createdById: item.toUserId } });
        await db.buildActivity.create({ data: { buildId: item.ref, tool: "apply_account_handover", summary: note } });
        result.builds += 1;
      } else {
        await db.scheduledAgentTask.update({ where: { id: item.id }, data: { ownerUserId: item.toUserId } });
        result.scheduledTasks += 1;
      }
    } catch (error) {
      // One item failing never strands the rest; a re-run picks up what remains.
      result.failed.push({ kind: item.kind, ref: item.ref, reason: (error as Error).message });
    }
  }
  return ok(result);
}
