export interface FirstBootProviderReconciliation {
  discovered: number;
  profiled: number;
  queued: number;
  discoveryError?: string;
}

interface ReconciliationHooks {
  countProfiles: () => Promise<number>;
  discoverAndProfile: () => Promise<{ discovered: number; profiled: number; error?: string }>;
  queueUncalibratedEvals: () => Promise<number>;
}

/**
 * Reconcile both a pristine provider and an interrupted first boot. Discovery
 * is only needed for an empty provider, but calibration is retried on every
 * startup until the seed profiles have at least one durable eval result.
 */
export async function reconcileFirstBootProvider(
  hooks: ReconciliationHooks,
): Promise<FirstBootProviderReconciliation> {
  const profileCount = await hooks.countProfiles();
  const discovery = profileCount === 0
    ? await hooks.discoverAndProfile()
    : { discovered: 0, profiled: 0 };
  const queued = await hooks.queueUncalibratedEvals();
  return {
    discovered: discovery.discovered,
    profiled: discovery.profiled,
    queued,
    ...(discovery.error ? { discoveryError: discovery.error } : {}),
  };
}
