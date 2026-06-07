// Browser-driving session binding helpers (EP-BROWSER-DRIVE, spec 2026-06-05 §8.7).
//
// A BrowserSessionBinding is the thin, auditable+resumable record of one driven
// browser session. It is NOT an action log — individual actions live in
// ToolExecution keyed by sessionId. These helpers own the cross-field invariants
// (Verdict 3) and the (engine, profile) binding rule (§4.10) so no caller can
// open a session in an unsafe shape.

import { prisma } from "@dpf/db";

export type BrowserMeans = "deterministic" | "plugin" | "delegated";
export type BrowserEngine = "chromium" | "safari" | "firefox";
export type BrowserProfileKind = "service-account" | "operator-live";
export type BrowserSessionStatus = "active" | "closed" | "failed" | "blocked-on-reauth";

export type BrowserSessionBindingInput = {
  sessionId: string;
  means: BrowserMeans;
  engine: BrowserEngine;
  /** /profiles/<principalId>/<siteKey>/ for service accounts, or an operator-live handle. */
  profileRef: string;
  profileKind: BrowserProfileKind;
  attended: boolean;
  /** Human on whose behalf the session runs (always recorded — "act-for" attribution). */
  delegatingUserId: string;
  /** Principal.principalId of the service account; required for service-account profiles. */
  actingPrincipalId?: string | null;
  delegationGrantId?: string | null;
  /** IntegrationCredential.integrationId of the browser-session credential. */
  credentialId?: string | null;
  /** Navigation/act allowlist (enforced at the sidecar in Phase 2). */
  targetDomains?: string[];
  driverRef?: string | null;
  /** Per-task WWMD means-selector contribution ledger. */
  meansDecisionJson?: unknown;
  evidenceDir?: string | null;
};

/**
 * Enforce the session-shape invariants that the DB cannot express as column
 * constraints. Throws on violation — call before any create.
 *
 * - operator-live profiles are attended-only (Verdict 3): an autonomous run
 *   never drives the operator's live profile.
 * - service-account profiles must name the acting Principal (least-privilege
 *   identity, not a fake human).
 * - the driven surface is Chromium in v1 (§4.10): Safari/Firefox have no CDP
 *   and are computer-use-observation-only fallbacks, not driveable here.
 */
export function assertBrowserSessionBindingInvariants(input: BrowserSessionBindingInput): void {
  if (input.profileKind === "operator-live" && !input.attended) {
    throw new Error(
      "browser-session: operator-live profiles are attended-only (Verdict 3); set attended=true or use a service-account profile",
    );
  }
  if (input.profileKind === "service-account" && !input.actingPrincipalId) {
    throw new Error(
      "browser-session: service-account profile requires actingPrincipalId (the acting service Principal)",
    );
  }
  if (input.engine !== "chromium") {
    throw new Error(
      `browser-session: engine "${input.engine}" is not driveable — the v1 driven surface is Chromium; Safari/Firefox are observation-only (§4.10)`,
    );
  }
}

/** Create an active BrowserSessionBinding after asserting invariants. */
export async function createBrowserSessionBinding(input: BrowserSessionBindingInput) {
  assertBrowserSessionBindingInvariants(input);
  return prisma.browserSessionBinding.create({
    data: {
      sessionId: input.sessionId,
      means: input.means,
      engine: input.engine,
      profileRef: input.profileRef,
      profileKind: input.profileKind,
      attended: input.attended,
      delegatingUserId: input.delegatingUserId,
      actingPrincipalId: input.actingPrincipalId ?? null,
      delegationGrantId: input.delegationGrantId ?? null,
      credentialId: input.credentialId ?? null,
      targetDomains: input.targetDomains ?? [],
      driverRef: input.driverRef ?? null,
      meansDecisionJson: (input.meansDecisionJson ?? undefined) as object | undefined,
      evidenceDir: input.evidenceDir ?? null,
      status: "active",
    },
  });
}

/** Transition a session to a terminal/blocked status and stamp closedAt for terminal states. */
export async function setBrowserSessionStatus(sessionId: string, status: BrowserSessionStatus) {
  const terminal = status === "closed" || status === "failed";
  return prisma.browserSessionBinding.update({
    where: { sessionId },
    data: { status, closedAt: terminal ? new Date() : null },
  });
}
