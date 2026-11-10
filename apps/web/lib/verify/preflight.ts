// Functional-verification preflight — the deterministic "can I trust this
// runtime to test against?" verdict.
//
// Spec: docs/superpowers/specs/2026-06-06-procedural-functional-verification-design.md
//
// This module is the executable FACT layer. It computes a verdict and changes
// nothing — separation of fact (this) from action (the dpf-verify-on-live-install
// skill) is the design's spine. The pure function below takes already-fetched
// inputs (the served image identity, reachability, the feature commit, and a
// pre-computed ancestry flag) so it is a total truth table under test: no fetch,
// no git, no fs here. The CLI shim (scripts/dpf-verify-preflight.mjs) and a later
// MCP tool do the IO and call this, so every surface branches on identical logic.
//
// Reuse, don't reinvent: the served-image shape and source classification come
// from @/lib/platform/image-version — the canonical home for image identity.

import type { ImageVersion, ImageVersionSource } from "@/lib/platform/image-version";
import type { InstallHostKind } from "@/lib/install/host-profile";

export type PreflightVerdict = "CAN-TEST" | "MUST-ADVANCE" | "BLOCKED";

export type PreflightNextActionKind =
  // CAN-TEST: the served bytes contain the feature commit; drive the happy path.
  | "drive-happy-path"
  // MUST-ADVANCE: the served bytes are behind / unprovable; the ONLY sanctioned
  // advance is the governed self-upgrade pipeline (AGENTS.md §5), then re-flight.
  | "trigger-self-upgrade"
  // BLOCKED: the governed path can't establish a testable runtime right now;
  // file a BI for the blocker and STOP — do not improvise an infra fix.
  | "file-blocker-bi";

/** Where the served identity came from, plus an "unreachable" sentinel. */
export type ServedSource = ImageVersionSource | "unreachable";

export type PreflightResult = {
  verdict: PreflightVerdict;
  /** Human-readable, single sentence; safe to put verbatim in a BI body. */
  reason: string;
  served: { sha: string | null; source: ServedSource };
  feature: { sha: string };
  nextAction: { kind: PreflightNextActionKind; detail: string };
};

export type PreflightInput = {
  /** Whether the portal responded at all. false => BLOCKED regardless of image. */
  portalReachable: boolean;
  /**
   * What the live install reports serving (from /api/platform/image-version),
   * or null when there is no image marker (e.g. a non-container `next dev`).
   */
  servedImage: ImageVersion | null;
  /** The commit the feature-under-test requires (branch HEAD or explicit SHA). */
  featureSha: string;
  /**
   * Whether `featureSha` is contained in (ancestor-or-equal of) the served SHA,
   * computed by the IO layer via `git merge-base --is-ancestor`. null when it
   * could not be computed — served source is not a git-sha, or git/the commit
   * was unavailable locally.
   */
  featureContainedInServed: boolean | null;
  /**
   * Closed server-derived install provenance. Only a validated consumer may
   * convert unavailable ancestry into the governed advance path.
   */
  installHostKind: InstallHostKind;
  /**
   * Optional operator-facing detail when featureContainedInServed is null
   * (BI-08BE758C) — e.g. missing DPF_REPO_ROOT, missing objects, no git.
   */
  ancestryUncomputableDetail?: string | null;
};

const SELF_UPGRADE_PATH = "/ops/self-upgrade";

/**
 * Compute the verdict. Total over every input combination — there is no path
 * that returns undefined or throws. See spec §3.1 for the decision tree.
 */
