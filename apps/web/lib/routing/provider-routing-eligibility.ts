/**
 * Provider routing-eligibility projection (BI-1C4AAE1E, EP-ROUTING-11).
 *
 * Answers the single question the Providers admin surface must answer at a
 * glance: "can routing use this provider right now — yes/no, and why?"
 *
 * One mutually-exclusive state replaces the muddle that used to be scattered
 * across a provider row (lifecycle status dot + a standalone "needs credentials"
 * badge + the toggle text + a billing-snapshot "Not connected" label + a
 * separate CLI-pool box). Pure + deterministic (no DB; the only time input is an
 * injected `now` via `credentialExpired`) so it is fully unit-testable; a thin
 * caller in the page wires it to data already loaded for the grid.
 *
 * Where this sits among siblings:
 *   - `provider-eligibility.ts`          → STRUCTURAL: is this endpoint type a
 *                                          routing target at all
 *   - `loader.ts` loadEndpointManifests  → the canonical runtime candidate query
 *                                          (status ∈ {active,degraded} + routable
 *                                          endpoint type + a usable ModelProfile)
 *   - `provider-health.ts`               → LIVE reachability from RouteOutcome
 *                                          telemetry (needs a per-provider query)
 *   - THIS module                        → operator-facing CONFIG/CREDENTIAL/POOL
 *                                          gate, computed from data already on the
 *                                          admin page (no per-row telemetry query).
 *                                          It never mutates any of them.
 */

import type { CliAdapterType } from "./cli-pool-status";
import { usesCliAdapter, usesCodexCli } from "./provider-utils";

/** Low-cardinality, mutually-exclusive routing-eligibility state. */
export type RoutingEligibilityState =
  | "routable" // eligible now — routing can select it
  | "rate_limited" // temporarily blocked at the provider (CLI pool 429); self-recovers
  | "needs_credentials" // enabled, but credentials are missing or expired
  | "no_models" // enabled + credentialed, but no model has been discovered yet
  | "disabled" // an administrator turned it off
  | "unconfigured" // never set up
  | "not_routable"; // not a model/voice endpoint (an MCP tool/service) — routing never selects it

export interface RoutingEligibility {
  state: RoutingEligibilityState;
  /** True only for `routable` — the yes/no half of the answer. */
  eligible: boolean;
  /** Short badge label, e.g. "Routable", "Needs credentials". */
  label: string;
  /** One-line, plain-language reason — the "why" half. No model IDs / internals. */
  reason: string;
}

export interface RoutingEligibilityInput {
  /** ModelProvider.status — active | degraded | unconfigured | inactive | disabled. */
  status: string;
  endpointType?: string | null;
  category?: string | null;
  serviceKind?: string | null;
  /** ModelProvider.authMethod — "none" means no credential is required (local). */
  authMethod?: string | null;
  /** Whether a credential row exists for this provider. */
  hasCredential: boolean;
  /** For OAuth providers: the saved token's expiry is in the past. */
  credentialExpired?: boolean;
  /**
   * How many models have been discovered for this provider. Only applied to
   * model-routing endpoint types; omit/undefined to skip the check (voice /
   * transcription resolves its model through a separate readiness path). A
   * value of 0 means nothing is discovered yet → routing has nothing to pick.
   */
  discoveredModelCount?: number | null;
  /** The provider's CLI subscription pool is currently exhausted (saw a 429). */
  cliPoolExhausted?: boolean;
  /** Human reset hint for the exhausted pool, e.g. "~5min" or "any moment". */
  cliPoolResetHint?: string | null;
}

const LABELS: Record<RoutingEligibilityState, string> = {
  routable: "Routable",
  rate_limited: "Rate-limited",
  needs_credentials: "Needs credentials",
  no_models: "No models",
  disabled: "Disabled",
  unconfigured: "Not set up",
  not_routable: "Not routable",
};

/** Endpoint types whose providers are selected by the model (chat/LLM) router. */
const MODEL_ROUTING_ENDPOINT_TYPES = new Set(["llm", "chat", "responses", "gemini", "ollama"]);

