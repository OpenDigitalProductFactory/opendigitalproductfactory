// BI-5ACBAC50 — say WHICH capabilities have drifted, and in which direction.
//
// `projectCapabilityServices` already detects the drift, and correctly: it
// throws `capability_state_stale:<id>` when `PlatformCapability.state` and
// `install-state.json`'s `enabledRuntimeCapabilities` disagree. Fail-closed is
// right — a projection that guessed which of the two authorities to believe
// would hand backup and readiness a topology neither source claims.
//
// The problem is that the throw is ANONYMOUS to an operator. It names one
// capability, it surfaces as a generic error on whatever page called it, and the
// surfaces that would explain it — runtime health, backup readiness — are the
// exact ones that cannot render because the throw happened inside their loader.
// So the platform detects the condition and then loses it.
//
// This module is the diagnosis half: pure, total, and callable when the
// projection has ALREADY thrown, so the failure can be shown rather than merely
// logged. It changes no semantics and never decides which authority wins.
//
// Observed on a live install 2026-08-26: install-state listed only
// `runtime:core`, while the database reported six further capabilities `active`
// (build, browser-automation, deep-observability, durable-automation,
// external-ai, local-speech) and `runtime:development` disabled while its
// services were running. Backup, readiness and the health UI all consume this
// projection.

import catalog from "../../../../scripts/capability-service-catalog.generated.json";

import type { LiveCapabilityState } from "./capability-service-projection";

const generatedCatalog = catalog as unknown as {
  capabilities: { capabilityId: string }[];
};

/**
 * Which way a capability drifted.
 *
 * `live-active-not-enabled` — the database says the capability is on, the
 * install snapshot does not list it. Anything trusting capability state believes
 * services are running that the install never provisioned. This is the shape
 * that made deep-observability read healthy while nothing collected.
 *
 * `enabled-not-live-active` — the install snapshot lists it, the database says
 * disabled. The services may be running while the platform believes they are
 * not, so nothing tends them.
 */
export type CapabilityDivergenceKind =
  | "live-active-not-enabled"
  | "enabled-not-live-active"
  | "missing-live-state";

export interface CapabilityDivergence {
  capabilityId: string;
  kind: CapabilityDivergenceKind;
  /** What `PlatformCapability.state` says, or null when there is no row. */
  liveState: "active" | "disabled" | null;
  /** Whether install-state lists it in `enabledRuntimeCapabilities`. */
  enabledInInstallState: boolean;
}

export interface CapabilityDivergenceReport {
  diverged: boolean;
  divergences: CapabilityDivergence[];
  /** One line an operator can read without knowing the data model. */
  summary: string;
}

function describe(divergences: CapabilityDivergence[]): string {
  if (divergences.length === 0) {
    return "Capability state agrees with the installation snapshot.";
  }
  const claimedOn = divergences
    .filter((entry) => entry.kind === "live-active-not-enabled")
    .map((entry) => entry.capabilityId);
  const claimedOff = divergences
    .filter((entry) => entry.kind === "enabled-not-live-active")
    .map((entry) => entry.capabilityId);
  const missing = divergences
    .filter((entry) => entry.kind === "missing-live-state")
    .map((entry) => entry.capabilityId);

  const parts: string[] = [];
  if (claimedOn.length > 0) {
    parts.push(
      `the database reports ${claimedOn.join(", ")} active, but this installation never enabled them`,
    );
  }
  if (claimedOff.length > 0) {
    parts.push(
      `this installation enabled ${claimedOff.join(", ")}, but the database reports them disabled`,
    );
  }
  if (missing.length > 0) {
    parts.push(`no capability record exists for ${missing.join(", ")}`);
  }
  return `Capability state has drifted from the installation snapshot: ${parts.join("; ")}.`;
}

/**
 * Compare the two authorities and name every disagreement.
 *
 * Pure and total. Reports rather than decides: it never says which side is
 * right, because that is a repair decision with real consequences and belongs to
 * whoever is doing the repair.
 */
export function diagnoseCapabilityStateDivergence(input: {
  enabledRuntimeCapabilities: readonly string[];
  capabilityStates: readonly LiveCapabilityState[];
}): CapabilityDivergenceReport {
  const enabled = new Set(input.enabledRuntimeCapabilities);
  const live = new Map<string, "active" | "disabled">();
  for (const entry of input.capabilityStates) {
    if (entry.state === "active" || entry.state === "disabled") {
      live.set(entry.capabilityId, entry.state);
    }
  }

  const divergences: CapabilityDivergence[] = [];
  for (const capability of generatedCatalog.capabilities) {
    const id = capability.capabilityId;
    const liveState = live.get(id) ?? null;
    const enabledHere = enabled.has(id);

    if (liveState === null) {
      divergences.push({
        capabilityId: id,
        kind: "missing-live-state",
        liveState: null,
        enabledInInstallState: enabledHere,
      });
      continue;
    }
    if (liveState === "active" && !enabledHere) {
      divergences.push({
        capabilityId: id,
        kind: "live-active-not-enabled",
        liveState,
        enabledInInstallState: false,
      });
      continue;
    }
    if (liveState === "disabled" && enabledHere) {
      divergences.push({
        capabilityId: id,
        kind: "enabled-not-live-active",
        liveState,
        enabledInInstallState: true,
      });
    }
  }

  return {
    diverged: divergences.length > 0,
    divergences,
    summary: describe(divergences),
  };
}

/** True for the error `projectCapabilityServices` throws on drift. */
export function isCapabilityStateStaleError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    message.startsWith("capability_state_stale:") ||
    message === "install_capability_state_stale" ||
    message === "install_catalog_stale"
  );
}
