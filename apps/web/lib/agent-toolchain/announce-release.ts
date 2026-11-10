import "server-only";

// BI-E7974C18 — after a release, say which agent clients are behind
// (design 2026-10-07-agent-toolchain-release-delivery §5.2c, AC-RELEASE-VISIBLE).
//
// The swap's success path runs in the old process, which reads the old image.
// So the new serving process does this on every boot. The latest notification
// in the agent-toolchain category remembers which pack was last announced; a
// restart without a release, or a second replica, finds its own digest there
// and writes nothing.

import { buildConnectedClientsView, clientDisplayName, configuredMcpEndpoint, type ConnectedClientRow } from "./connected-clients";
import type { PublishedToolchain } from "./toolchain-verdict";

export const TOOLCHAIN_NOTIFICATION_CATEGORY = "agent-toolchain";
const LOCK_KEY = "dpf:agent-toolchain:announce";
const NAMES_LISTED = 8;

export function toolchainSubjectId(packDigest: string): string {
  return `toolchain:${packDigest}`;
}

type AnnounceTx = {
  $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  platformNotification: {
    findFirst: (args: unknown) => Promise<{ subjectId: string | null } | null>;
    create: (args: unknown) => Promise<unknown>;
    updateMany: (args: unknown) => Promise<unknown>;
  };
} & Parameters<typeof buildConnectedClientsView>[0];

type AnnounceDb = AnnounceTx & { $transaction: <T>(fn: (tx: AnnounceTx) => Promise<T>) => Promise<T> };

export type AnnounceResult =
  | { outcome: "announced"; behind: number }
  | { outcome: "already-announced" }
  | { outcome: "no-pack" };

function lastSeenDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The notification text. Plain words; the digest stays out of it. */
export function announcementMessage(packVersion: string, behind: ConnectedClientRow[], truncated: boolean): string {
  const head = `This update ships version ${packVersion} of the DPF agent tools.`;
  if (behind.length === 0) {
    return `${head} Every connected agent client already uses it.`;
  }
  const names = behind
    .slice(0, NAMES_LISTED)
    .map((row) => `${clientDisplayName(row)} (last seen ${lastSeenDay(row.lastSeen)})`)
    .join(", ");
  const more = behind.length > NAMES_LISTED || truncated ? ", and more" : "";
  const count = behind.length === 1 ? "1 connected agent client still uses" : `${behind.length} connected agent clients still use`;
  return (
    `${head} ${count} an older copy: ${names}${more}. ` +
    "Each one is told on its next connection and asked to update. See Self-Upgrade, Connected agent clients."
  );
}

/** Announce the served pack once per digest. Testable core; the boot wrapper below supplies the inputs. */
export async function announceToolchainRelease(
  db: AnnounceDb,
  input: { published: PublishedToolchain | null; mcpEndpoint: string; now: Date },
): Promise<AnnounceResult> {
  const { published } = input;
  if (!published) return { outcome: "no-pack" };
  const subjectId = toolchainSubjectId(published.packDigest);
  return db.$transaction(async (tx) => {
    // Two replicas booting together: the second waits, then sees the first one's row.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${LOCK_KEY}, 0))`;
    const latest = await tx.platformNotification.findFirst({
      where: { category: TOOLCHAIN_NOTIFICATION_CATEGORY },
      orderBy: { createdAt: "desc" },
      select: { subjectId: true },
    });
    if (latest?.subjectId === subjectId) return { outcome: "already-announced" } as const;

    const view = await buildConnectedClientsView(tx as never, input);
    const behind = view.clients.filter((row) => row.behind);
    await tx.platformNotification.updateMany({
      where: { category: TOOLCHAIN_NOTIFICATION_CATEGORY, resolvedAt: null, subjectId: { not: subjectId } },
      data: { resolvedAt: input.now },
    });
    await tx.platformNotification.create({
      data: {
        severity: behind.length > 0 ? "warning" : "info",
        category: TOOLCHAIN_NOTIFICATION_CATEGORY,
        subjectId,
        message: announcementMessage(published.packVersion, behind, view.truncated),
      },
    });
    return { outcome: "announced", behind: behind.length } as const;
  });
}

/**
 * Boot task. Runs after the self-upgrade reconcile so the run that produced
 * this image is already marked succeeded. Fail-open: never blocks or breaks boot.
 */
export async function announceToolchainReleaseOnBoot(logger: Pick<Console, "log" | "warn"> = console): Promise<void> {
  try {
    const [{ prisma }, { getPublishedToolchain }, { getDeployedSha }, { notifySelfUpgradeCompletedFor }] = await Promise.all([
      import("@dpf/db"),
      import("./served-toolchain"),
      import("@/lib/self-upgrade/completion"),
      import("@/lib/self-upgrade/notification"),
    ]);
    await notifySelfUpgradeCompletedFor(await getDeployedSha());
    const result = await announceToolchainRelease(prisma as never, {
      published: getPublishedToolchain(),
      mcpEndpoint: configuredMcpEndpoint(),
      now: new Date(),
    });
    if (result.outcome === "announced") {
      logger.log(`[agent-toolchain] announced the released agent tools; ${result.behind} client(s) behind`);
    }
  } catch (error) {
    logger.warn("[agent-toolchain] release announcement skipped:", error);
  }
}
