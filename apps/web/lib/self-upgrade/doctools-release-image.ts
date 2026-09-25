// Release installs resolve the dpf-doctools image the way they resolve the
// promoter (BI-9A2EC54A, slice s2b of the office document engine).
//
// The promoter's release reference is derived, not configured:
// self-upgrade.ts builds `ghcr.io/<ghcrOwner>/dpf-promoter:<release tag>` from
// loadReleaseInstallContext() and pins it by digest. dpf-doctools is published
// beside it under the same immutable tag (publish-image.yml merge job), and that
// job records the tag's manifest digest with
// `docker buildx imagetools inspect <ref> --format '{{json .Manifest}}'`.
// This module runs that same command from the portal, so the pin it stores is
// the digest the release recorded.
//
// It runs in the NEW portal at boot, and again on a timer. A swap recreates
// the portal and kills the orchestrator, so the upgrade worker could never
// record anything after the swap. reconcileSelfUpgradeRunsOnBoot closes that
// loop at boot for the same reason. One path then covers every case:
//   - the first boot of a fresh install (bootstrap);
//   - the first boot after a self-upgrade;
//   - a rollback;
//   - an out-of-band DPF_IMAGE_TAG bump.
//
// The result is machine-owned state in its own key, beside the other
// `self_upgrade.*` state keys (cooldownUntil, lastCheckedAt). The
// operator-owned `self_upgrade` row's `doctoolsImage` field and
// DPF_DOCTOOLS_IMAGE still take precedence (see documents/conversion/image.ts),
// so a source/dev install keeps its override.
//
// Nothing here can fail an upgrade or a boot:
//   - a release with no dpf-doctools manifest leaves the key unset (AC-3);
//   - an unreachable registry keeps the prior state for the next tick;
//   - a failed pull leaves the pin in place, and the next tick retries it.

import { isPinnedImageReference } from "@/lib/documents/conversion/command";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { runProcessWithBudget } from "@/lib/shared/run-process-with-budget";
import { RELEASE_IMAGE_TAG } from "./registry-release";
import { loadReleaseInstallContext, type ReleaseInstallContext } from "./release-target";

export const DOCTOOLS_RELEASE_IMAGE_KEY = "self_upgrade.doctoolsImage";
export const DOCTOOLS_IMAGE_NAME = "dpf-doctools";
/** Same cadence as the other self-upgrade reconcilers in instrumentation.ts. */
export const DOCTOOLS_RECONCILE_INTERVAL_MS = 20 * 60 * 1000;

const REGISTRY = "ghcr.io";
const REGISTRY_OWNER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;
const SHA_256 = /^sha256:[a-f0-9]{64}$/;
// `imagetools inspect` and `docker pull` report a missing tag or manifest this way.
const NOT_PUBLISHED = /not found|manifest unknown|name unknown/i;
const INSPECT_TIMEOUT_MS = 60_000;
const PULL_TIMEOUT_MS = 30 * 60 * 1000;

export type StoredReleaseDoctoolsImage = {
  image: string;
  releaseTag: string;
  resolvedAt?: string;
};

export type DoctoolsDockerResult = { exitCode: number; stdout: string; stderr: string };
export type DoctoolsDockerRunner = (args: string[], options?: { timeoutMs?: number }) => Promise<DoctoolsDockerResult>;

export type ReleaseDoctoolsResolution =
  | { kind: "published"; image: string }
  | { kind: "not-published" }
  | { kind: "unavailable"; detail: string };

export type DoctoolsReconcileOutcome =
  | { outcome: "not-release-install" }
  | { outcome: "resolved" | "unchanged"; image: string; pulled: boolean }
  | { outcome: "not-published" }
  | { outcome: "unavailable"; detail: string }
  | { outcome: "error"; detail: string };

export type DoctoolsReconcileDeps = {
  loadContext: () => Promise<ReleaseInstallContext | null>;
  readStored: () => Promise<StoredReleaseDoctoolsImage | null>;
  writeStored: (value: StoredReleaseDoctoolsImage) => Promise<void>;
  clearStored: () => Promise<void>;
  runDocker: DoctoolsDockerRunner;
  now: () => Date;
  logger: Pick<Console, "log" | "warn">;
};

