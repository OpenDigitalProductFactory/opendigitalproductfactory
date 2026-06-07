// apps/web/lib/workspace-home/activation-orchestrator/index.ts
//
// Phase 1 public surface for the archetype-driven workspace-home setup
// activation orchestrator (BI-B14D6CF6). Phases 2-7 (setup task generator,
// signal binder, empty-state coordinator, demo-seed gate, reconciliation
// cadence, /api/storefront/admin/setup integration) extend this barrel as
// they land.

export {
  buildActivationPlan,
  type BuildActivationPlanOptions,
} from "./walker";

export {
  DEFAULT_CANONICAL_DATA_REGISTRY,
  getCanonicalDataEntry,
  type CanonicalDataRegistryEntry,
} from "./canonical-data-registry";

export {
  DEFAULT_SIGNAL_REGISTRY,
  getSignalEntry,
  type SignalRegistryEntry,
} from "./signal-registry";

export type {
  ActivationPlan,
  CanonicalDataWalkResult,
  SignalBindingWalkResult,
  SlotBehaviorWalkResult,
} from "./types";
