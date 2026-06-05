import type { CapabilityActivationChoice, CapabilityApplicability } from "./types";

/**
 * Why a capability resolved to its current active/inactive state.
 * - `required`: core to the chosen business model; on by default, no org opt-in needed.
 * - `org-choice`: the org made an explicit enabled/disabled decision.
 * - `default-off`: offered (recommended/optional) but the org has not opted in yet.
 * - `not-applicable`: the business model does not support this capability.
 */
export type CapabilityActivationSource =
  | "required"
  | "org-choice"
  | "default-off"
  | "not-applicable";

export interface CapabilityActivationResolution {
  /** Is the capability effectively active for this organization right now? */
  active: boolean;
  /**
   * Should the setup wizard ask the user about this capability during initial
   * onboarding? True for `required` (informed/confirmed) and `recommended`
   * (asked). `optional` capabilities are not surfaced at setup to keep the
   * wizard uncluttered — they are reachable via {@link CapabilityActivationResolution.canEnableLater}.
   */
  promptAtSetup: boolean;
  /**
   * Can the org enable this capability later from admin even when it is off now?
   * True for anything the business model supports (`required`/`recommended`/`optional`).
   * This is the "add it later" provision.
   */
  canEnableLater: boolean;
  source: CapabilityActivationSource;
}

/**
 * Resolves the *effective* activation of a capability for one organization by
 * overlaying that org's persisted opt-in {@link CapabilityActivationChoice} on
 * top of the derived {@link CapabilityApplicability}.
 *
 * The derivation (from operating-model axes) says how strongly a capability is
 * offered; this function says whether *this* org has it on, whether to ask at
 * setup, and whether it can be turned on later. Both the setup wizard and the
 * admin capability toggle resolve through this single function so "ask at setup"
 * and "add it later" share one source of truth.
 *
 * Semantics:
 * - `not-applicable` / `hidden` → never active, never prompted, cannot enable later.
 * - `required` → active unless the org explicitly disabled it; confirmed (not
 *   silently applied) at setup; can be re-enabled later.
 * - `recommended` → opt-in: off until the org enables it; **asked at setup**; can
 *   be enabled later.
 * - `optional` → opt-in: off until enabled; not surfaced at setup; **can be added later**.
 */
export function resolveCapabilityActivation(
  applicability: CapabilityApplicability,
  choice?: CapabilityActivationChoice | null,
): CapabilityActivationResolution {
  if (applicability === "not-applicable" || applicability === "hidden") {
    return {
      active: false,
      promptAtSetup: false,
      canEnableLater: false,
      source: "not-applicable",
    };
  }

  if (applicability === "required") {
    return {
      active: choice !== "disabled",
      promptAtSetup: true,
      canEnableLater: true,
      source: choice ? "org-choice" : "required",
    };
  }

  // recommended | optional → opt-in; off until the org turns it on.
  return {
    active: choice === "enabled",
    promptAtSetup: applicability === "recommended",
    canEnableLater: true,
    source: choice ? "org-choice" : "default-off",
  };
}