export function computePreflightVerdict(input: PreflightInput): PreflightResult {
  const { portalReachable, servedImage, featureSha, featureContainedInServed } =
    input;

  // 1. No reachable, identified runtime to test against → BLOCKED.
  if (!portalReachable) {
    return {
      verdict: "BLOCKED",
      reason: "Live install is unreachable; cannot verify against it.",
      served: { sha: null, source: "unreachable" },
      feature: { sha: featureSha },
      nextAction: {
        kind: "file-blocker-bi",
        detail:
          "Portal not serving. File a blocker BI (install down / not started) and stop the verification task.",
      },
    };
  }
  if (!servedImage) {
    return {
      verdict: "BLOCKED",
      reason:
        "Live install reports no image-version marker (not a built image); nothing to verify against.",
      served: { sha: null, source: "unknown" },
      feature: { sha: featureSha },
      nextAction: {
        kind: "file-blocker-bi",
        detail:
          "Served runtime is not a built image (e.g. a raw dev server). File a blocker BI and stop; do not treat a dev server as the canonical install.",
      },
    };
  }

  // 2. Served identity is not a comparable git SHA (content-hash or unknown) →
  //    containment is unprovable by SHA → advance via the governed pipeline,
  //    which restamps a comparable SHA.
  if (servedImage.source !== "git-sha") {
    return {
      verdict: "MUST-ADVANCE",
      reason: `Served image is stamped with a ${servedImage.source} identity, not a git SHA; feature containment is unprovable. Advance via the governed self-upgrade path to restamp a comparable SHA.`,
      served: { sha: servedImage.raw, source: servedImage.source },
      feature: { sha: featureSha },
      nextAction: {
        kind: "trigger-self-upgrade",
        detail: `Advance the live install via ${SELF_UPGRADE_PATH} (the ONLY sanctioned advance — AGENTS.md §5), then re-run the preflight.`,
      },
    };
  }

  // 3. Served identity is a git SHA — decide on containment.
  if (gitIdentitiesMatch(servedImage.raw, featureSha)) {
    return {
      verdict: "CAN-TEST",
      reason: `Served bytes (${shortSha(servedImage.raw)}) exactly match feature commit ${shortSha(featureSha)}; the live install is testable.`,
      served: { sha: servedImage.raw, source: "git-sha" },
      feature: { sha: featureSha },
      nextAction: {
        kind: "drive-happy-path",
        detail:
          "Drive the feature's happy path on the live install and record runtime verification evidence.",
      },
    };
  }
  if (featureContainedInServed === true) {
    return {
      verdict: "CAN-TEST",
      reason: `Served bytes (${shortSha(servedImage.raw)}) contain feature commit ${shortSha(featureSha)}; the live install is testable.`,
      served: { sha: servedImage.raw, source: "git-sha" },
      feature: { sha: featureSha },
      nextAction: {
        kind: "drive-happy-path",
        detail:
          "Drive the feature's happy path on the live install and record runtime verification evidence.",
      },
    };
  }
  if (featureContainedInServed === false) {
    return {
      verdict: "MUST-ADVANCE",
      reason: `Served bytes (${shortSha(servedImage.raw)}) do NOT contain feature commit ${shortSha(featureSha)}; the live install is behind.`,
      served: { sha: servedImage.raw, source: "git-sha" },
      feature: { sha: featureSha },
      nextAction: {
        kind: "trigger-self-upgrade",
        detail: `Advance the live install via ${SELF_UPGRADE_PATH} (the ONLY sanctioned advance — AGENTS.md §5), then re-run the preflight.`,
      },
    };
  }

  // featureContainedInServed === null: served is a git SHA but ancestry could
  // not be computed (commit not fetched locally, or git unavailable). A
  // validated source-free consumer cannot repair that by mounting Git, so send
  // it through the existing governed advance path. Source-backed,
  // contradictory, and unknown hosts remain fail-closed.
  if (input.installHostKind === "consumer") {
    return {
      verdict: "MUST-ADVANCE",
      reason: `Served bytes (${shortSha(servedImage.raw)}) do not exactly match feature commit ${shortSha(featureSha)}, and this validated consumer install cannot compute Git ancestry. Advance only through the governed self-upgrade path.`,
      served: { sha: servedImage.raw, source: "git-sha" },
      feature: { sha: featureSha },
      nextAction: {
        kind: "trigger-self-upgrade",
        detail: `Advance the live install via ${SELF_UPGRADE_PATH} (the ONLY sanctioned advance — AGENTS.md §5), then re-run the preflight.`,
      },
    };
  }

  const detail =
    (input.ancestryUncomputableDetail && input.ancestryUncomputableDetail.trim()) ||
    "Fetch the served and feature commits locally (git fetch; set DPF_REPO_ROOT to the clone when the portal process has no .git) and re-run the preflight. If still uncomputable, file a blocker BI and stop.";
  return {
    verdict: "BLOCKED",
    reason: `Cannot determine whether served bytes (${shortSha(servedImage.raw)}) contain feature commit ${shortSha(featureSha)} — ancestry was not computable.`,
    served: { sha: servedImage.raw, source: "git-sha" },
    feature: { sha: featureSha },
    nextAction: {
      kind: "file-blocker-bi",
      detail,
    },
  };
}

/**
 * Compare identities without consulting a repository. The image marker is a
 * full Git SHA in production; a caller may supply a conventional abbreviated
 * feature SHA. Twelve hex characters is the minimum accepted abbreviation so
 * arbitrary short prefixes cannot be treated as immutable identity.
 */
export function gitIdentitiesMatch(left: string, right: string): boolean {
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();
  if (!/^[0-9a-f]{12,40}$/.test(a) || !/^[0-9a-f]{12,40}$/.test(b)) {
    return false;
  }
  if (a.length !== 40 && b.length !== 40) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

function shortSha(sha: string): string {
  return /^[0-9a-f]{7,}$/i.test(sha) ? sha.slice(0, 12) : sha;
}
