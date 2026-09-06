// EP-1FABA22D · Purpose-Aware Installation and Ecosystem Productivity
// Compose the instance stance from its canonical authorities.
//
// Authority split preserved from the design:
//   - environment class  → the precedence chain in ./environment-class, whose
//                          canonical host tier is installer state
//   - operating intent   → PlatformConfig `installation.operating-intent.v1`
//   - source capability  → install host profile
//   - uncaptured work    → backlog recency vs the last recorded durable capture
//
// Every read fails open to the *most cautious* answer. An installation that
// cannot prove it is disposable is treated as production.

import type { PrismaClient } from "@dpf/db";
import {
  resolveInstanceStance,
  type InstanceStanceProfile,
} from "@dpf/db/installation-instance-stance";
import {
  pairingSupportsWorkSync,
  resolveInstallationPairing,
  type PairingLink,
} from "@dpf/db/installation-peer-pairing";
import {
  buildInstallationOperatingProfileSnapshot,
  parseOperatingIntent,
  type InstallationOperatingIntentV1,
} from "@dpf/db/installation-operating-intent";

import { loadEnvironmentClassResolution } from "@/lib/install/environment-class";
import { readInstallHostProfile } from "@/lib/install/host-profile";

// The installer-state read lives with the precedence chain that ranks it.
// Re-exported here because this module is the composition entry point every
// agent-facing surface already imports.
export { readInstallEnvironmentClass } from "@/lib/install/environment-class";

/** PlatformConfig key holding the stored semantic operating intent. */
export const OPERATING_INTENT_CONFIG_KEY = "installation.operating-intent.v1";

/** PlatformConfig key holding the last durable backlog capture receipt. */
export const BACKLOG_CAPTURE_CONFIG_KEY = "installation.backlog-capture.v1";

/** Backlog statuses whose work is not yet finished, and so cannot be recreated. */
const UNFINISHED_STATUSES = ["triaging", "open", "in-progress"] as const;

/**
 * A durable capture receipt written by the backlog exporter.
 *
 * `itemCount` and `capturedAt` let the stance resolver decide whether the capture
 * still covers the work currently on the instance.
 */
export interface BacklogCaptureReceiptV1 {
  schemaVersion: 1;
  capturedAt: string;
  bundlePath: string;
  itemCount: number;
  unfinishedItemCount: number;
}

function parseCaptureReceipt(raw: unknown): BacklogCaptureReceiptV1 | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (value["schemaVersion"] !== 1) return null;
  if (typeof value["capturedAt"] !== "string") return null;
  if (typeof value["bundlePath"] !== "string") return null;
  if (typeof value["itemCount"] !== "number") return null;
  if (typeof value["unfinishedItemCount"] !== "number") return null;
  return value as unknown as BacklogCaptureReceiptV1;
}

/**
 * Decide whether this instance currently holds work that exists nowhere else.
 *
 * Work is irreplaceable when unfinished backlog items exist and the last durable
 * capture no longer covers them. Coverage is decided by *recency*, not by count:
 * any unfinished item created or updated after the capture instant is work the
 * bundle does not contain.
 */
