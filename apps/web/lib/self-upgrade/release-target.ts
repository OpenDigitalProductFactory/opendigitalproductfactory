import {
  readRegistryReleaseCandidate,
  type RegistryReleaseCandidate,
  type RegistryReleaseFailureReason,
  type RegistryReleaseReadResult,
} from "./registry-release";
import type { UpgradeSourceMode } from "./config";
import { readFile } from "node:fs/promises";

export type ReleaseInstallContext = Readonly<{
  installMode: "consumer" | "customer";
  imageTag: string;
  channelTag: string;
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

function releaseComposeFile(value: string): string | null {
  const file = value.trim().replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? "";
  return /^docker-compose(?:\.[A-Za-z0-9-]+)?\.ya?ml$/.test(file) ? file : null;
}

function composeFiles(value: unknown, fallback?: string): string[] {
  const recorded = Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map(releaseComposeFile)
        .filter((entry): entry is string => Boolean(entry))
    : [];
  if (recorded.length > 0) return recorded;
  return fallback
    ?.split(/\s+/)
    .map(releaseComposeFile)
    .filter((entry): entry is string => Boolean(entry)) ?? [];
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
  // The installed immutable tag is rollback identity, not the discovery channel.
  // promote.sh persists each successful immutable tag, while `latest` keeps moving.
  const channelTag = nonEmpty(input.env.DPF_IMAGE_CHANNEL_TAG) ?? "latest";
  const installPath = nonEmpty(state.installPath) ?? nonEmpty(input.env.DPF_HOST_INSTALL_PATH);
  const ghcrOwner = nonEmpty(input.env.GHCR_OWNER);
  const recordedFiles = composeFiles(state.composeFiles, input.env.DPF_SELF_UPGRADE_COMPOSE_FILES);
  const files = recordedFiles.length > 0
    ? recordedFiles
    : ["docker-compose.yml", "docker-compose.release.yml"];
  if (!imageTag || !installPath || !ghcrOwner || files.length === 0) return null;
  return Object.freeze({ installMode, imageTag, channelTag, installPath, composeFiles: files, ghcrOwner });
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

export type ReleaseTargetResult =
  | { kind: "target"; tag: string; sourceSha: string; channelDigest: string; platformManifestDigest: string; configDigest: string; platformOs: "linux"; platformArchitecture: string }
  | { kind: "up-to-date"; tag: string; sourceSha: string; channelDigest: string; platformManifestDigest: string; configDigest: string; platformOs: "linux"; platformArchitecture: string }
  | { kind: "no-published-target"; reason: RegistryReleaseFailureReason | "current-image-identity-missing" };

export function resolveReleaseTarget(input: {
  currentConfigDigest: string | null;
  candidate: RegistryReleaseCandidate | null;
  unavailableReason?: RegistryReleaseFailureReason;
}): ReleaseTargetResult {
  if (!input.candidate) {
    return { kind: "no-published-target", reason: input.unavailableReason ?? "registry-unavailable" };
  }
  if (!input.currentConfigDigest) {
    return { kind: "no-published-target", reason: "current-image-identity-missing" };
  }
  // Docker's `.Image` field is an immutable content identity, but its stratum
  // varies by image store: classic stores expose the config digest, while the
  // containerd store can expose the platform manifest or multi-arch index.
  // Registry discovery verifies and freezes all three identities, so matching
  // any one of them proves that the running bytes are the published candidate.
  const currentDigest = input.currentConfigDigest.toLowerCase();
  const candidateDigests = [
    input.candidate.configDigest,
    input.candidate.platformManifestDigest,
    input.candidate.channelDigest,
  ];
  if (candidateDigests.some((digest) => digest.toLowerCase() === currentDigest)) {
    return {
      kind: "up-to-date",
      tag: input.candidate.tag,
      sourceSha: input.candidate.sourceSha,
      channelDigest: input.candidate.channelDigest,
      platformManifestDigest: input.candidate.platformManifestDigest,
      configDigest: input.candidate.configDigest,
      platformOs: input.candidate.platformOs,
      platformArchitecture: input.candidate.platformArchitecture,
    };
  }
  return {
    kind: "target",
    tag: input.candidate.tag,
    sourceSha: input.candidate.sourceSha,
    channelDigest: input.candidate.channelDigest,
    platformManifestDigest: input.candidate.platformManifestDigest,
    configDigest: input.candidate.configDigest,
    platformOs: input.candidate.platformOs,
    platformArchitecture: input.candidate.platformArchitecture,
  };
}

export async function resolveReleaseUpgradeCandidate(
  input: {
    context: ReleaseInstallContext;
    currentConfigDigest: string | null;
  },
  readCandidate: (input: {
    owner: string;
    channelTag: string;
  }) => Promise<RegistryReleaseReadResult> = readRegistryReleaseCandidate,
): Promise<ReleaseTargetResult> {
  const release = await readCandidate({
    owner: input.context.ghcrOwner,
    channelTag: input.context.channelTag,
  });
  return resolveReleaseTarget({
    currentConfigDigest: input.currentConfigDigest,
    candidate: release.ok ? release.candidate : null,
    unavailableReason: release.ok ? undefined : release.reason,
  });
}
