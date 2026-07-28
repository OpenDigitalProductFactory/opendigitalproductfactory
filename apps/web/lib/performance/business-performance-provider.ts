/**
 * Truthful read boundary for the owner/manager Performance view.
 *
 * The historical read model lands in BI-PLAN-005. Until then this provider
 * returns an explicit setup state, never fabricated zeroes or demo metrics.
 */
export interface UnconfiguredBusinessPerformance {
  status: "not-configured";
  asOf: null;
  metricValues: readonly [];
  source: "business-performance-read-model";
}

export type BusinessPerformanceReadModel = UnconfiguredBusinessPerformance;

export interface BusinessPerformanceProvider {
  load(): Promise<BusinessPerformanceReadModel>;
}

const unconfiguredProvider: BusinessPerformanceProvider = {
  async load() {
    return {
      status: "not-configured",
      asOf: null,
      metricValues: [],
      source: "business-performance-read-model",
    };
  },
};

export async function loadBusinessPerformance(
  provider: BusinessPerformanceProvider = unconfiguredProvider,
): Promise<BusinessPerformanceReadModel> {
  return provider.load();
}
