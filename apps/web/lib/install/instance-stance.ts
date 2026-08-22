// EP-1FABA22D · Purpose-Aware Installation and Ecosystem Productivity
// Compose the instance stance from its canonical authorities.
//
// Authority split preserved from the design:
//   - environment class  → the precedence chain in ./environment-class, whose
//                          canonical host tier is installer state
//   - operating intent   → PlatformConfig `installation.operating-intent.v1`
//   - source capability  → install host profile
//   - uncaptured work    → backlog counts vs the last recorded durable capture
//
// Every read fails open to the *most cautious* answer. An installation that
// cannot prove it is disposable is treated as production.

import type { PrismaClient } from "@dpf/db";
import {
  resolveInstanceStance,
  type InstanceStanceProfile,
} from "@dpf/db/installation-instance-stance";
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
 * capture no longer covers them. A capture that recorded fewer unfinished items
 * than the instance holds today is stale by definition.
 */
export function holdsIrreplaceableWork(input: {
  unfinishedItemCount: number;
  receipt: BacklogCaptureReceiptV1 | null;
}): boolean {
  if (input.unfinishedItemCount === 0) return false;
  if (!input.receipt) return true;
  return input.receipt.unfinishedItemCount < input.unfinishedItemCount;
}

/** Minimal store shape so callers can pass Prisma without this module importing it. */
export interface InstanceStanceStore {
  readConfig(key: string): Promise<unknown>;
  countBacklogItemsByStatus(statuses: readonly string[]): Promise<number>;
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
  prisma: Pick<PrismaClient, "platformConfig" | "backlogItem">,
): InstanceStanceStore {
  return {
    readConfig: async (key) =>
      (await prisma.platformConfig.findUnique({ where: { key } }))?.value ?? null,
    countBacklogItemsByStatus: (statuses) =>
      prisma.backlogItem.count({ where: { status: { in: [...statuses] } } }),
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
  try {
    unfinished = await store.countBacklogItemsByStatus(UNFINISHED_STATUSES);
    receipt = parseCaptureReceipt(await store.readConfig(BACKLOG_CAPTURE_CONFIG_KEY));
  } catch {
    // Unknown backlog state is treated as uncaptured work.
    unfinished = Math.max(unfinished, 1);
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

  return resolveInstanceStance(
    snapshot,
    { sourceCapable: hostProfile.sourceCapable },
    { holdsIrreplaceableWork: holdsIrreplaceableWork({ unfinishedItemCount: unfinished, receipt }) },
  );
}
