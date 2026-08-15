// apps/web/lib/coworker-identity/teams-projection.ts
//
// EP-COWORKER-IDENTITY-360 Phase 2 — the "Teams & collaboration (work rooms)"
// facet the founder asked for: which collaborative spaces a coworker is part of.
// Grounded in existing membership substrate — ValueStreamTeamRole (the coworker's
// role on a value-stream team) and AgentOwnership → Team (a team it owns a
// responsibility in). Both key on the Agent.id cuid, not the business agentId.
//
// Zero-schema read-projection. The pure aggregator (aggregateRooms) is split from
// the prisma fetch so grouping/dedup is unit-tested (teams-projection.test.ts).

import { prisma } from "@dpf/db";

export type CoworkerRoomKind = "value-stream-team" | "owning-team";

export type CoworkerRoom = {
  /** Stable id (team id) for dedup. */
  id: string;
  name: string;
  kind: CoworkerRoomKind;
  /** The coworker's role / responsibility in this room. */
  role: string;
  /** Secondary context (value stream + team pattern, or the responsibility). */
  detail: string;
};

export type CoworkerTeamsSummary = {
  rooms: CoworkerRoom[];
  totals: { total: number; leads: number };
};

const LEAD_ROLE = /lead|owner|coordinat|orchestrat/i;

/** Pure aggregator: dedupe rooms by (kind,id), keep a stable order, count leads. */
export function aggregateRooms(rows: CoworkerRoom[], opts?: { maxRooms?: number }): CoworkerTeamsSummary {
  const maxRooms = opts?.maxRooms ?? 8;
  const byKey = new Map<string, CoworkerRoom>();
  for (const row of rows) {
    const key = `${row.kind}:${row.id}`;
    if (!byKey.has(key)) byKey.set(key, row);
  }
  const all = [...byKey.values()];
  const totals = {
    total: all.length,
    leads: all.filter((r) => LEAD_ROLE.test(r.role)).length,
  };
  return { rooms: all.slice(0, maxRooms), totals };
}

/**
 * Fetch + aggregate the teams / rooms a coworker is part of. `agentCuid` is the
 * Agent.id cuid (both membership tables key on it). Fail-open to an empty summary.
 */
export async function loadCoworkerTeams(agentCuid: string): Promise<CoworkerTeamsSummary> {
  try {
    const [vsRoles, ownerships] = await Promise.all([
      prisma.valueStreamTeamRole.findMany({
        where: { agentId: agentCuid },
        select: {
          roleName: true,
          team: { select: { id: true, name: true, valueStream: true, teamPattern: true } },
        },
        orderBy: { priority: "desc" },
        take: 50,
      }),
      prisma.agentOwnership.findMany({
        where: { agentId: agentCuid },
        select: {
          responsibility: true,
          team: { select: { id: true, name: true } },
        },
        take: 50,
      }),
    ]);

    const rows: CoworkerRoom[] = [];
    for (const r of vsRoles) {
      if (!r.team) continue;
      rows.push({
        id: r.team.id,
        name: r.team.name,
        kind: "value-stream-team",
        role: r.roleName,
        detail: [titleCaseSlug(r.team.valueStream), titleCaseSlug(r.team.teamPattern)]
          .filter(Boolean)
          .join(" · "),
      });
    }
    for (const o of ownerships) {
      if (!o.team) continue;
      rows.push({
        id: o.team.id,
        name: o.team.name,
        kind: "owning-team",
        role: titleCaseSlug(o.responsibility),
        detail: "Owns a responsibility",
      });
    }

    return aggregateRooms(rows);
  } catch (err) {
    console.warn("[coworker-identity/teams] failed to load teams:", err);
    return { rooms: [], totals: { total: 0, leads: 0 } };
  }
}

function titleCaseSlug(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/[-_]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
    .join(" ");
}
