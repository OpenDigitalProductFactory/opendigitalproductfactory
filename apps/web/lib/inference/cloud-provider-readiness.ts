// apps/web/lib/inference/cloud-provider-readiness.ts
//
// Whether a connected cloud provider can actually take any of this install's
// work (BI-575F0046).
//
// The distinction this module exists for is invisible everywhere else: a cloud
// provider can be `status: "active"`, listed, authenticated and healthy, and
// still be eligible for exactly nothing. `deriveActivationClearance` grants a
// freshly connected cloud account `["public"]` and withholds the rest until its
// trust evidence is reviewed — correct, because authentication proves a
// credential works, not that the account carries commercial data protections.
//
// The catch is that NO turn is ever `public`. `ROUTE_SENSITIVITY` in
// tak/agent-sensitivity.ts starts at `internal` and its entries are only
// `internal`, `confidential` and `restricted`; `Agent.sensitivity` defaults to
// `internal`. So the intersection of "what a new cloud provider is cleared for"
// and "what any turn can be" is empty, and `pipeline-v2` excludes it on every
// request. A brand-new install runs entirely on the local model, and the only
// signal the owner gets is that everything feels slower.
//
// Counting active non-local providers — which is what the workspace home did —
// reports that install as HAVING cloud AI, and hides the local-only notice that
// would at least have been true.

/** The lowest sensitivity any real turn can carry. Nothing routes at `public`. */
const LOWEST_ROUTED_SENSITIVITY = "internal";

export type CloudProviderReadiness =
  /** No active cloud provider at all — local-only, and honestly so. */
  | { state: "none"; providerNames: [] }
  /**
   * Connected and active, but cleared only for a sensitivity no turn uses.
   * Indistinguishable from working unless you look at the clearance array.
   */
  | { state: "public-only"; providerNames: string[] }
  /** At least one cloud provider is cleared for work that actually happens. */
  | { state: "ready"; providerNames: string[] };

export type ProviderClearanceFacts = {
  providerId: string;
  name: string;
  status: string;
  sensitivityClearance: readonly string[];
};

/** Local sidecars never send data off-machine; they are not the cloud question. */
function isLocalProvider(providerId: string): boolean {
  return providerId === "local" || providerId === "ollama";
}

/**
 * Classify the install's cloud AI into something an owner-facing surface can act
 * on. Pure over rows so it is testable without a database and so the workspace
 * home, the attention queue and setup guidance cannot drift apart.
 */
export function resolveCloudProviderReadiness(
  providers: ReadonlyArray<ProviderClearanceFacts>,
): CloudProviderReadiness {
  const cloud = providers.filter(
    (provider) => provider.status === "active" && !isLocalProvider(provider.providerId),
  );
  if (cloud.length === 0) return { state: "none", providerNames: [] };

  const usable = cloud.filter((provider) =>
    provider.sensitivityClearance.includes(LOWEST_ROUTED_SENSITIVITY),
  );
  if (usable.length > 0) {
    return { state: "ready", providerNames: usable.map((provider) => provider.name) };
  }
  return { state: "public-only", providerNames: cloud.map((provider) => provider.name) };
}
