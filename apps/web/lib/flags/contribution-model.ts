// Feature flag gating the fork-based PR contribution model rollout.
// Default: disabled. Set CONTRIBUTION_MODEL_ENABLED=true to enable.
//
// When disabled: contribute_to_hive and the admin UI keep the pre-flag
// direct-push flow regardless of PlatformDevConfig.contributionModel value.
// When enabled: the runtime dispatches on PlatformDevConfig.contributionModel
// ("maintainer-direct" | "fork-pr") and the admin UI surfaces the fork
// setup flow.
//
// Strict equality check on "true" is intentional — any other value
// (including "1", "yes", "TRUE", or accidental trailing whitespace)
// keeps the flag off so partial rollouts never ship on a typo.
export function isContributionModelEnabled(): boolean {
  return process.env.CONTRIBUTION_MODEL_ENABLED === "true";
}
