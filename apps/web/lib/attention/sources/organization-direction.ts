// Organization-direction source (BI-916216E7 AC-4) — the instance's mission,
// vision or top-level outcomes are not recorded yet, projected as ONE "Needs
// you" item that leads the owner to the Direction panel.
//
// Keyed off live state, never off whether setup ran: an owner who skipped the
// direction setup step, left part of it blank, or finished setup before the
// step existed all get the same single item, and it clears itself the moment
// all three are recorded. It never blocks anything.

import type { prisma } from "@dpf/db";
import { directionGaps, type DirectionGap } from "@/lib/organization-direction/direction";
import type { AttentionItem } from "../types";

import { DIRECTION_PANEL_HREF } from "@/lib/organization-direction/direction-vocabulary";

export const DIRECTION_ROUTE = DIRECTION_PANEL_HREF;

const GAP_WORDS: Record<DirectionGap, string> = {
  mission: "mission",
  vision: "vision",
  outcomes: "top-level outcomes",
};

function missingPhrase(gaps: DirectionGap[]): string {
  const words = gaps.map((g) => GAP_WORDS[g]);
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export function organizationDirectionToAttentionItem(gaps: DirectionGap[], nowIso: string): AttentionItem {
  return {
    id: "organization-direction",
    source: "organization-direction",
    title: "Set your direction",
    context: `Add your ${missingPhrase(gaps)} so AI decisions steer by them.`,
    decisionClass: { scorability: "unscorable" },
    riskClass: "bounded-write",
    triage: {
      timeToAct: "none",
      residueReason: "input-required",
      blastRadius: "How AI coworkers weigh decisions",
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: nowIso,
    actions: [{ kind: "open-in-context", label: "Set direction", href: DIRECTION_PANEL_HREF }],
    deepLink: DIRECTION_PANEL_HREF,
    audience: { operator: true },
  };
}

type Db = Pick<typeof prisma, "organization" | "businessContext" | "instanceOutcome">;

export async function loadOrganizationDirectionItems(db: Db, now: Date = new Date()): Promise<AttentionItem[]> {
  const org = await db.organization.findFirst({ select: { id: true } });
  if (!org) return [];
  const [bc, outcomeCount] = await Promise.all([
    db.businessContext.findUnique({ where: { organizationId: org.id }, select: { mission: true, vision: true } }),
    db.instanceOutcome.count({ where: { organizationId: org.id, lifecycle: "active" } }),
  ]);
  const gaps = directionGaps({ mission: bc?.mission, vision: bc?.vision, outcomeCount });
  return gaps.length > 0 ? [organizationDirectionToAttentionItem(gaps, now.toISOString())] : [];
}
