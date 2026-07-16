/** Human-readable upgrade span for Latest Run / history (BI-57E57347). */

export function shortSha(value: string | null | undefined): string {
  if (!value) return "";
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}

export function formatUpgradeScope(
  fromSha: string | null | undefined,
  toSha: string | null | undefined,
): string | null {
  if (!fromSha || !toSha) return null;
  return `Upgrade scope: ${shortSha(fromSha)} → ${shortSha(toSha)}`;
}