/**
 * `ghcr.io/<owner>/dpf-doctools:<tag>` for an install on an immutable release
 * tag, or null. A moving tag (`latest`) is refused so the stored pin always
 * names exactly one release's bytes.
 */
export function doctoolsReleaseReference(context: ReleaseInstallContext): string | null {
  if (!RELEASE_IMAGE_TAG.test(context.imageTag) || !REGISTRY_OWNER.test(context.ghcrOwner)) return null;
  return `${REGISTRY}/${context.ghcrOwner.toLowerCase()}/${DOCTOOLS_IMAGE_NAME}:${context.imageTag}`;
}

/** The manifest digest from `imagetools inspect --format '{{json .Manifest}}'`. */
export function parseImagetoolsDigest(stdout: string): string | null {
  try {
    const digest = (JSON.parse(stdout.trim()) as { digest?: unknown })?.digest;
    return typeof digest === "string" && SHA_256.test(digest) ? digest : null;
  } catch {
    return null;
  }
}

export function parseStoredReleaseDoctoolsImage(value: unknown): StoredReleaseDoctoolsImage | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.image !== "string" || !isPinnedImageReference(record.image)) return null;
  if (typeof record.releaseTag !== "string" || !record.releaseTag) return null;
  return {
    image: record.image,
    releaseTag: record.releaseTag,
    ...(typeof record.resolvedAt === "string" ? { resolvedAt: record.resolvedAt } : {}),
  };
}

async function tryDocker(run: DoctoolsDockerRunner, args: string[], timeoutMs: number): Promise<DoctoolsDockerResult> {
  try {
    return await run(args, { timeoutMs });
  } catch (error) {
    return { exitCode: 127, stdout: "", stderr: getErrorMessage(error) };
  }
}

/** Resolve the release's dpf-doctools tag to `name@sha256:…`, without pulling. */
export async function resolveReleaseDoctoolsImage(
  context: ReleaseInstallContext,
  runDocker: DoctoolsDockerRunner,
): Promise<ReleaseDoctoolsResolution> {
  const reference = doctoolsReleaseReference(context);
  if (!reference) return { kind: "unavailable", detail: "no immutable release reference" };
  const result = await tryDocker(
    runDocker,
    ["buildx", "imagetools", "inspect", reference, "--format", "{{json .Manifest}}"],
    INSPECT_TIMEOUT_MS,
  );
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout).trim().slice(-300);
    return NOT_PUBLISHED.test(detail) ? { kind: "not-published" } : { kind: "unavailable", detail };
  }
  const digest = parseImagetoolsDigest(result.stdout);
  if (!digest) return { kind: "unavailable", detail: "imagetools returned no sha256 manifest digest" };
  return { kind: "published", image: `${reference.slice(0, reference.lastIndexOf(":"))}@${digest}` };
}

/** Pull the pinned image unless it is already present. True when a pull landed. */
async function ensurePulled(deps: DoctoolsReconcileDeps, image: string): Promise<boolean> {
  const present = await tryDocker(deps.runDocker, ["image", "inspect", "--format", "{{.Id}}", image], INSPECT_TIMEOUT_MS);
  if (present.exitCode === 0) return false;
  const pull = await tryDocker(deps.runDocker, ["pull", image], PULL_TIMEOUT_MS);
  if (pull.exitCode !== 0) {
    deps.logger.warn(`[doctools-image] pull of ${image} did not complete; the next tick retries: ${(pull.stderr || pull.stdout).trim().slice(-200)}`);
    return false;
  }
  deps.logger.log(`[doctools-image] pulled ${image}`);
  return true;
}

