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
// A customizable (source-built) install has no release context. It resolves
// the same published image from the release its clone descends from, and
// builds Dockerfile.doctools locally only when none is reachable
// (BI-4E18BC28, doctools-source-lineage.ts).
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
// Nothing in the reconciler can fail an upgrade or a boot:
//   - a release with no dpf-doctools manifest leaves the key unset (AC-3);
//   - an unreachable registry keeps the prior state for the next tick;
//   - a failed pull leaves the pin in place, and the next tick retries it.
//
// The reconciler is the safety net. The upgrade itself pulls the target
// release's image before the swap (prePullReleaseDoctoolsImage, called from the
// candidate preflight, BI-698B7F9A), and the installers pull it with the other
// release images, so the reconciler normally finds the digest already present.

import { isPinnedImageReference } from "@/lib/documents/conversion/command";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { runProcessWithBudget } from "@/lib/shared/run-process-with-budget";
import { RELEASE_IMAGE_TAG } from "./registry-release";
import { loadReleaseInstallContext, type ReleaseInstallContext } from "./release-target";
import {
  buildLocalDoctoolsImage,
  loadSourceLineageContext,
  type LocalDoctoolsBuildResult,
  type SourceLineageContext,
} from "./doctools-source-lineage";

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

/** The two facts that name a release's images: its immutable tag and GHCR owner. */
export type ReleaseImageIdentity = Pick<ReleaseInstallContext, "imageTag" | "ghcrOwner">;

