/**
 * Resolve an archetype metric binding to a number, or say why it cannot be.
 *
 * An archetype's stages declare `metricBindings` — 30 of them for pet-rescue
 * alone — but until now those keys appeared only in the seed that writes them
 * and the projection that draws them. Nothing turned a key into a value.
 *
 * The contract has exactly two outcomes, and zero is not a substitute for
 * either. A binding resolves to a value with the time it was computed, or it
 * reports `unmeasurable` with a reason a person can act on. This is the same
 * stance the /performance page already takes: we will not show made-up numbers.
 * A bare 0 is the worst answer available, because "none right now" and "nothing
 * records this" are different facts and look identical once rendered.
 *
 * Only the bindings an archetype marks load-bearing are worth a resolver, and
 * only those with a real writer behind them can honestly have one. Everything
 * else reports unmeasurable until a writer exists.
 */

export type MetricBindingUnit = "count" | "days" | "ratio";

export interface ResolvedMetricBinding {
  status: "resolved";
  bindingKey: string;
  value: number;
  unit: MetricBindingUnit;
  /** ISO-8601 instant the value was computed. */
  computedAt: string;
}

export interface UnmeasurableMetricBinding {
  status: "unmeasurable";
  bindingKey: string;
  /** Why no honest value exists. Shown to the operator, so it must be plain. */
  reason: string;
}

export type MetricBindingResolution = ResolvedMetricBinding | UnmeasurableMetricBinding;

/** What a resolver may read. Injectable so resolvers are testable without a database. */
export interface MetricBindingContext {
  orgId: string;
  storefrontId: string | null;
  /** Counts adoptable animals in a given status for the storefront. */
  countAnimalsByStatus: (storefrontId: string, status: string) => Promise<number>;
  /** Clock, injectable so a computed-at timestamp is assertable. */
  now: () => Date;
}

type MetricBindingResolver = (
  context: MetricBindingContext,
) => Promise<{ value: number; unit: MetricBindingUnit } | { unmeasurableReason: string }>;

function requireStorefront(
  context: MetricBindingContext,
): { storefrontId: string } | { unmeasurableReason: string } {
  if (!context.storefrontId) {
    return {
      unmeasurableReason:
        "This organisation has no storefront yet, so there are no animal records to count.",
    };
  }
  return { storefrontId: context.storefrontId };
}

/**
 * Resolvers for the load-bearing bindings that have a real writer behind them.
 *
 * AdoptableAnimal carries `status` (available | pending | adopted | hold), which
 * is written by the adoption flow, so these three are genuinely measurable. The
 * remaining pet-rescue bindings — occupancy, medication adherence, lead times —
 * describe work no table records yet; they resolve unmeasurable by omission
 * rather than by returning a misleading zero.
 */
const RESOLVERS: Record<string, MetricBindingResolver> = {
  "animals-adoption-ready": async (context) => {
    const gate = requireStorefront(context);
    if ("unmeasurableReason" in gate) return gate;
    return {
      value: await context.countAnimalsByStatus(gate.storefrontId, "available"),
      unit: "count",
    };
  },

  "approved-matches": async (context) => {
    const gate = requireStorefront(context);
    if ("unmeasurableReason" in gate) return gate;
    return {
      value: await context.countAnimalsByStatus(gate.storefrontId, "pending"),
      unit: "count",
    };
  },

  "completed-adoptions": async (context) => {
    const gate = requireStorefront(context);
    if ("unmeasurableReason" in gate) return gate;
    return {
      value: await context.countAnimalsByStatus(gate.storefrontId, "adopted"),
      unit: "count",
    };
  },
};

/** Binding keys that currently have a resolver. */
export function resolvableMetricBindingKeys(): string[] {
  return Object.keys(RESOLVERS).sort();
}

/**
 * Resolve one binding. Never returns a value it cannot stand behind: an
 * unregistered key, a missing prerequisite, or a resolver that throws all
 * report unmeasurable with a reason.
 */
export async function resolveMetricBinding(
  bindingKey: string,
  context: MetricBindingContext,
): Promise<MetricBindingResolution> {
  const resolver = RESOLVERS[bindingKey];
  if (!resolver) {
    return {
      status: "unmeasurable",
      bindingKey,
      reason: "Nothing in the system records this yet, so there is no number to show.",
    };
  }

  try {
    const outcome = await resolver(context);
    if ("unmeasurableReason" in outcome) {
      return { status: "unmeasurable", bindingKey, reason: outcome.unmeasurableReason };
    }
    return {
      status: "resolved",
      bindingKey,
      value: outcome.value,
      unit: outcome.unit,
      computedAt: context.now().toISOString(),
    };
  } catch {
    // A failed read is not a zero. Say the reading failed.
    return {
      status: "unmeasurable",
      bindingKey,
      reason: "This could not be read just now. Try again shortly.",
    };
  }
}

/** Resolve many bindings, preserving input order. */
export async function resolveMetricBindings(
  bindingKeys: readonly string[],
  context: MetricBindingContext,
): Promise<MetricBindingResolution[]> {
  return Promise.all(bindingKeys.map((key) => resolveMetricBinding(key, context)));
}
