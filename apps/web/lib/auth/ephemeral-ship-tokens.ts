/**
 * Ephemeral ship-phase MCP token lifecycle (BI-9866659C AC #4).
 *
 * Hooked from `transitionBuildPhase` in apps/web/lib/actions/build.ts. The
 * caller wraps every invocation in try/catch - token-side failures here
 * must NEVER block the underlying phase transition. The build still moves
 * forward; the operator falls back to their own session token if issuance
 * fails (which is exactly today's behaviour).
 *
 * Lifecycle:
 *   review -> ship   : issue one ephemeral_ship token scoped to this build
 *   ship   -> exit   : revoke every active ephemeral_ship token for the
 *                      build (the build may have multiple if a previous
 *                      ship attempt was rolled back and re-entered)
 *
 * Scope set is intentionally narrow - just the grants the ship-phase tools
 * (deploy_feature, execute_promotion, create_portal_pr,
 * register_digital_product_from_build, create_build_epic) require. The
 * operator's broader grants stay locked behind their own session.
 */

import {
  issueMcpApiToken,
  revokeEphemeralShipTokensForBuild,
} from "./mcp-api-token";

/**
 * Match the full C0 control range (U+0000..U+001F) plus DEL (U+007F).
 *
 * Built via the RegExp constructor with a string literal containing
 * "\x00-\x1F\x7F" so the source bytes stay pure ASCII (git diffs render
 * cleanly, no binary-file detection, no scanner false positives). The
 * RegExp engine compiles the escapes at runtime.
 */
const CONTROL_CHARS_REGEX = new RegExp("[\x00-\x1F\x7F]+", "g");

/**
 * Strip control characters and clamp length so an operator cannot smuggle
 * log-forgery payloads into our diagnostic output via a token name, grant
 * string, or upstream error message. Closes the CodeQL `js/log-injection`
 * finding on PR #1025.
 *
 * Any run of control chars collapses to a single space so adjacent visible
 * text stays readable. Output is capped at 200 chars to keep log lines
 * scannable.
 */
function sanitizeForLog(value: string): string {
  const stripped = value.replace(CONTROL_CHARS_REGEX, " ");
  return stripped.length > 200 ? `${stripped.slice(0, 197)}...` : stripped;
}

/**
 * Grant set for an ephemeral ship-phase token. Intentionally narrow -
 * just what the ship-phase tools need per `apps/web/lib/tak/agent-grants.ts`:
 *   - iac_execute       : deploy_feature, execute_promotion
 *   - sandbox_execute   : create_portal_pr, recover_sandbox
 *   - backlog_write     : register_digital_product_from_build, create_build_epic
 *   - registry_read     : portfolio context lookups
 *
 * Read scopes are included so the ship agent can navigate without needing
 * the full operator token in parallel.
 */
const EPHEMERAL_SHIP_SCOPES = [
  "iac_execute",
  "sandbox_execute",
  "backlog_write",
  "backlog_read",
  "registry_read",
  "file_read",
  "spec_plan_read",
  "work_capsule_read",
  "work_capsule_write",
] as const;

/**
 * Default expiry for an ephemeral ship token. Belt-and-suspenders: the
 * revoke-on-exit hook below normally retires the token within minutes,
 * but if the phase transition somehow never fires (process crash, manual
 * DB edit, etc.) we don't want a forever-live high-power token.
 *
 * 7 days is long enough to absorb a multi-day ship review pause without
 * forcing re-issuance, short enough to bound the worst-case leak window.
 */
const EPHEMERAL_SHIP_EXPIRY_DAYS = 7;

const REVOKE_REASON_PHASE_EXIT = "ship phase exited - ephemeral token retired";

export type ShipTokenTransitionInput = {
  buildId: string;
  /** User the build is attributed to - receives the ephemeral token. */
  userId: string;
  currentPhase: string;
  targetPhase: string;
  /** FeatureBuild.title - used to form a human-readable token name. */
  buildTitle: string;
};

/**
 * Single dispatch function called from transitionBuildPhase. Returns null
 * if nothing happened (most transitions). On ship-entry, returns a result
 * carrying the new token's plaintext for the UI to surface. On ship-exit,
 * returns a result carrying the revoked count for observability.
 */
export async function manageEphemeralShipTokensForTransition(
  input: ShipTokenTransitionInput,
): Promise<
  | null
  | { kind: "issued"; tokenId: string; plaintext: string; prefix: string }
  | { kind: "revoked"; revokedCount: number }
> {
  // Entry: review -> ship
  if (input.currentPhase === "review" && input.targetPhase === "ship") {
    return issueShipToken(input);
  }
  // Exit: ship -> anything else (complete, failed, rollback to build/review)
  if (input.currentPhase === "ship" && input.targetPhase !== "ship") {
    const { revokedCount } = await revokeEphemeralShipTokensForBuild(
      input.buildId,
      REVOKE_REASON_PHASE_EXIT,
    );
    return { kind: "revoked", revokedCount };
  }
  return null;
}

async function issueShipToken(
  input: ShipTokenTransitionInput,
): Promise<
  | { kind: "issued"; tokenId: string; plaintext: string; prefix: string }
  | null
> {
  // Short, identifiable name - operators scanning the token list see
  // "ship:FB-XXXX - <title>" and know exactly which build owns it.
  const shortId = input.buildId.length > 12 ? input.buildId.slice(-8) : input.buildId;
  const truncatedTitle = input.buildTitle.length > 40
    ? `${input.buildTitle.slice(0, 40)}...`
    : input.buildTitle;
  const name = `ship:${shortId} - ${truncatedTitle}`;

  const result = await issueMcpApiToken({
    userId: input.userId,
    name,
    scope: "write",
    scopes: [...EPHEMERAL_SHIP_SCOPES],
    expiresInDays: EPHEMERAL_SHIP_EXPIRY_DAYS,
    kind: "ephemeral_ship",
    buildId: input.buildId,
  });

  if (!result.ok) {
    // Non-fatal - the caller's try/catch will log and continue. We don't
    // throw because the operator's session token will still work for the
    // ship-phase tools.
    //
    // sanitizeForLog applied to operator-influenced values (buildId,
    // result.message) to close the CodeQL js/log-injection finding on
    // PR #1025. result.error is a literal-union string from
    // mcp-api-token.ts so it's safe to interpolate raw.
    console.warn(
      `[ephemeral-ship-token] issue failed for build ${sanitizeForLog(input.buildId)}: ${result.error} - ${sanitizeForLog(result.message)}`,
    );
    return null;
  }

  return {
    kind: "issued",
    tokenId: result.tokenId,
    plaintext: result.plaintext,
    prefix: result.prefix,
  };
}

// Re-export the constants so tests + the UI label can reference them
// without duplicating the values.
export {
  EPHEMERAL_SHIP_SCOPES as EPHEMERAL_SHIP_TOKEN_SCOPES,
  EPHEMERAL_SHIP_EXPIRY_DAYS as EPHEMERAL_SHIP_TOKEN_EXPIRY_DAYS,
};