export function holdsIrreplaceableWork(input: {
  unfinishedItemCount: number;
  receipt: BacklogCaptureReceiptV1 | null;
  /**
   * The most recent create/update across unfinished items, or null when there
   * are none. Compared against the receipt instant, because a count cannot tell
   * a captured backlog from a differently-composed one of the same size.
   */
  latestUnfinishedChangeAt?: Date | string | null;
}): boolean {
  if (input.unfinishedItemCount === 0) return false;
  if (!input.receipt) return true;

  // Counts do not establish coverage. A backlog only ever grows if nothing is
  // ever closed; in practice items are closed, retired and deferred while new
  // ones are filed, so the count can fall while the *composition* changes
  // entirely. A falling count then reads as "captured more than we hold" — the
  // safest possible answer — at the exact moment new work is uncaptured.
  //
  // Observed on a dogfood reset install (BI-9CE1A6C8): receipt recorded 111
  // unfinished, the instance held 98, and 75 of those 98 were filed after the
  // capture. The stance reported "no uncaptured work" over 75 unbundled items.
  // The degenerate case is worse: close one, file one, and the count never
  // moves at all.
  const capturedAt = Date.parse(input.receipt.capturedAt);
  const latestChange =
    input.latestUnfinishedChangeAt == null
      ? Number.NaN
      : new Date(input.latestUnfinishedChangeAt).getTime();

  // An unreadable instant on either side is unknown coverage, which is
  // uncaptured work — the guard fails closed.
  if (!Number.isFinite(capturedAt) || !Number.isFinite(latestChange)) return true;

  return latestChange > capturedAt;
}

/** Minimal store shape so callers can pass Prisma without this module importing it. */
export interface InstanceStanceStore {
  readConfig(key: string): Promise<unknown>;
  /** The Organization row's name from setup — the lowest estate-name tier (BI-CA54ACC8). */
  readOrganizationName?(): Promise<string | null>;
  countBacklogItemsByStatus(statuses: readonly string[]): Promise<number>;
  /**
   * Most recent create/update across items in those statuses, or null when
   * there are none. Optional so existing callers keep working; absent leaves
   * the freshness comparison without an instant, which the resolver treats as
   * uncaptured work rather than assuming coverage.
   */
  latestBacklogChangeByStatus?(statuses: readonly string[]): Promise<Date | null>;
  /**
   * The federation links that could establish a pairing. Optional so existing
   * callers keep working; absent means no link evidence, which leaves work sync
   * off rather than assuming a declared peer is real.
   */
  listFederationLinks?(): Promise<readonly PairingLink[]>;
  /** The one federation health sentence, or null when it cannot be read. */
  readWorkSyncHealthLine?(): Promise<string | null>;
}

/**
 * Adapt Prisma to that store shape.
 *
 * The `import type` above is erased at build time, so this module still pulls in
 * no database runtime. Both readers of the stance — the MCP handshake and the
 * workspace identity panel — compose it through here, so neither can drift onto
 * a different set of rows.
 */
export function prismaInstanceStanceStore(
  prisma: Pick<PrismaClient, "platformConfig" | "backlogItem" | "federationLink" | "organization">,
): InstanceStanceStore {
  return {
    readConfig: async (key) =>
      (await prisma.platformConfig.findUnique({ where: { key } }))?.value ?? null,
    // Lowest estate-name tier: the organization named at setup (BI-CA54ACC8).
    readOrganizationName: async () =>
      (await prisma.organization.findFirst({ select: { name: true } }))?.name ?? null,
    countBacklogItemsByStatus: (statuses) =>
      prisma.backlogItem.count({ where: { status: { in: [...statuses] } } }),
    latestBacklogChangeByStatus: async (statuses) => {
      // createdAt and updatedAt are both consulted: an item edited after the
      // capture is as uncaptured as one filed after it.
      const [created, updated] = await Promise.all([
        prisma.backlogItem.aggregate({
          where: { status: { in: [...statuses] } },
          _max: { createdAt: true },
        }),
        prisma.backlogItem.aggregate({
          where: { status: { in: [...statuses] } },
          _max: { updatedAt: true },
        }),
      ]);
      const stamps = [created._max.createdAt, updated._max.updatedAt].filter(
        (value): value is Date => value instanceof Date,
      );
      if (stamps.length === 0) return null;
      return stamps.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b));
    },
    readWorkSyncHealthLine: async () => {
      const { getFederationHealth } = await import("@/lib/federation/work-sync-read-model");
      return (await getFederationHealth()).line;
    },
    listFederationLinks: async () => {
      const rows = await prisma.federationLink.findMany({
        select: {
          linkId: true,
          linkState: true,
          role: true,
          peerOrganizationRef: true,
          revokedAt: true,
          quarantinedAt: true,
        },
      });
      return rows.map((row) => ({
        linkId: row.linkId,
        linkState: row.linkState,
        // `same-org-peer` is the role a same-organization link takes; the preset
        // itself is not a column, so the role is what identifies the pairing.
        relationshipPreset: row.role === "same-org-peer" ? "same-organization" : row.role,
        peerLabel: row.peerOrganizationRef,
        revokedAt: row.revokedAt,
        quarantinedAt: row.quarantinedAt,
      }));
    },
  };
}

