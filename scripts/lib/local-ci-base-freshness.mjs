import { fetchOriginMainSharedSafe } from "./git-fetch-shared-safe.mjs";

export const LOCAL_CI_BASE_FRESHNESS = Object.freeze({
  remoteCurrent: "remote-current",
  offlineAccepted: "offline-accepted",
  fetchFailed: "fetch-failed",
});

export function resolveBaseFreshnessPolicy({
  argv = [],
  env = {},
  baseRef = "origin/main",
} = {}) {
  const offline = argv.includes("--offline-accepted-base")
    || env.DPF_LOCAL_CI_OFFLINE_ACCEPTED_BASE === "1";
  const explicitFetch = argv.includes("--fetch-base")
    || env.DPF_LOCAL_CI_FETCH_BASE === "1";
  if (offline && explicitFetch) {
    throw new Error("--offline-accepted-base conflicts with --fetch-base");
  }
  if (!offline && baseRef !== "origin/main") {
    throw new Error(
      `online base freshness only supports origin/main; pass --offline-accepted-base to accept local ref ${baseRef}`,
    );
  }
  return {
    mode: offline ? "offline-accepted" : "remote-required",
    fetchRequired: !offline,
  };
}

export function refreshAcceptedBase({
  policy,
  baseRef,
  cwd,
  runGit,
  now = () => new Date(),
}) {
  const resolvedAt = now().toISOString();
  if (policy.mode === "offline-accepted") {
    const baseSha = runGit(["rev-parse", "--verify", baseRef], cwd).trim();
    if (!baseSha) throw new Error(`accepted base ref not found locally: ${baseRef}`);
    return {
      status: LOCAL_CI_BASE_FRESHNESS.offlineAccepted,
      baseSha,
      resolvedAt,
      fetchMode: null,
      error: null,
    };
  }

  try {
    const fetch = fetchOriginMainSharedSafe((args) => runGit(args, cwd));
    const baseSha = runGit(["rev-parse", "--verify", baseRef], cwd).trim();
    if (!baseSha) throw new Error(`ref ${baseRef} did not resolve after fetch`);
    return {
      status: LOCAL_CI_BASE_FRESHNESS.remoteCurrent,
      baseSha,
      resolvedAt,
      fetchMode: fetch.mode,
      error: null,
    };
  } catch (error) {
    return {
      status: LOCAL_CI_BASE_FRESHNESS.fetchFailed,
      baseSha: null,
      resolvedAt,
      fetchMode: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function classifyBaseResilience(contentMetadata, publicationMode = "deferred") {
  const acceptedBaseMode = contentMetadata?.baseFreshness?.status
    ?? (contentMetadata
      ? (contentMetadata.fetchBase === true ? "fetch-base" : "local-ref")
      : "unknown");
  return {
    publicationMode,
    acceptedBaseMode,
    networkTolerance: acceptedBaseMode === LOCAL_CI_BASE_FRESHNESS.offlineAccepted
      ? "explicit-offline"
      : acceptedBaseMode === "local-ref"
        ? "offline-capable"
        : "network-required",
  };
}
