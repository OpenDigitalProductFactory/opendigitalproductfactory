export type CapabilityProjectionSnapshot = {
  enabledRuntimeCapabilities: readonly string[];
  capabilityStateVersion: string;
  [key: string]: unknown;
};

export function assessCapabilityDeactivation<T extends CapabilityProjectionSnapshot>(input: {
  capabilityId: string;
  currentProjection: T;
  blockingCounts: Readonly<Record<string, number>>;
}) {
  for (const [guard, count] of Object.entries(input.blockingCounts)) {
    if (!Number.isFinite(count) || !Number.isInteger(count) || count < 0) throw new Error(`invalid_blocking_count:${guard}`);
  }
  const blockingCounts = Object.fromEntries(Object.entries(input.blockingCounts).filter(([, count]) => count > 0));
  if (Object.keys(blockingCounts).length > 0) return {
    status: "drain_required" as const,
    capabilityId: input.capabilityId,
    blockingCounts,
    currentProjection: input.currentProjection,
  };
  return { status: "ready" as const, capabilityId: input.capabilityId, currentProjection: input.currentProjection };
}