export type StoredReleaseDoctoolsImage = {
  image: string;
  releaseTag: string;
  resolvedAt?: string;
  /** Absent on pins written before BI-4E18BC28, which were all published. */
  origin?: "published" | "local-build";
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
  | { outcome: "built-locally"; image: string }
  | { outcome: "not-published" }
  | { outcome: "unavailable"; detail: string }
  | { outcome: "error"; detail: string };

export type DoctoolsReconcileDeps = {
  loadContext: () => Promise<ReleaseInstallContext | null>;
  readStored: () => Promise<StoredReleaseDoctoolsImage | null>;
  writeStored: (value: StoredReleaseDoctoolsImage) => Promise<void>;
  clearStored: () => Promise<void>;
  runDocker: DoctoolsDockerRunner;
  /** A source-built install's release lineage; consulted only without a release context. */
  loadSourceLineage?: () => Promise<SourceLineageContext | null>;
  /** Build Dockerfile.doctools from the clone when no published image is reachable. */
  buildLocal?: (lineage: SourceLineageContext) => Promise<LocalDoctoolsBuildResult>;
  now: () => Date;
  logger: Pick<Console, "log" | "warn">;
};

/**
 * `ghcr.io/<owner>/dpf-doctools:<tag>` for an install on an immutable release
 * tag, or null. A moving tag (`latest`) is refused so the stored pin always
 * names exactly one release's bytes.
 */
export function doctoolsReleaseReference(context: ReleaseImageIdentity): string | null {
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
    ...(record.origin === "published" || record.origin === "local-build" ? { origin: record.origin } : {}),
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
  context: ReleaseImageIdentity,
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

async function isPresent(deps: DoctoolsReconcileDeps, image: string): Promise<boolean> {
  return (await tryDocker(deps.runDocker, ["image", "inspect", "--format", "{{.Id}}", image], INSPECT_TIMEOUT_MS)).exitCode === 0;
}

/** Pull the pinned image unless it is already present. True when a pull landed. */
async function ensurePulled(deps: DoctoolsReconcileDeps, image: string): Promise<boolean> {
  if (await isPresent(deps, image)) return false;
  const pull = await tryDocker(deps.runDocker, ["pull", image], PULL_TIMEOUT_MS);
  if (pull.exitCode !== 0) {
    deps.logger.warn(`[doctools-image] pull of ${image} did not complete; the next tick retries: ${(pull.stderr || pull.stdout).trim().slice(-200)}`);
    return false;
  }
  deps.logger.log(`[doctools-image] pulled ${image}`);
  return true;
}

type DoctoolsLineage = {
  imageTag: string;
  ghcrOwner: string;
  /** Set only for a source-built install, which may build the image itself. */
  source?: SourceLineageContext;
};

async function loadLineage(deps: DoctoolsReconcileDeps): Promise<DoctoolsLineage | null> {
  const release = await deps.loadContext();
  if (release) return doctoolsReleaseReference(release) ? release : null;
  const source = await deps.loadSourceLineage?.();
  return source && doctoolsReleaseReference(source) ? { ...source, source } : null;
}

/** Offline fallback for a source-built install: pin an image built from its own clone. */
async function buildLocally(
  deps: DoctoolsReconcileDeps,
  lineage: DoctoolsLineage,
  why: string,
): Promise<DoctoolsReconcileOutcome | null> {
  if (!lineage.source || !deps.buildLocal) return null;
  deps.logger.log(`[doctools-image] no published ${DOCTOOLS_IMAGE_NAME} reachable for ${lineage.imageTag} (${why}); building it from the install's source`);
  const built = await deps.buildLocal(lineage.source);
  if (!built.ok) {
    deps.logger.warn(`[doctools-image] local build of ${DOCTOOLS_IMAGE_NAME} did not complete; the next tick retries: ${built.error}`);
    return { outcome: "unavailable", detail: `local build failed: ${built.error}` };
  }
  await deps.writeStored({ image: built.data, releaseTag: lineage.imageTag, resolvedAt: deps.now().toISOString(), origin: "local-build" });
  deps.logger.log(`[doctools-image] ${lineage.imageTag} -> ${built.data} (built locally)`);
  return { outcome: "built-locally", image: built.data };
}

export type DoctoolsPrePullResult =
  | { outcome: "pulled" | "present"; image: string }
  | { outcome: "not-published" | "not-release" }
  | { outcome: "failed"; reason: string };

const tail = (result: DoctoolsDockerResult) => (result.stderr || result.stdout).trim().slice(-200);

/**
 * Make the TARGET release's dpf-doctools present before the swap
 * (BI-698B7F9A), so the new portal's first availability check finds it.
 *
 * Runs in the candidate preflight, beside the promoter pull, and writes no pin:
 * `self_upgrade.doctoolsImage` stays owned by the boot reconciler above, which
 * resolves the same immutable tag to the same digest and then finds it present.
 *
 * It pulls the release TAG, then confirms the resolved digest is present. A
 * tagged image is never "dangling", so the promoter's `docker image prune -f`
 * cleanup cannot remove it between this pull and the new portal's first boot.
 *
 * A release that never published dpf-doctools is not a failure: that release
 * is simply converter-less, and a missing optional image must never block an
 * upgrade (BI-E6EF0B2C). Anything else is a plain reason for the caller to
 * fail the run with, before the drain.
 */
export async function prePullReleaseDoctoolsImage(
  release: { tag: string; ghcrOwner: string },
  runDocker: DoctoolsDockerRunner = productionRunDocker,
): Promise<DoctoolsPrePullResult> {
  const identity = { imageTag: release.tag, ghcrOwner: release.ghcrOwner };
  const reference = doctoolsReleaseReference(identity);
  if (!reference) return { outcome: "not-release" };
  const resolution = await resolveReleaseDoctoolsImage(identity, runDocker);
  if (resolution.kind === "not-published") return { outcome: "not-published" };
  if (resolution.kind === "unavailable") {
    return { outcome: "failed", reason: `could not check the ${release.tag} document converter: ${resolution.detail}` };
  }
  const image = resolution.image;
  const isPresent = async () =>
    (await tryDocker(runDocker, ["image", "inspect", "--format", "{{.Id}}", image], INSPECT_TIMEOUT_MS)).exitCode === 0;
  if (await isPresent()) return { outcome: "present", image };
  let pull = await tryDocker(runDocker, ["pull", reference], PULL_TIMEOUT_MS);
  if (pull.exitCode === 0 && (await isPresent())) return { outcome: "pulled", image };
  // The tag did not land the recorded digest: pull the exact bytes instead.
  pull = await tryDocker(runDocker, ["pull", image], PULL_TIMEOUT_MS);
  if (pull.exitCode === 0 && (await isPresent())) return { outcome: "pulled", image };
  return { outcome: "failed", reason: `could not download the ${release.tag} document converter: ${tail(pull) || "the image is not present after the pull"}` };
}

export async function reconcileReleaseDoctoolsImage(deps: DoctoolsReconcileDeps): Promise<DoctoolsReconcileOutcome> {
  try {
    const lineage = await loadLineage(deps);
    if (!lineage) return { outcome: "not-release-install" };
    const stored = await deps.readStored();
    const sameLineage = stored?.releaseTag === lineage.imageTag ? stored : null;
    if (sameLineage && sameLineage.origin !== "local-build") {
      return { outcome: "unchanged", image: sameLineage.image, pulled: await ensurePulled(deps, sameLineage.image) };
    }
    // A local build is only the offline fallback, so each tick tries the published image again.
    const resolution = await resolveReleaseDoctoolsImage(lineage, deps.runDocker);
    if (resolution.kind !== "published" && sameLineage) {
      if (await isPresent(deps, sameLineage.image)) return { outcome: "unchanged", image: sameLineage.image, pulled: false };
      return (await buildLocally(deps, lineage, "the local image was removed")) ?? { outcome: "unavailable", detail: "local image removed" };
    }
    if (resolution.kind === "not-published") {
      const built = await buildLocally(deps, lineage, "not published");
      if (built) return built;
      if (stored) await deps.clearStored();
      deps.logger.log(`[doctools-image] release ${lineage.imageTag} published no ${DOCTOOLS_IMAGE_NAME}; office conversion stays off`);
      return { outcome: "not-published" };
    }
    if (resolution.kind === "unavailable") {
      const built = await buildLocally(deps, lineage, resolution.detail);
      if (built) return built;
      deps.logger.warn(`[doctools-image] could not resolve ${DOCTOOLS_IMAGE_NAME} for ${lineage.imageTag}; keeping the prior state: ${resolution.detail}`);
      return { outcome: "unavailable", detail: resolution.detail };
    }
    await deps.writeStored({ image: resolution.image, releaseTag: lineage.imageTag, resolvedAt: deps.now().toISOString(), origin: "published" });
    deps.logger.log(`[doctools-image] ${lineage.imageTag} -> ${resolution.image}`);
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

async function hostSourcePath(): Promise<string> {
  const { getSelfUpgradeConfig } = await import("./config");
  const config = await getSelfUpgradeConfig();
  return (
    config.hostSourceMountPath ??
    process.env.DPF_SELF_UPGRADE_HOST_SOURCE_MOUNT ??
    process.env.HOST_SOURCE_PATH ??
    "/host-dpf"
  );
}

function productionRunDocker(args: string[], options?: { timeoutMs?: number }): Promise<DoctoolsDockerResult> {
  return runProcessWithBudget("docker", args, {
    timeoutMs: options?.timeoutMs ?? INSPECT_TIMEOUT_MS,
    timeoutLabel: "doctools-image-timeout",
  });
}

function productionDeps(): DoctoolsReconcileDeps {
  return {
    // The same host-source resolution the self-upgrade worker uses.
    loadContext: async () => loadReleaseInstallContext({ hostSourcePath: await hostSourcePath() }),
    loadSourceLineage: async () => {
      const { readPlatformVersionTag } = await import("@/lib/platform/image-version");
      return loadSourceLineageContext({ hostSourcePath: await hostSourcePath(), readPlatformVersion: () => readPlatformVersionTag() });
    },
    buildLocal: (lineage) =>
      buildLocalDoctoolsImage({
        sourceRoot: lineage.sourceRoot,
        imageTag: lineage.imageTag,
        runDocker: (args, options) =>
          runProcessWithBudget("docker", args, {
            timeoutMs: options?.timeoutMs ?? INSPECT_TIMEOUT_MS,
            timeoutLabel: "doctools-image-build-timeout",
          }),
      }),
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
    runDocker: productionRunDocker,
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
