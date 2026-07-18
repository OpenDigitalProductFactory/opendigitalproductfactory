import type { OperationalCapabilityState, ObservedServiceState } from "./operational-state";

export type CapabilityHealthState =
  | "required"
  | "optional_inactive"
  | "optional_degraded"
  | "external";

export type CapabilityHealthAvailability = "available" | "unavailable" | "inactive";
export type CapabilityHealthTone = "success" | "warning" | "neutral";

export interface CapabilityServiceHealthItem {
  key: string;
  kind: "service" | "runtime";
  state: CapabilityHealthState;
  availability: CapabilityHealthAvailability;
  label: string;
  action: string;
  tone: CapabilityHealthTone;
  healthSemantics: string;
}

export interface CapabilityHealthAggregate {
  value: "Operational" | "Degraded";
  tone: "success" | "warning";
  detail: string;
}

export interface CapabilityServiceHealthProjection {
  items: CapabilityServiceHealthItem[];
  aggregate: CapabilityHealthAggregate;
}

/**
 * Adds operator-facing health semantics to the single operational capability
 * boundary. Capability selection and dependency closure stay upstream.
 */
export function projectCapabilityServiceHealth(
  operational: OperationalCapabilityState,
): CapabilityServiceHealthProjection {
  const serviceRequirements = new Map(
    operational.serviceRequirements.map((requirement) => [requirement.service, requirement]),
  );
  if (serviceRequirements.size !== operational.serviceRequirements.length) {
    throw new Error("duplicate_service_requirement");
  }

  const catalogServiceKeys = new Set([
    ...serviceRequirements.keys(),
    ...Object.keys(operational.serviceStates),
  ]);
  for (const key of Object.keys(operational.observedServices)) {
    if (!catalogServiceKeys.has(key)) throw new Error(`unknown_service_observation:${key}`);
  }

  const externalRequirements = new Map(
    operational.externalRuntimes.map((runtime) => [runtime.runtimeKey, runtime]),
  );
  if (externalRequirements.size !== operational.externalRuntimes.length) {
    throw new Error("duplicate_external_runtime_requirement");
  }
  for (const key of Object.keys(operational.providerState)) {
    if (!externalRequirements.has(key)) throw new Error(`unknown_provider_observation:${key}`);
  }

  const items: CapabilityServiceHealthItem[] = [];
  for (const [key, state] of Object.entries(operational.serviceStates).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const requirement = serviceRequirements.get(key);
    if (state !== "optional_inactive" && !requirement) {
      throw new Error(`missing_active_service_requirement:${key}`);
    }
    const observed = operational.observedServices[key];

    if (state === "optional_inactive") {
      items.push({
        key,
        kind: "service",
        state,
        availability: "inactive",
        label: "Optional — inactive",
        action: "Enable its runtime capability when this service is needed.",
        tone: "neutral",
        healthSemantics: requirement?.healthSemantics ?? "capability-state",
      });
      continue;
    }

    if (state === "optional_degraded") {
      items.push({
        key,
        kind: "service",
        state,
        availability: "unavailable",
        label: "Optional — degraded",
        action: "Restore the enabled optional service or disable its runtime capability.",
        tone: "warning",
        healthSemantics: requirement!.healthSemantics,
      });
      continue;
    }

    const available = isAvailable(observed);
    items.push({
      key,
      kind: "service",
      state: "required",
      availability: available ? "available" : "unavailable",
      label: available ? "Required — operational" : "Required — unavailable",
      action: available
        ? "No action required."
        : "Restore the service and verify its configured health check.",
      tone: available ? "success" : "warning",
      healthSemantics: requirement!.healthSemantics,
    });
  }

  for (const [key, observed] of Object.entries(operational.providerState).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!observed.configured) continue;
    const requirement = externalRequirements.get(key)!;
    items.push({
      key,
      kind: "runtime",
      state: "external",
      availability: observed.healthy === false ? "unavailable" : "available",
      label: "External — provider managed",
      action:
        observed.healthy === false
          ? "Check provider status and the configured connection."
          : "Manage availability and credentials with the configured provider.",
      tone: observed.healthy === false ? "warning" : "neutral",
      healthSemantics: requirement.healthSemantics,
    });
  }

  const degraded = items.filter(
    (item) =>
      item.state === "optional_degraded" ||
      (item.state === "required" && item.availability === "unavailable"),
  );
  return {
    items,
    aggregate:
      degraded.length === 0
        ? {
            value: "Operational",
            tone: "success",
            detail: "Required platform services are available",
          }
        : {
            value: "Degraded",
            tone: "warning",
            detail: `${joinKeys(degraded.map((item) => item.key))} ${
              degraded.length === 1 ? "requires" : "require"
            } attention`,
          },
  };
}

function isAvailable(observed: ObservedServiceState | undefined): boolean {
  return observed?.composePresent === true && observed.healthy === true;
}

function joinKeys(keys: string[]): string {
  if (keys.length <= 1) return keys[0] ?? "Service";
  if (keys.length === 2) return `${keys[0]} and ${keys[1]}`;
  return `${keys.slice(0, -1).join(", ")}, and ${keys.at(-1)}`;
}
