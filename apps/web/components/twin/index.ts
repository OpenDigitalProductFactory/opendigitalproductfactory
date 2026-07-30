// apps/web/components/twin/index.ts
//
// The Operational Twin grammar kit (EP-LIVING-BUSINESS-VIZ P2). Ten presentational
// primitives every twin composes from, on the `--dpf-*` token + report-kit
// substrate. A template (P3) binds a `TwinProfile` (@dpf/storefront-templates) +
// a live snapshot to these props.
//
// Spec: docs/superpowers/specs/2026-07-12-operational-twin-framework-design.md §3
// Plan: docs/superpowers/plans/2026-07-12-operational-twin-framework-execution.md P2

export * from "./types";
export { ActorMark, type ActorMarkProps } from "./ActorMark";
export { CapacityChip, CapacityChips, type CapacityChipsProps } from "./CapacityChips";
export { TwinZone, type TwinZoneProps } from "./TwinZone";
export {
  ResourceUnit,
  ResourceUnitGrid,
  type ResourceUnitGridProps,
} from "./ResourceUnit";
export { WorkItem } from "./WorkItem";
export { TwinQueue, type TwinQueueProps } from "./TwinQueue";
export { CogBanner, type CogBannerProps } from "./CogBanner";
export { UtilityBand, type UtilityBandProps } from "./UtilityBand";
export { PresenceRow, type PresenceRowProps } from "./PresenceRow";
export { AttributedFeed, type AttributedFeedProps } from "./AttributedFeed";
export { NeedsYouQuests, type NeedsYouQuestsProps } from "./NeedsYouQuests";

// P3 — the profile-driven renderer + its live-data contract.
export { TwinView, type TwinViewProps } from "./TwinView";
export { ValueStreamStrip, type ValueStreamStripProps } from "./ValueStreamStrip";
export { OutcomesStrip, type OutcomesStripProps } from "./OutcomesStrip";
export {
  type TwinSnapshot,
  type TwinZoneSnapshot,
  type TwinQueueSnapshot,
  type TwinCogSnapshot,
  type TwinStageFlow,
  type TwinOutcome,
} from "./snapshot";
export { buildDemoTwinSnapshot } from "./demo-snapshot";

// Spatial operational-scene renderer. Archetype adapters supply geometry,
// live presentation bindings, and authorized domain commands.
export {
  CartesianSceneCanvas,
  type CartesianSceneCanvasProps,
  type CartesianScenePersistence,
  type CartesianSceneSaveInput,
} from "./cartesian/CartesianSceneCanvas";