function isNonRoutableSurface(input: RoutingEligibilityInput): boolean {
  const endpointType = (input.endpointType ?? "llm").toLowerCase();
  const category = (input.category ?? "").toLowerCase();
  const serviceKind = (input.serviceKind ?? "").toLowerCase();
  // MCP tools / services are not model or voice endpoints — routing never
  // selects them. (The admin page already filters endpointType="service" out,
  // but keeping the check here makes the projection total and correct.)
  return endpointType === "service" || serviceKind === "mcp" || category.startsWith("mcp");
}

/**
 * Derive a provider's routing eligibility. Precedence is most-actionable-first
 * so the single state always names the dominant thing to look at:
 *
 *   0. not a routing target (MCP service)     → not_routable
 *   1. never set up                           → unconfigured
 *   2. not active/degraded (off)              → disabled
 *   3. requires creds but has none            → needs_credentials
 *   4. creds present but expired              → needs_credentials
 *   5. CLI subscription pool exhausted        → rate_limited
 *   6. model endpoint with nothing discovered → no_models
 *   7. otherwise                              → routable
 */
export function deriveRoutingEligibility(input: RoutingEligibilityInput): RoutingEligibility {
  const mk = (state: RoutingEligibilityState, reason: string): RoutingEligibility => ({
    state,
    eligible: state === "routable",
    label: LABELS[state],
    reason,
  });

  // 0. Not a model/voice endpoint at all.
  if (isNonRoutableSurface(input)) {
    return mk("not_routable", "This is a tool/service, not a model endpoint — routing never selects it.");
  }

  const status = (input.status ?? "").toLowerCase();

  // 1. Never set up.
  if (status === "unconfigured" || status === "") {
    return mk("unconfigured", "Not set up yet. Configure it to make it routable.");
  }

  // 2. Anything that is not active/degraded is off (inactive, disabled, …).
  if (status !== "active" && status !== "degraded") {
    return mk("disabled", "Turned off by an administrator. Enable it to allow routing.");
  }

  const requiresCredential = (input.authMethod ?? "").toLowerCase() !== "none";

  // 3. Requires credentials but none are connected.
  if (requiresCredential && !input.hasCredential) {
    return mk("needs_credentials", "Enabled, but no credentials are connected yet.");
  }

  // 4. Credentials present but expired (OAuth subscriptions).
  if (requiresCredential && input.credentialExpired) {
    return mk("needs_credentials", "The saved sign-in has expired — reconnect to restore routing.");
  }

  // 5. CLI subscription pool exhausted — temporary, recovers on its own.
  if (input.cliPoolExhausted) {
    const hint = input.cliPoolResetHint
      ? ` Recovers ${input.cliPoolResetHint}.`
      : " It recovers automatically.";
    return mk("rate_limited", `Temporarily rate-limited at the provider.${hint}`);
  }

  // 6. Model-routing endpoint with nothing discovered yet → can't pick a model.
  const endpointType = (input.endpointType ?? "llm").toLowerCase();
  if (
    MODEL_ROUTING_ENDPOINT_TYPES.has(endpointType) &&
    input.discoveredModelCount != null &&
    input.discoveredModelCount <= 0
  ) {
    return mk("no_models", "Enabled, but no models have been discovered yet.");
  }

  // 7. Eligible.
  if (status === "degraded") {
    return mk("routable", "Routing can use it now, though recent requests showed some errors.");
  }
  return mk(
    "routable",
    requiresCredential
      ? "Connected and enabled — routing can use it now."
      : "Reachable and enabled — routing can use it now.",
  );
}

/**
 * Which CLI subscription pool (if any) gates a provider's live availability,
 * grounded in the canonical adapter predicates in `provider-utils.ts`:
 *   - anthropic-sub → claude-cli  (Claude OAuth subscription, routes via `claude -p`)
 *   - codex         → codex-cli   (OpenAI Codex, routes via `codex exec`)
 *   - chatgpt       → codex-cli   (ChatGPT subscription rides the same OpenAI
 *                                  codex-engine pool; cliEngine="codex")
 * Every other provider routes via direct HTTP and has no CLI pool gate (null).
 */
export function cliAdapterTypeForProvider(providerId: string): CliAdapterType | null {
  if (usesCliAdapter(providerId)) return "claude-cli";
  if (usesCodexCli(providerId) || providerId === "chatgpt") return "codex-cli";
  return null;
}
