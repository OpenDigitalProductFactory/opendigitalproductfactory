// Customizable (source-built) installs resolve the dpf-doctools image from the
// release their clone descends from (BI-4E18BC28, slice s9a of the office
// document engine).
//
// A customizable install (`install-dpf.ps1` option [2], `install-dpf.sh
// --contributor`) builds the portal from a git clone, so it has no immutable
// DPF_IMAGE_TAG and parseReleaseInstallContext() refuses it on purpose: that
// context also decides the upgrade strategy, and a source install must keep
// upgrading from source. What it does have is its release lineage. Every
// from-source build (the installers, scripts/build-images.*, promote.sh) bakes
// `git describe --tags --always` into the image as DPF_PLATFORM_VERSION, e.g.
// `2026.09.25-shape-raise.1-35-gbcaa30a8`: the nearest release tag the built
// HEAD descends from, the commit distance, and the commit. publish-image.yml
// publishes dpf-doctools under every `v*` tag, so that tag names a published,
// digest-recorded image the install can pin exactly as a release install does.
//
// A source upgrade re-stamps the version (promote.sh), so the next boot sees
// the new lineage and re-resolves the pin: the setting survives upgrade.
//
// Where no published image is reachable (offline, air-gapped, a lineage that
// predates dpf-doctools, a fork whose owner publishes nothing), the install
// builds Dockerfile.doctools from its own clone and pins the local image id.
// The build context is a scratch copy of the two inputs the Dockerfile reads,
// never the whole clone.

import { cp, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { RELEASE_IMAGE_TAG } from "./registry-release";

export type SourceLineageContext = Readonly<{
  /** The release tag the build descends from, `v`-prefixed. */
  imageTag: string;
  ghcrOwner: string;
  /** The clone the portal was built from, as mounted in the portal. */
  sourceRoot: string;
}>;

export type LocalDoctoolsBuildResult =
  | { ok: true; image: string }
  | { ok: false; detail: string };

type DockerRunner = (
  args: string[],
  options?: { timeoutMs?: number },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export const DOCTOOLS_DOCKERFILE = "Dockerfile.doctools";
export const DOCTOOLS_SOURCE_DIR = "tools/doctools";
export const LOCAL_DOCTOOLS_TAG = "dpf-doctools:local";
const LOCAL_BUILD_TIMEOUT_MS = 30 * 60 * 1000;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
// `git describe` appends `-<commits since the tag>-g<abbreviated sha>` when HEAD
// is not exactly on the tag.
const DESCRIBE_DISTANCE = /-\d+-g[0-9a-f]{4,40}$/;

/**
 * The release tag a `git describe --tags --always` platform version descends
 * from, or null. A bare commit (no tag reachable) and anything that is not an
 * immutable release tag yield null.
 */
export function releaseTagFromPlatformVersion(version: string | null | undefined): string | null {
  const trimmed = version?.trim();
  if (!trimmed) return null;
  const base = trimmed.replace(/-dirty$/, "").replace(DESCRIBE_DISTANCE, "");
  const tag = base.startsWith("v") ? base : `v${base}`;
  return RELEASE_IMAGE_TAG.test(tag) ? tag : null;
}

export async function loadSourceLineageContext(input: {
  hostSourcePath: string;
  readPlatformVersion: () => Promise<string | null>;
  env?: Record<string, string | undefined>;
}): Promise<SourceLineageContext | null> {
  const env = input.env ?? process.env;
  const ghcrOwner = env.GHCR_OWNER?.trim();
  if (!ghcrOwner) return null;
  let version: string | null = null;
  try {
    version = await input.readPlatformVersion();
  } catch {
    return null;
  }
  const imageTag = releaseTagFromPlatformVersion(version);
  if (!imageTag) return null;
  return Object.freeze({ imageTag, ghcrOwner, sourceRoot: input.hostSourcePath.replace(/\/$/, "") });
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** The last line of `docker build -q`: the built image id. */
export function parseBuiltImageId(stdout: string): string | null {
  const last = stdout.trim().split(/\r?\n/).at(-1)?.trim() ?? "";
  return IMAGE_ID.test(last) ? last : null;
}

/**
 * Build Dockerfile.doctools from the install's clone and return its image id
 * (`sha256:…`), which the converter accepts as a pinned reference.
 */
export async function buildLocalDoctoolsImage(input: {
  sourceRoot: string;
  imageTag: string;
  runDocker: DockerRunner;
  scratchRoot?: string;
}): Promise<LocalDoctoolsBuildResult> {
  const dockerfile = join(input.sourceRoot, DOCTOOLS_DOCKERFILE);
  const sources = join(input.sourceRoot, DOCTOOLS_SOURCE_DIR);
  if (!(await exists(dockerfile)) || !(await exists(sources))) {
    return { ok: false, detail: `${input.sourceRoot} has no ${DOCTOOLS_DOCKERFILE}` };
  }
  let context: string | undefined;
  try {
    context = await mkdtemp(join(input.scratchRoot ?? tmpdir(), "dpf-doctools-build-"));
    await cp(dockerfile, join(context, DOCTOOLS_DOCKERFILE));
    await cp(sources, join(context, DOCTOOLS_SOURCE_DIR), { recursive: true });
    const result = await input.runDocker(
      [
        "build",
        "--quiet",
        "--file",
        join(context, DOCTOOLS_DOCKERFILE),
        "--build-arg",
        `DPF_VERSION=${input.imageTag}`,
        "--tag",
        LOCAL_DOCTOOLS_TAG,
        context,
      ],
      { timeoutMs: LOCAL_BUILD_TIMEOUT_MS },
    );
    if (result.exitCode !== 0) {
      return { ok: false, detail: (result.stderr || result.stdout).trim().slice(-300) || `exit ${result.exitCode}` };
    }
    const image = parseBuiltImageId(result.stdout);
    return image ? { ok: true, image } : { ok: false, detail: "docker build printed no image id" };
  } catch (error) {
    return { ok: false, detail: getErrorMessage(error) };
  } finally {
    if (context) await rm(context, { recursive: true, force: true }).catch(() => undefined);
  }
}
