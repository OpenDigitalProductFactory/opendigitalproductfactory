/**
 * Resolve the User principal that OWNS scheduled / proactive platform work.
 *
 * Proactive crons (the skill curator, governed backlog tee-up, …) are not run
 * by any human in the moment, but every `TaskRun` they create must still be
 * owned by a real `User` — `TaskRun.userId` is a NOT NULL FK to `User`. The
 * platform convention, verified against live `TaskRun` rows, is to attribute
 * that ownership to the bootstrap superuser (HR-000), the same principal that
 * owns the install. The non-human *executor* of the work is carried separately
 * on `TaskRun.initiatingAgentId` / `currentAgentId` when a specific AI coworker
 * (an `Agent` identity) drives it — the skill curator is a governance cron
 * owned by the human supervisor, so it sets only the owner.
 *
 * There is NO sentinel "system" user: a literal `userId: "system"` has no
 * matching `User` row and fails the FK (`TaskRun_userId_fkey`, P2003). Always
 * resolve a real owner through this helper instead of hardcoding a string.
 */
export type ScheduledOwnerClient = {
  user: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
  };
};

export async function resolveScheduledOwnerUserId(
  db?: ScheduledOwnerClient,
): Promise<string> {
  // Dynamic import (not a top-level one) keeps @dpf/db out of the inngest
  // function-registration module graph and mirrors how the callers already
  // load prisma inside their step closures. Tests inject `db` and never reach
  // this branch, so they stay hermetic.
  const client =
    db ?? ((await import("@dpf/db")).prisma as unknown as ScheduledOwnerClient);

  const owner = await client.user.findFirst({
    where: { isSuperuser: true, isActive: true },
    // Oldest active superuser = the bootstrap install owner. Deterministic so
    // every proactive job attributes to the same principal across runs.
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!owner) {
    throw new Error(
      "No active superuser is available to own scheduled platform work.",
    );
  }

  return owner.id;
}
