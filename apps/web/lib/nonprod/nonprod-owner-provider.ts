export type NonprodOwnerProvider =
  | "build-studio"
  | "claude"
  | "codex"
  | "grok"
  | "antigravity"
  | "coworker";

/** Every host-worktree and embedded surface allowed to own nonprod work. */
export const NONPROD_OWNER_PROVIDERS: readonly NonprodOwnerProvider[] = [
  "build-studio",
  "claude",
  "codex",
  "grok",
  "antigravity",
  "coworker",
] as const;

export function isNonprodOwnerProvider(
  value: string,
): value is NonprodOwnerProvider {
  return (NONPROD_OWNER_PROVIDERS as readonly string[]).includes(value);
}
