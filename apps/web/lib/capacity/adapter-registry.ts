import type {
  ResourceCapacityPattern,
  ResourceCapacityAuthority,
  ResourceCapacityProfile,
} from "@dpf/storefront-templates";
import type {
  CapacityAdapterLoadResult,
  CapacityAdapterLoadInput,
} from "./adapter-types";
import {
  capacityResourceRefKey,
  type CapacityAttentionSignal,
  type CapacitySnapshot,
  type CapacityWindow,
} from "./contracts";

export interface CapacityAdapterDescriptor {
  authority: ResourceCapacityAuthority;
  patterns: ResourceCapacityPattern[];
  canonicalSources: string[];
}

/**
 * The bounded-context ownership map. Descriptors are not registrations: a
 * vertical still supplies a loader and the registry reports it degraded until
 * that loader exists.
 */
export const CAPACITY_ADAPTER_DESCRIPTORS: CapacityAdapterDescriptor[] = [
  {
    authority: "provider-calendar",
    patterns: ["appointment", "class"],
    canonicalSources: ["ServiceProvider", "ProviderService", "ProviderAvailability", "StorefrontBooking", "BookingHold"],
  },
  {
    authority: "staffing",
    patterns: ["appointment", "dispatch", "class", "venue", "project-resource", "service-floor", "occupancy"],
    canonicalSources: ["StaffingShift", "StaffingAssignment", "StaffingResourceLink"],
  },
  {
    authority: "hospitality",
    patterns: ["service-floor", "venue"],
    canonicalSources: ["HospitalityResource", "HospitalityResourceAvailability", "HospitalityCapacityAllocation"],
  },
  {
    authority: "beauty",
    patterns: ["appointment"],
    canonicalSources: ["BeautyResource", "BeautyResourceService", "BeautyResourceAvailability", "BeautyCapacityAllocation"],
  },
  {
    authority: "care",
    patterns: ["appointment", "occupancy"],
    canonicalSources: ["CareResource", "CareAppointmentResource", "CareAppointment"],
  },
  {
    authority: "rental",
    patterns: ["rental"],
    canonicalSources: ["RentableUnit", "RentalAgreement", "BookingHold"],
  },
  {
    authority: "field-operations",
    patterns: ["dispatch", "project-resource"],
    canonicalSources: ["CustomerSite", "StaffingShift", "StaffingResourceLink"],
  },
  {
    authority: "venue-operations",
    patterns: ["venue"],
    canonicalSources: ["StorefrontBooking", "StaffingShift", "StaffingResourceLink"],
  },
];

export interface CapacityAdapter {
  authority: ResourceCapacityAuthority;
  load(input: CapacityAdapterLoadInput): Promise<CapacityAdapterLoadResult>;
}

export class CapacityAdapterRegistry {
  private readonly adapters = new Map<ResourceCapacityAuthority, CapacityAdapter>();

  constructor(adapters: readonly CapacityAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: CapacityAdapter): void {
    if (this.adapters.has(adapter.authority)) {
      throw new Error(`Capacity adapter ${adapter.authority} is already registered`);
    }
    this.adapters.set(adapter.authority, adapter);
  }

  get(authority: ResourceCapacityAuthority): CapacityAdapter | undefined {
    return this.adapters.get(authority);
  }
}

function degradedSignal(
  authority: ResourceCapacityAuthority,
  diagnostic: string,
): CapacityAttentionSignal {
  return {
    signalId: `source-degraded:${authority}`,
    kind: "source-degraded",
    authority,
    detail: diagnostic,
  };
}

export async function projectCapacitySnapshot(input: {
  profile: ResourceCapacityProfile;
  organizationId: string;
  window: CapacityWindow;
  registry: CapacityAdapterRegistry;
}): Promise<CapacitySnapshot> {
  if (!input.profile.enabled) {
    return {
      profile: input.profile,
      organizationId: input.organizationId,
      window: input.window,
      resources: [],
      allocations: [],
      availability: [],
      sourceStates: [],
      attentionSignals: [],
    };
  }

  const results = await Promise.all(
    input.profile.authorities.map(
      async (authority): Promise<CapacityAdapterLoadResult> => {
        const adapter = input.registry.get(authority);
        if (!adapter) {
          return {
            authority,
            state: "degraded",
            resources: [],
            allocations: [],
            availability: [],
            diagnostic: `No ${authority} capacity adapter is registered`,
          };
        }
        return adapter.load({
          profile: input.profile,
          organizationId: input.organizationId,
          window: input.window,
        });
      },
    ),
  );

  for (const result of results) {
    const crossOrganization = result.resources.find(
      (resource) => resource.organizationId !== input.organizationId,
    );
    if (crossOrganization) {
      throw new Error(
        `Capacity adapter ${result.authority} violated organization scope for ${capacityResourceRefKey(crossOrganization.ref)}`,
      );
    }
  }

  return {
    profile: input.profile,
    organizationId: input.organizationId,
    window: input.window,
    resources: results.flatMap((result) => result.resources),
    allocations: results.flatMap((result) => result.allocations),
    availability: results.flatMap((result) => result.availability),
    sourceStates: results.map((result) => ({
      authority: result.authority,
      state: result.state,
      ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
      ...(result.watermark ? { watermark: result.watermark } : {}),
    })),
    attentionSignals: results.flatMap((result) => [
      ...(result.attentionSignals ?? []),
      ...(result.state === "degraded"
        ? [degradedSignal(result.authority, result.diagnostic ?? `${result.authority} source is degraded`)]
        : []),
    ]),
  };
}
