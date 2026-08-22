import {
  readLatestReleaseStamp,
  type ReleaseStampStatus,
  type ReleaseRunsResult,
} from "@/lib/release-health/release-runs-reader";
import type { UpgradeSourceMode } from "./config";
import { readFile } from "node:fs/promises";

export type ReleaseInstallContext = Readonly<{
  installMode: "consumer" | "customer";
  imageTag: string;
  installPath: string;
  composeFiles: string[];
  ghcrOwner: string;
}>;

type ReleaseStateInput = {
  state: unknown;
  markerMode: string | null;
  env: Record<string, string | undefined>;
};

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function releaseMode(value: unknown): "consumer" | "customer" | null {
  return value === "consumer" || value === "customer" ? value : null;
}

function composeFiles(value: unknown, fallback?: string): string[] {
  const recorded = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())).map((entry) => entry.trim())
    : [];
  if (recorded.length > 0) return recorded;
  return fallback?.split(/\s+/).filter(Boolean) ?? [];
}

/**
 * Resolve the release identity recorded by the installer. The marker/env
 * fallbacks are deliberately narrow compatibility inputs for installs created
 * before install-state convergence was complete; new installs are state-first.
 */
export function parseReleaseInstallContext(input: ReleaseStateInput): ReleaseInstallContext | null {
  const state = input.state && typeof input.state === "object"
    ? input.state as Record<string, unknown>
    : {};
  const installMode = releaseMode(state.installMode) ?? releaseMode(input.markerMode);
  if (!installMode) return null;
  const imageTag = nonEmpty(state.imageTag) ?? nonEmpty(input.env.DPF_IMAGE_TAG);
  const installPath = nonEmpty(state.installPath) ?? nonEmpty(input.env.DPF_HOST_INSTALL_PATH);
  const ghcrOwner = nonEmpty(input.env.GHCR_OWNER);
  const recordedFiles = composeFiles(state.composeFiles, input.env.DPF_SELF_UPGRADE_COMPOSE_FILES);
  const files = recordedFiles.length > 0
    ? recordedFiles
    : ["docker-compose.yml", "docker-compose.release.yml"];
  if (!imageTag || !installPath || !ghcrOwner || files.length === 0) return null;
  return Object.freeze({ installMode, imageTag, installPath, composeFiles: files, ghcrOwner });
}

export async function loadReleaseInstallContext(input: {
  hostSourcePath: string;
  env?: Record<string, string | undefined>;
  readText?: (path: string) => Promise<string>;
}): Promise<ReleaseInstallContext | null> {
  const readText = input.readText ?? ((path: string) => readFile(path, "utf8"));
  let state: unknown = {};
  let markerMode: string | null = null;
  try {
    state = JSON.parse((await readText("/dpf-state/install-state.json")).replace(/^\uFEFF/, ""));
  } catch {
    // Compatibility marker below can still identify a pre-convergence consumer.
  }
  try {
    markerMode = (await readText(`${input.hostSourcePath.replace(/\/$/, "")}/.install-mode`)).trim();
  } catch {
    // A complete install-state does not require the compatibility marker.
  }
  return parseReleaseInstallContext({ state, markerMode, env: input.env ?? process.env });
}

export type UpgradeStrategy = "source" | "release";

export function resolveUpgradeStrategy(
  sourceMode: UpgradeSourceMode,
  release: ReleaseInstallContext | null,
): UpgradeStrategy {
  return sourceMode === "upstream" && release ? "release" : "source";
}

type LatestRelease = {
  tag: string;
  headSha: string | null;
  status: ReleaseStampStatus;
};

export type ReleaseTargetResult =
  | { kind: "target"; tag: string; sourceSha: string }
  | { kind: "up-to-date"; tag: string; sourceSha: string }
  | { kind: "no-published-target"; reason: ReleaseStampStatus | "missing" | "source-sha-missing" };

export function resolveReleaseTarget(input: {
  currentImageTag: string;
  currentSourceSha: string | null;
  latest: LatestRelease | null;
}): ReleaseTargetResult {
  if (!input.latest) return { kind: "no-published-target", reason: "missing" };
  if (input.latest.status !== "verified") {
    return { kind: "no-published-target", reason: input.latest.status };
  }
  if (!input.latest.headSha || !/^[a-f0-9]{40}$/i.test(input.latest.headSha)) {
    return { kind: "no-published-target", reason: "source-sha-missing" };
  }
  const candidate = { tag: input.latest.tag, sourceSha: input.latest.headSha };
  if (
    input.currentImageTag === candidate.tag ||
    input.currentSourceSha?.toLowerCase() === candidate.sourceSha.toLowerCase()
  ) {
    return { kind: "up-to-date", ...candidate };
  }
  return { kind: "target", ...candidate };
}

export async function resolveReleaseUpgradeCandidate(
  input: { context: ReleaseInstallContext; currentSourceSha: string | null },
  readLatest: () => Promise<ReleaseRunsResult> = readLatestReleaseStamp,
): Promise<ReleaseTargetResult> {
  const releases = await readLatest();
  if (!releases.ok) return { kind: "no-published-target", reason: "missing" };
  return resolveReleaseTarget({
    currentImageTag: input.context.imageTag,
    currentSourceSha: input.currentSourceSha,
    latest: releases.latest,
  });
}
