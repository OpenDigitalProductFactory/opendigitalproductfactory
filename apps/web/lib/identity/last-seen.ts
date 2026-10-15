// When a workforce user last used the portal (BI-61DE8177).
//
// Coworker approvals go only to the envelope's delegating user — that isolation
// is intended. What was missing is any way to notice that the user never comes:
// sessions are 30-day JWTs and nothing recorded a sign-in, so approvals routed to
// an account nobody reads expired in silence. This stamp is the signal the
// orphaned-approval attention source reads.
//
// "Seen", not "signed in": one sign-in lasts a month, so a sign-in stamp alone
// would call a daily user absent. It is stamped at sign-in and on shell renders,
// at most once per interval per process, and the write itself only lands when the
// stored value is older than the interval — so a busy user costs one small
// UPDATE an hour, not one per page. Best effort: a failed stamp never breaks the
// page that asked for it.

export const LAST_SEEN_STAMP_INTERVAL_MS = 60 * 60 * 1000;

type LastSeenDb = {
  user: {
    updateMany(args: {
      where: { id: string; OR: Array<{ lastSeenAt: null } | { lastSeenAt: { lt: Date } }> };
      data: { lastSeenAt: Date };
    }): Promise<unknown>;
  };
};

const stampedAt = new Map<string, number>();

export async function recordUserSeen(db: LastSeenDb, userId: string, now: Date = new Date()): Promise<void> {
  if (!userId) return;
  const previous = stampedAt.get(userId);
  if (previous !== undefined && now.getTime() - previous < LAST_SEEN_STAMP_INTERVAL_MS) return;
  stampedAt.set(userId, now.getTime());
  try {
    await db.user.updateMany({
      where: {
        id: userId,
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(now.getTime() - LAST_SEEN_STAMP_INTERVAL_MS) } }],
      },
      data: { lastSeenAt: now },
    });
  } catch {
    // Let the next render try again rather than waiting out the interval.
    stampedAt.delete(userId);
  }
}

/** Test seam: the throttle is process-local state. */
export function resetLastSeenThrottle(): void {
  stampedAt.clear();
}
