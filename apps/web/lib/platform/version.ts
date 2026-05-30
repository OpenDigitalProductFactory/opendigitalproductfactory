import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  readImageBuiltAt,
  readImageVersion,
  readSourceContentHash,
  type ImageVersion,
} from "./image-version";

export type PlatformVersion = {
  version: string;
  publishedAt: Date;
  /**
   * Comparable git SHA for the running image — preferred for freshness
   * comparison and `compare_versions` lookups. Null when the image was built
   * without a git-SHA build arg (image-version is a content hash) and no
   * deploy pipeline set DEPLOYED_SHA.
   */
  gitSha: string | null;
  /**
   * Always populated when the running portal was built from a Dockerfile —
   * the literal contents of /app/.dpf-image-version plus a classification.
   * Use this for display when you want to show *some* identity even when no
   * git SHA is available.
   */
  imageVersion: ImageVersion | null;
  /**
   * ISO-8601 UTC timestamp baked into the image at build time
   * (/app/.dpf-image-built-at). Null in dev/test and pre-marker images.
   */
  buildDate: string | null;
  /**
   * sha256 of the bundled source bytes, baked into every image independent of
   * the gitSha/DPF_VERSION label (/app/.dpf-source-content-hash). The honest
   * fingerprint of what was actually built — surfaced so a label/source
   * divergence is observable (BI-C8E90A79). Null in dev/test and pre-marker images.
   */
  sourceContentHash: string | null;
  note: string | null;
};

let cached: Promise<PlatformVersion> | null = null;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Reads version.json from the repo root and returns the canonical platform
 * version. Memoized for the lifetime of the process. gitSha is read from
 * DEPLOYED_SHA when set, then from the existing image-version helper when
 * the baked image marker is a git SHA; null in dev/content-hash builds.
 *
 * See docs/superpowers/specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md §4.1
 */
export async function loadPlatformVersion(): Promise<PlatformVersion> {
  if (!cached) {
    cached = (async () => {
      const path = resolveVersionJsonPath();
      const raw = await readFile(path, "utf8");
      const parsed = parseVersionJson(JSON.parse(raw));
      const [image, buildDate, sourceContentHash] = await Promise.all([
        readImageVersion(),
        readImageBuiltAt(),
        readSourceContentHash(),
      ]);
      const envSha = process.env.DEPLOYED_SHA;
      return {
        version: parsed.version,
        publishedAt: new Date(parsed.publishedAt),
        gitSha:
          envSha && envSha.length > 0
            ? envSha
            : image?.source === "git-sha"
              ? image.raw
              : null,
        imageVersion: image,
        buildDate,
        sourceContentHash,
        note: parsed.note ?? null,
      };
    })();
  }
  return cached;
}

/** Test-only: reset the memoized value. */
export function resetPlatformVersionCacheForTests(): void {
  cached = null;
}

function parseVersionJson(raw: unknown): {
  version: string;
  publishedAt: string;
  note?: string;
} {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid platform version: version.json must be an object");
  }
  const value = raw as Record<string, unknown>;
  if (typeof value.version !== "string" || !SEMVER_RE.test(value.version)) {
    throw new Error("Invalid platform version: version must be SemVer");
  }
  if (
    typeof value.publishedAt !== "string" ||
    Number.isNaN(Date.parse(value.publishedAt))
  ) {
    throw new Error(
      "Invalid platform version: publishedAt must be an ISO timestamp",
    );
  }
  return {
    version: value.version,
    publishedAt: value.publishedAt,
    note: typeof value.note === "string" ? value.note : undefined,
  };
}

function resolveVersionJsonPath(): string {
  const candidates = [
    process.env.DPF_VERSION_FILE,
    resolve(process.cwd(), "version.json"),
    resolve(process.cwd(), "../../version.json"),
    "/app/version.json",
  ].filter((value): value is string => Boolean(value));

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`version.json not found; checked ${candidates.join(", ")}`);
  }
  return found;
}
