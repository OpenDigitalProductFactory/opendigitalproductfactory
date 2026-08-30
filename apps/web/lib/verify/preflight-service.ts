// Server-side preflight service — the IO behind the verify_live_install_readiness
// MCP tool, so Build Studio and in-portal coworkers hit the IDENTICAL verdict the
// CLI surfaces (pnpm verify:preflight) use.
//
// Spec: docs/superpowers/specs/2026-06-06-procedural-functional-verification-design.md (§3.1, §6 slice 5)
// BI-85433710 (surface-agnostic). BI-08BE758C: actionable ancestry failures.

import { readImageVersion, type ImageVersion } from "@/lib/platform/image-version";
import {
  readInstallHostProfile,
  type InstallHostProfile,
} from "@/lib/install/host-profile";
import {
  computePreflightVerdict,
  gitIdentitiesMatch,
  type PreflightResult,
} from "@/lib/verify/preflight";
import {
  ancestryFailureDetail,
  resolveGitAncestry,
  type AncestryFailureKind,
} from "@/lib/verify/git-ancestry";
import { resolveProviderAncestry } from "@/lib/verify/provider-ancestry";

export type ReadinessDeps = {
  /** The live install's served identity (the portal's own image marker). */
  readImage: () => Promise<ImageVersion | null>;
  /** Server-owned, closed install provenance; callers cannot supply this. */
  readInstallHostProfile: () => Promise<InstallHostProfile>;
  /**
   * Whether `feature` is contained in (ancestor-or-equal of) `served`. Returns
   * null when it cannot be computed (git unavailable, commit not present).
   * Optional failureKind powers actionable nextAction text (BI-08BE758C).
   */
  isAncestor: (
    feature: string,
    served: string,
  ) => Promise<boolean | null | { contained: boolean | null; failureKind?: AncestryFailureKind }>;
  /** Canonical repository fallback for validated source-free consumers only. */
  isAncestorFromProvider: (feature: string, served: string) => Promise<boolean | null>;
};

/** Real ancestry check; never throws — returns null on any failure. */
export async function gitAncestry(
  feature: string,
  served: string,
): Promise<{ contained: boolean | null; failureKind?: AncestryFailureKind }> {
  return resolveGitAncestry(feature, served);
}

export const defaultReadinessDeps: ReadinessDeps = {
  readImage: () => readImageVersion(),
  readInstallHostProfile: () => readInstallHostProfile(),
  isAncestor: gitAncestry,
  isAncestorFromProvider: resolveProviderAncestry,
};

/**
 * Resolve the live-install readiness verdict for a feature commit. Pure
 * orchestration over injected IO — the verdict itself comes from the shared
 * computePreflightVerdict so every surface is identical.
 */
export async function resolveLiveInstallReadiness(
  params: { featureSha: string },
  deps: ReadinessDeps = defaultReadinessDeps,
): Promise<PreflightResult> {
  const [servedImage, installHostProfile] = await Promise.all([
    deps.readImage(),
    deps.readInstallHostProfile(),
  ]);
  // This code runs inside the portal, so the install is reachable by definition;
  // a null image means "not a built image" (dev/test), which the core maps to
  // BLOCKED.
  let featureContainedInServed: boolean | null = null;
  let ancestryUncomputableDetail: string | undefined;
  if (
    servedImage &&
    servedImage.source === "git-sha" &&
    !gitIdentitiesMatch(servedImage.raw, params.featureSha)
  ) {
    const raw = await deps.isAncestor(params.featureSha, servedImage.raw);
    if (typeof raw === "boolean" || raw === null) {
      featureContainedInServed = raw;
      if (raw === null) {
        ancestryUncomputableDetail = ancestryFailureDetail("unknown");
      }
    } else {
      featureContainedInServed = raw.contained;
      if (raw.contained === null) {
        ancestryUncomputableDetail = ancestryFailureDetail(raw.failureKind ?? "unknown");
      }
    }
  }

  if (
    servedImage
    && servedImage.source === "git-sha"
    && featureContainedInServed === null
    && installHostProfile.kind === "consumer"
    && !gitIdentitiesMatch(servedImage.raw, params.featureSha)
  ) {
    featureContainedInServed = await deps.isAncestorFromProvider(
      params.featureSha,
      servedImage.raw,
    );
  }

  return computePreflightVerdict({
    portalReachable: true,
    servedImage,
    featureSha: params.featureSha,
    featureContainedInServed,
    installHostKind: installHostProfile.kind,
    ancestryUncomputableDetail,
  });
}
