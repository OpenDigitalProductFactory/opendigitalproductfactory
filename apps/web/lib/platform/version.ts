import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { readImageVersion } from "./image-version";

export type PlatformVersion = {
  version: string;
  publishedAt: Date;
  gitSha: string | null;
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
      const image = await readImageVersion();
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