/**
 * Compose the full instance stance from every canonical authority.
 *
 * Fails open to the cautious stance on any read error: an instance that cannot
 * describe itself is treated as production holding irreplaceable work.
 */
export async function loadInstanceStance(
  store: InstanceStanceStore,
  options: {
    readText?: (path: string) => Promise<string>;
    env?: Record<string, string | undefined>;
    readHostProfile?: typeof readInstallHostProfile;
  } = {},
): Promise<InstanceStanceProfile> {
  const readHostProfile = options.readHostProfile ?? readInstallHostProfile;
  const [{ environmentClass }, hostProfile] = await Promise.all([
    loadEnvironmentClassResolution(store, { readText: options.readText, env: options.env }),
    readHostProfile(),
  ]);

  let intent: InstallationOperatingIntentV1 | null = null;
  try {
    intent = parseOperatingIntent(await store.readConfig(OPERATING_INTENT_CONFIG_KEY));
  } catch {
    intent = null;
  }

  let unfinished = 0;
  let receipt: BacklogCaptureReceiptV1 | null = null;
  let latestUnfinishedChangeAt: Date | null = null;
  try {
    unfinished = await store.countBacklogItemsByStatus(UNFINISHED_STATUSES);
    receipt = parseCaptureReceipt(await store.readConfig(BACKLOG_CAPTURE_CONFIG_KEY));
    latestUnfinishedChangeAt =
      (await store.latestBacklogChangeByStatus?.(UNFINISHED_STATUSES)) ?? null;
  } catch {
    // Unknown backlog state is treated as uncaptured work.
    unfinished = Math.max(unfinished, 1);
    latestUnfinishedChangeAt = null;
  }

  const resolvedIntent: InstallationOperatingIntentV1 = intent ?? {
    schemaVersion: 1,
    primaryPurpose: "operate-organization",
    secondaryPurposes: [],
    relationshipIntents: [],
    evidence: [],
    confidence: "low",
    confirmation: { status: "needs-review" },
  };

  const snapshot = buildInstallationOperatingProfileSnapshot({
    intent: resolvedIntent,
    environmentClass,
  });

  // The link is evidence; the typed ref is intent. Resolve against real links so
  // a reseeded or never-established pairing cannot report work as mirrored.
  let links: readonly PairingLink[] = [];
  try {
    links = (await store.listFederationLinks?.()) ?? [];
  } catch {
    links = [];
  }
  const pairing = resolveInstallationPairing({
    declaredRef: snapshot.pairedProductionInstallationRef,
    links,
  });
  let workSyncHealthLine: string | undefined;
  try {
    workSyncHealthLine = (await store.readWorkSyncHealthLine?.()) ?? undefined;
  } catch {
    workSyncHealthLine = undefined;
  }

  return resolveInstanceStance(
    { ...snapshot, pairedProductionInstallationRef: pairing.ref ?? undefined },
    {
      sourceCapable: hostProfile.sourceCapable,
      pairingIsEstablished: pairingSupportsWorkSync(pairing),
      ...(workSyncHealthLine ? { workSyncHealthLine } : {}),
    },
    {
      holdsIrreplaceableWork: holdsIrreplaceableWork({
        unfinishedItemCount: unfinished,
        receipt,
        latestUnfinishedChangeAt,
      }),
    },
  );
}