export async function reconcileReleaseDoctoolsImage(deps: DoctoolsReconcileDeps): Promise<DoctoolsReconcileOutcome> {
  try {
    const context = await deps.loadContext();
    if (!context || !doctoolsReleaseReference(context)) return { outcome: "not-release-install" };
    const stored = await deps.readStored();
    if (stored && stored.releaseTag === context.imageTag) {
      return { outcome: "unchanged", image: stored.image, pulled: await ensurePulled(deps, stored.image) };
    }
    const resolution = await resolveReleaseDoctoolsImage(context, deps.runDocker);
    if (resolution.kind === "not-published") {
      if (stored) await deps.clearStored();
      deps.logger.log(`[doctools-image] release ${context.imageTag} published no ${DOCTOOLS_IMAGE_NAME}; office conversion stays off`);
      return { outcome: "not-published" };
    }
    if (resolution.kind === "unavailable") {
      deps.logger.warn(`[doctools-image] could not resolve ${DOCTOOLS_IMAGE_NAME} for ${context.imageTag}; keeping the prior state: ${resolution.detail}`);
      return { outcome: "unavailable", detail: resolution.detail };
    }
    await deps.writeStored({ image: resolution.image, releaseTag: context.imageTag, resolvedAt: deps.now().toISOString() });
    deps.logger.log(`[doctools-image] ${context.imageTag} -> ${resolution.image}`);
    return { outcome: "resolved", image: resolution.image, pulled: await ensurePulled(deps, resolution.image) };
  } catch (error) {
    const detail = getErrorMessage(error);
    deps.logger.warn(`[doctools-image] reconcile failed (non-fatal): ${detail}`);
    return { outcome: "error", detail };
  }
}

/** The release-resolved pin, or undefined. Read by resolveDoctoolsImage(). */
export async function readReleaseDoctoolsImage(): Promise<string | undefined> {
  return (await readStoredFromDb())?.image;
}

async function readStoredFromDb(): Promise<StoredReleaseDoctoolsImage | null> {
  const { prisma } = await import("@dpf/db");
  const row = await prisma.platformConfig.findUnique({ where: { key: DOCTOOLS_RELEASE_IMAGE_KEY } });
  return parseStoredReleaseDoctoolsImage(row?.value ?? null);
}

function productionDeps(): DoctoolsReconcileDeps {
  return {
    // The same host-source resolution the self-upgrade worker uses.
    loadContext: async () => {
      const { getSelfUpgradeConfig } = await import("./config");
      const config = await getSelfUpgradeConfig();
      const hostSourcePath =
        config.hostSourceMountPath ??
        process.env.DPF_SELF_UPGRADE_HOST_SOURCE_MOUNT ??
        process.env.HOST_SOURCE_PATH ??
        "/host-dpf";
      return loadReleaseInstallContext({ hostSourcePath });
    },
    readStored: readStoredFromDb,
    writeStored: async (value) => {
      const { prisma } = await import("@dpf/db");
      await prisma.platformConfig.upsert({
        where: { key: DOCTOOLS_RELEASE_IMAGE_KEY },
        update: { value },
        create: { key: DOCTOOLS_RELEASE_IMAGE_KEY, value },
      });
    },
    clearStored: async () => {
      const { prisma } = await import("@dpf/db");
      await prisma.platformConfig.deleteMany({ where: { key: DOCTOOLS_RELEASE_IMAGE_KEY } });
    },
    runDocker: (args, options) =>
      runProcessWithBudget("docker", args, {
        timeoutMs: options?.timeoutMs ?? INSPECT_TIMEOUT_MS,
        timeoutLabel: "doctools-image-timeout",
      }),
    now: () => new Date(),
    logger: console,
  };
}

let inFlight: Promise<DoctoolsReconcileOutcome> | undefined;

/** One reconcile at a time: a long pull must not overlap the next tick. */
export function runDoctoolsReleaseImageReconcile(): Promise<DoctoolsReconcileOutcome> {
  inFlight ??= reconcileReleaseDoctoolsImage(productionDeps()).finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}

/** Boot reconcile, plus a periodic net. Called once from instrumentation.ts. */
export function startDoctoolsReleaseImageReconciler(): void {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;
  void runDoctoolsReleaseImageReconcile();
  setInterval(() => void runDoctoolsReleaseImageReconcile(), DOCTOOLS_RECONCILE_INTERVAL_MS).unref?.();
}
