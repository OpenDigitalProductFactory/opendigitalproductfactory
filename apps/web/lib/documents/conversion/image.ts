// Where the dpf-doctools image reference comes from (BI-52E565DA).
//
// The same channel as the self-upgrade promoter's `promoterImage`: the
// `self_upgrade` PlatformConfig row (`doctoolsImage`), seeded from
// DPF_DOCTOOLS_IMAGE, with the process environment as the fallback. There is no
// hardcoded default: a converter that would run an unpinned or guessed image is
// reported unavailable instead.

import { isPinnedImageReference } from "./command";

export type DoctoolsImageResolution =
  | { status: "pinned"; image: string }
  | { status: "not-configured" }
  | { status: "unpinned"; image: string };

export type DoctoolsImageSources = {
  loadConfiguredImage?: () => Promise<string | undefined>;
  env?: Record<string, string | undefined>;
};

async function loadFromPlatformConfig(): Promise<string | undefined> {
  const { getSelfUpgradeConfig } = await import("@/lib/self-upgrade/config");
  return (await getSelfUpgradeConfig()).doctoolsImage;
}

export async function resolveDoctoolsImage(sources: DoctoolsImageSources = {}): Promise<DoctoolsImageResolution> {
  const load = sources.loadConfiguredImage ?? loadFromPlatformConfig;
  const env = sources.env ?? process.env;
  let configured: string | undefined;
  try {
    configured = (await load())?.trim() || undefined;
  } catch {
    // An unreadable config row falls through to the environment; the converter
    // must not fail differently because the database blinked.
    configured = undefined;
  }
  const image = configured ?? (env.DPF_DOCTOOLS_IMAGE?.trim() || undefined);
  if (!image) return { status: "not-configured" };
  return isPinnedImageReference(image) ? { status: "pinned", image } : { status: "unpinned", image };
}
