import type {
  ResourceCapacityAuthority,
  ResourceCapacityProfile,
} from "@dpf/storefront-templates";
import type {
  CapacityAllocation,
  CapacityAttentionSignal,
  CapacityAvailability,
  CapacityResource,
  CapacitySourceWatermark,
  CapacityWindow,
} from "./contracts";

export interface CapacityAdapterLoadInput {
  profile: ResourceCapacityProfile;
  organizationId: string;
  window: CapacityWindow;
}

export interface CapacityAdapterLoadResult {
  authority: ResourceCapacityAuthority;
  state: "ok" | "unsupported" | "degraded";
  resources: CapacityResource[];
  allocations: CapacityAllocation[];
  availability: CapacityAvailability[];
  attentionSignals?: CapacityAttentionSignal[];
  diagnostic?: string;
  watermark?: CapacitySourceWatermark;
}
