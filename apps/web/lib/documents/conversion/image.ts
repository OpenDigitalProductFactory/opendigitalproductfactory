// Where the dpf-doctools image reference comes from (BI-52E565DA).
//
// Precedence, first match wins:
//   1. the operator's `self_upgrade` PlatformConfig row (`doctoolsImage`),
//      seeded from DPF_DOCTOOLS_IMAGE;
//   2. the process environment (DPF_DOCTOOLS_IMAGE);
//   3. on a release install, the pin resolved from the release tag, the way
//      the promoter's is (`self_upgrade.doctoolsImage`, written by
//      lib/self-upgrade/doctools-release-image.ts, BI-9A2EC54A).
// There is no hardcoded default: a converter that would run an unpinned or
// guessed image is reported unavailable instead.

import { isPinnedImageReference } from "./command";

export type DoctoolsImageResolution =
  | { status: "pinned"; image: string }
  | { status: "not-configured" }
  | { status: "unpinned"; image: string };

export type DoctoolsImageSources = {
  loadConfiguredImage?: () => Promise<string | undefined>;
  loadReleaseImage?: () => Promise<string | undefined>;
  env?: Record<string, string | undefined>;
};

async function loadFromPlatformConfig(): Promise<string | undefined> {
  const { getSelfUpgradeConfig } = await import("@/lib/self-upgrade/config");
  return (await getSelfUpgradeConfig()).doctoolsImage;
}

async function loadReleaseResolved(): Promise<string | undefined> {
  const { readReleaseDoctoolsImage } = await import("@/lib/self-upgrade/doctools-release-image");
  return readReleaseDoctoolsImage();
}

// An unreadable row reads as unset; the converter must not fail differently
// because the database blinked.
async function readOptional(load: () => Promise<string | undefined>): Promise<string | undefined> {
  try {
    return (await load())?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function resolveDoctoolsImage(sources: DoctoolsImageSources = {}): Promise<DoctoolsImageResolution> {
  const env = sources.env ?? process.env;
  const image =
    (await readOptional(sources.loadConfiguredImage ?? loadFromPlatformConfig)) ??
    (env.DPF_DOCTOOLS_IMAGE?.trim() || undefined) ??
    (await readOptional(sources.loadReleaseImage ?? loadReleaseResolved));
  if (!image) return { status: "not-configured" };
  return isPinnedImageReference(image) ? { status: "pinned", image } : { status: "unpinned", image };
}
