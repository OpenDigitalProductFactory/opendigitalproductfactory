/**
 * Resolve the User that OWNS scheduled / proactive platform work.
 *
 * Proactive crons (the skill curator, governed backlog tee-up, …) are not run
 * by any human in the moment, but every `TaskRun` they create must still be
 * owned by a real `User`: `TaskRun.userId` is a NOT NULL FK to `User`. There is
 * NO sentinel "system" user; a literal `userId: "system"` fails the FK
 * (`TaskRun_userId_fkey`, P2003). Always resolve a real owner through here.
 *
 * The owner follows the portfolio (BI-67B27832): the accountable person of the
 * work's portfolio, else of Foundational (the platform's own work), else the
 * organization's top accountable, and only as a labelled last resort the oldest
 * active superuser. It used to go straight to that last resort, which on a
 * standard install is the seeded bootstrap account nobody reads, so approvals
 * from proactive work orphaned. See lib/portfolio/accountable-owner.ts.
 */
import type { AccountableOwnerDb } from "@/lib/portfolio/accountable-owner";

export type ScheduledOwnerClient = AccountableOwnerDb;

export async function resolveScheduledOwnerUserId(
  db?: ScheduledOwnerClient,
  opts: { portfolioId?: string | null } = {},
): Promise<string> {
  // Dynamic imports keep @dpf/db out of the inngest function-registration
  // module graph, matching how callers load prisma inside their step closures.
  const { resolveWorkOwner } = await import("@/lib/portfolio/accountable-owner");
  const client = db ?? ((await import("@dpf/db")).prisma as unknown as ScheduledOwnerClient);
  const owner = await resolveWorkOwner(client, opts);
  return owner.userId;
}
