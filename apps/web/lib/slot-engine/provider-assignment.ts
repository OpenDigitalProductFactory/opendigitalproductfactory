interface ProviderCandidate {
  id: string;
  name: string;
  priority: number;
  weight: number;
  recentBookings: number;
}

export function selectProviderRoundRobin(
  providers: ProviderCandidate[]
): ProviderCandidate | null {
  if (providers.length === 0) return null;

  const minBookings = Math.min(...providers.map((p) => p.recentBookings));

  const scored = providers.map((p) => ({
    ...p,
    effectiveWeight: p.weight / (1 + p.recentBookings - minBookings),
  }));

  scored.sort((a, b) => {
    if (b.effectiveWeight !== a.effectiveWeight) return b.effectiveWeight - a.effectiveWeight;
    return a.priority - b.priority;
  });

  return scored[0] ?? null;
}
