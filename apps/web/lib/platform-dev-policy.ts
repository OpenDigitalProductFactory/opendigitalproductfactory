export type PlatformDevPolicyState = "policy_pending" | "private" | "contributing";

export function getPlatformDevPolicyState(
  config: { contributionMode: string | null } | null | undefined,
): PlatformDevPolicyState {
  if (!config) return "policy_pending";
  return config.contributionMode === "fork_only" ? "private" : "contributing";
}
