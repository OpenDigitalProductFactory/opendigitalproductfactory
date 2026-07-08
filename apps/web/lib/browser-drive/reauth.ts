// Session freshness + re-auth loop (EP-BROWSER-DRIVE, spec §9.3).
//
// Before an autonomous run, probe a known authenticated endpoint. Redirect-to-
// auth means the session expired: a storageState-mode account blocks the
// dependent workflow as `blocked-on-reauth` and notifies the operator; never
// silently run a downstream destructive action on a dead session.

import { markBrowserSessionCredentialStale } from "./credentials";
import { setBrowserSessionStatus } from "./session-binding";
import { getErrorMessage } from "@/lib/shared/get-error-message";

export type ReauthState = "fresh" | "needs-reauth" | "unknown";

/** Probes whether the profile's session is still authenticated against a known
 *  endpoint. redirectedToAuth=true is the canonical "expired" signal. */
export type FreshnessProbe = (
  probeUrl: string,
) => Promise<{ authenticated: boolean; redirectedToAuth?: boolean }>;

export type FreshnessResult = { state: ReauthState; reason: string };

/** Pure: derive the re-auth state from a probe outcome. */
export function deriveReauthState(probe: { authenticated: boolean }): ReauthState {
  return probe.authenticated ? "fresh" : "needs-reauth";
}

/**
 * Probe a profile's freshness and, when expired, mark the credential stale and
 * (optionally) move the dependent session to `blocked-on-reauth`. A probe that
 * throws yields `unknown` (transient/unknown) rather than a false "expired".
 */
export async function checkSessionFreshness(params: {
  credentialId: string;
  probeUrl: string;
  probe: FreshnessProbe;
  /** When set, transition this session to blocked-on-reauth on expiry. */
  sessionId?: string;
}): Promise<FreshnessResult> {
  let outcome: Awaited<ReturnType<FreshnessProbe>>;
  try {
    outcome = await params.probe(params.probeUrl);
  } catch (err) {
    return { state: "unknown", reason: `freshness probe failed: ${getErrorMessage(err)}` };
  }

  if (outcome.authenticated) {
    return { state: "fresh", reason: "authenticated endpoint reachable" };
  }

  const reason = outcome.redirectedToAuth
    ? "freshness probe redirected to auth — session expired"
    : "freshness probe found no authenticated session";
  await markBrowserSessionCredentialStale(params.credentialId, reason).catch(() => {});
  if (params.sessionId) {
    await setBrowserSessionStatus(params.sessionId, "blocked-on-reauth").catch(() => {});
  }
  return { state: "needs-reauth", reason };
}
