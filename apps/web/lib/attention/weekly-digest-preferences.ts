import type { prisma } from "@dpf/db";

export type WeeklyDigestDisposition = "cleared" | "snoozed";

type Db = Pick<typeof prisma, "userFact">;

const CATEGORY = "preference";
const KEY_PREFIX = "ownerAttentionDigest";

export function weeklyDigestFactKey(reviewOnIso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewOnIso)) {
    throw new Error("A valid weekly digest review date is required");
  }
  return `${KEY_PREFIX}:${reviewOnIso}`;
}

export async function loadWeeklyDigestDisposition(
  db: Db,
  userId: string,
  reviewOnIso: string,
): Promise<WeeklyDigestDisposition | null> {
  const fact = await db.userFact.findFirst({
    where: {
      userId,
      category: CATEGORY,
      key: weeklyDigestFactKey(reviewOnIso),
      supersededAt: null,
    },
    orderBy: { updatedAt: "desc" },
    select: { value: true },
  });
  if (!fact) return null;
  try {
    const disposition = (JSON.parse(fact.value) as { disposition?: unknown }).disposition;
    return disposition === "cleared" || disposition === "snoozed" ? disposition : null;
  } catch {
    return null;
  }
}

export async function saveWeeklyDigestDisposition(
  db: Db,
  userId: string,
  reviewOnIso: string,
  disposition: WeeklyDigestDisposition,
  decidedAt = new Date(),
): Promise<void> {
  const key = weeklyDigestFactKey(reviewOnIso);
  const existing = await db.userFact.findFirst({
    where: { userId, category: CATEGORY, key, supersededAt: null },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  const data = {
    value: JSON.stringify({ disposition }),
    confidence: 1,
    sourceRoute: "/workspace/inbox",
    sourceAgentId: null,
    lastValidatedAt: decidedAt,
  };
  if (existing) {
    await db.userFact.update({ where: { id: existing.id }, data });
    return;
  }
  await db.userFact.create({
    data: { userId, category: CATEGORY, key, ...data },
  });
}
