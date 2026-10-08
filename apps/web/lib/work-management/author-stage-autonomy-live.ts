// The live reads behind the author-stage decision (BI-8A32EBFF), once per drive
// run: the operator pre-authorisation, then — only when it is in force — the
// investment and budget models for the current quarter. The drive asks the
// returned function once per room. Any read failure withholds autonomy for the
// run and says so: the drive falls back to attention, never to dispatch.

import {
  buildAuthorStageFunding,
  decideAuthorStageAutonomy,
  type AuthorStageAutonomy,
  type AuthorStageFunding,
} from "./author-stage-autonomy";
import {
  AUTHOR_STAGE_PREAUTHORISATION_CONFIG_KEY,
  resolveAuthorStagePreauthorisation,
  type AuthorStagePreauthorisation,
} from "./author-stage-preauthorisation";

export type AuthorStageRoom = { backlogItemId?: string | null };
export type AuthorStageAutonomyFor = (room: AuthorStageRoom, shapeKey: string | null) => AuthorStageAutonomy;

/** No author-stage rule: a caller that supplies its own rooms (tests) keeps the prior behaviour. */
export const NO_AUTHOR_STAGE_AUTONOMY: AuthorStageAutonomyFor = () => ({ roleBindings: {}, withheldBecause: null });

function withheldFor(preauthorisation: AuthorStagePreauthorisation, funding: (room: AuthorStageRoom) => AuthorStageFunding): AuthorStageAutonomyFor {
  return (room, shapeKey) => decideAuthorStageAutonomy({ shapeKey, preauthorisation, funding: funding(room) });
}

export async function loadAuthorStageAutonomy(rooms: readonly AuthorStageRoom[], now: Date): Promise<AuthorStageAutonomyFor> {
  try {
    const { prisma } = await import("@dpf/db");
    const preauthorisation = await resolveAuthorStagePreauthorisation({
      readConfig: async (key) => (await prisma.platformConfig.findUnique({ where: { key }, select: { value: true } }))?.value ?? null,
      operatorMayAuthorise: async (userId) => {
        const { currentUserContext } = await import("@/lib/govern/current-user-context");
        const { can } = await import("@/lib/permissions");
        const context = await currentUserContext(userId);
        return context !== null && can(context, "manage_platform");
      },
    });
    if (preauthorisation.state !== "in-force") {
      return withheldFor(preauthorisation, () => ({ funded: false, because: preauthorisation.because }));
    }

    const { quarterBounds } = await import("@/lib/portfolio/investment-points");
    const { loadInvestmentItems } = await import("@/lib/portfolio/investment-read-model");
    const { loadPortfolioBudgets } = await import("@/lib/portfolio/portfolio-budget");
    const period = quarterBounds(now);
    const db = prisma as never;
    const funding = buildAuthorStageFunding({
      items: await loadInvestmentItems(db, period),
      budgets: await loadPortfolioBudgets(db, period),
      now,
    });
    // A room stores its item as the semantic BI-* key or the row id; funding is keyed by the semantic key.
    const stored = [...new Set(rooms.map((room) => room.backlogItemId).filter((id): id is string => Boolean(id)))];
    const keys = stored.length === 0
      ? []
      : await prisma.$queryRaw<Array<{ id: string; itemId: string }>>`
          SELECT "id", "itemId" FROM "BacklogItem" WHERE "id" = ANY(${stored}::text[]) OR "itemId" = ANY(${stored}::text[])`;
    const itemIdOf = new Map<string, string>();
    for (const row of keys) {
      itemIdOf.set(row.id, row.itemId);
      itemIdOf.set(row.itemId, row.itemId);
    }
    return withheldFor(preauthorisation, (room) => funding(room.backlogItemId ? itemIdOf.get(room.backlogItemId) ?? room.backlogItemId : null));
  } catch (error) {
    console.warn("[workroom-drive] author-stage pre-authorisation unreadable:", error);
    const because = `The pre-authorisation (${AUTHOR_STAGE_PREAUTHORISATION_CONFIG_KEY}) or the budget could not be read this run; the next run tries again.`;
    return withheldFor({ state: "not-in-force", because }, () => ({ funded: false, because }));
  }
}
