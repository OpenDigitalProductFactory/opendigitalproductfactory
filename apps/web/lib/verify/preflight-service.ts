// Server-side preflight service — the IO behind the verify_live_install_readiness
// MCP tool, so Build Studio and in-portal coworkers hit the IDENTICAL verdict the
// CLI surfaces (pnpm verify:preflight) use.
//
// Spec: docs/superpowers/specs/2026-06-06-procedural-functional-verification-design.md (§3.1, §6 slice 5)
// BI-85433710 (surface-agnostic).
//
// The verdict logic stays single-sourced in computePreflightVerdict; this only
// supplies the IO: the portal's own served identity (readImageVersion, same
// process) and best-effort git ancestry. Dependencies are injected so the
// orchestration is unit-testable without fs/git.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readImageVersion, type ImageVersion } from "@/lib/platform/image-version";
import {
  computePreflightVerdict,
  type PreflightResult,
} from "@/lib/verify/preflight";

const execFileAsync = promisify(execFile);

export type ReadinessDeps = {
  /** The live install's served identity (the portal's own image marker). */
  readImage: () => Promise<ImageVersion | null>;
  /**
   * Whether `feature` is contained in (ancestor-or-equal of) `served`. Returns
   * null when it cannot be computed (git unavailable, commit not present).
   */
  isAncestor: (feature: string, served: string) => Promise<boolean | null>;
};

/** Real ancestry check; never throws — returns null on any failure. */
export async function gitAncestry(
  feature: string,
  served: string,
): Promise<boolean | null> {
  if (feature.toLowerCase() === served.toLowerCase()) return true; // equal ⇒ contained
  try {
    await execFileAsync("git", ["merge-base", "--is-ancestor", feature, served]);
    return true; // exit 0 ⇒ ancestor
  } catch (err) {
    const code = (err as { code?: number }).code;
    return code === 1 ? false : null; // 1 ⇒ not ancestor; else uncomputable
  }
}

export const defaultReadinessDeps: ReadinessDeps = {
  readImage: () => readImageVersion(),
  isAncestor: gitAncestry,
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
  const servedImage = await deps.readImage();
  // This code runs inside the portal, so the install is reachable by definition;
  // a null image means "not a built image" (dev/test), which the core maps to
  // BLOCKED.
  const featureContainedInServed =
    servedImage && servedImage.source === "git-sha"
      ? await deps.isAncestor(params.featureSha, servedImage.raw)
      : null;

  return computePreflightVerdict({
    portalReachable: true,
    servedImage,
    featureSha: params.featureSha,
    featureContainedInServed,
  });
}
