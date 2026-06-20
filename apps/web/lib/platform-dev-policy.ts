export type PlatformDevPolicyState = "policy_pending" | "private" | "contributing";

export function getPlatformDevPolicyState(
  config: { contributionMode: string | null } | null | undefined,
): PlatformDevPolicyState {
  if (!config) return "policy_pending";
  // 2-state model (EP-1A78BAE1): contributionMode is "private" | "contributing".
  // Legacy values ("fork_only" | "selective" | "contribute_all") are mapped for
  // back-compat in case a row predates the collapse migration.
  const mode = config.contributionMode;
  if (mode === "private" || mode === "fork_only") return "private";
  return "contributing";
}
