export const BASELINE_WORKSPACE_HOME_SLOT_IDS = [
  "today-now",
  "exceptions-needs-review",
  "coworker-handoffs",
] as const;

export type BaselineWorkspaceHomeSlotId = (typeof BASELINE_WORKSPACE_HOME_SLOT_IDS)[number];

export type WorkspaceHomeSlotId = BaselineWorkspaceHomeSlotId | string;

/**
 * Reusable primitive family keys. Each value names a widget *family* — concrete
 * renderers ({@link WorkspaceHomeComponentKey}) implement one primitive in a
 * vertical-specific form.
 *
 * Source: docs/superpowers/specs/2026-05-24-workspace-home-primitive-registry-design.md §4
 * (the 11 canonical primitives) — replaces the provisional 10-key set the substrate shipped
 * in PR #1237 as a boundary "BI-5B8FE5C1 fills out" (substrate sign-off ADR follow-ups).
 *
 * Mapping from the provisional substrate set:
 *
 *   today-strip          → folded into decision-queue semantics (deprecated)
 *   service-queue        → decision-queue
 *   customer-map         → geo-map
 *   customer-health-map  → health-board
 *   exception-list       → folded into decision-queue (deprecated)
 *   coworker-handoffs    → handoff-queue
 *   metric-tile          → out of scope; PlatformWorkspaceHome owns platform tiles
 *   calendar             → appointment-schedule
 *   activity-feed        → out of scope; PlatformWorkspaceHome owns the activity feed
 *   platform-tiles       → out of scope; PlatformWorkspaceHome owns the platform fallback
 *
 * Two new keys land alongside the rename — see the primitive-registry spec §4:
 *   - appointment-schedule (replaces the provisional `calendar`; per-attendee/per-slot semantics)
 *   - volunteer-program-board (recurring shift sign-ups / hour-tracking / role pairing)
 *
 * Plus four families the provisional substrate had no equivalent for:
 *   - capacity-lanes, inventory-watch, case-board, service-period-board, communication-exceptions.
 */
export type WorkspaceHomePrimitiveKey =
  | "decision-queue"
  | "geo-map"
  | "capacity-lanes"
  | "health-board"
  | "inventory-watch"
  | "case-board"
  | "service-period-board"
  | "communication-exceptions"
  | "handoff-queue"
  | "appointment-schedule"
  | "volunteer-program-board";

/**
 * Concrete renderer keys. Each value names a specific component that implements
 * one primitive in vertical-specific vocabulary. Per parent spec §5.5: "A
 * component may be reused across archetypes when only vocabulary differs; it
 * should fork only when the operating model changes."
 *
 * Source: docs/superpowers/specs/2026-05-24-vertical-workspace-home-design.md §5.5
 * (initial set of registered component keys). Per the substrate's existing
 * `WorkspaceHomeComponentDescriptor.key: WorkspaceHomeComponentKey | string`
 * escape, additional vertical-specific component keys may be added at the
 * contribution layer; this union enumerates the substrate-known set.
 *
 * Replaces the provisional 10-key set with the parent-spec-canonical 11.
 */
export type WorkspaceHomeComponentKey =
  | "today-schedule"
  | "unassigned-work"
  | "technician-load"
  | "customer-callbacks"
  | "customer-map"
  | "parts-watch"
  | "notification-status"
  | "inventory-alerts"
  | "patient-queue"
  | "retail-replenishment"
  | "coworker-handoffs"
  | "shift-summary"
  // Warehousing & fulfilment. Distinct from `retail-replenishment` and
  // `inventory-alerts`: those watch stock the business owns and needs to
  // reorder; this watches count variances against a client's stock held in
  // custody, where the discrepancy itself is the reportable event.
  | "stock-accuracy"
  | "dock-capacity"
  // Fabric care services: claim-ticket custody and ready-promise throughput
  // across counter, plant, workroom, and pickup/delivery route flow.
  | "plant-capacity"
  | "ticket-exceptions"
  | "garment-tracking";

export type WorkspaceHomeDataRefKind = "projection" | "canonical-data" | "signal";

export type WorkspaceHomeDataRef = {
  kind: WorkspaceHomeDataRefKind;
  key: string;
  required: boolean;
};

/**
 * Presentation grouping above the baseline slot covenant.
 *
 * Architect amendment (PR #1412 / docs/superpowers/specs/2026-05-31-archetype-aware-workspace-design.md):
 * lets a contribution declare *how* a slot reads on the worker home — front-and-center
 * (`critical-strip`, `primary`), supporting (`secondary`, `briefing`), or admin-only
 * (`setup`) — without forking the slot covenant or the primitive registry. When absent,
 * a downstream renderer may derive a default zone from existing ordering signals; the
 * substrate stores the value verbatim and does no derivation here.
 */
export const WORKSPACE_HOME_SLOT_ZONES = [
  "critical-strip",
  "primary",
  "secondary",
  "briefing",
  "setup",
] as const;

export type WorkspaceHomeSlotZone = (typeof WORKSPACE_HOME_SLOT_ZONES)[number];

export type WorkspaceHomeSlot = {
  id: WorkspaceHomeSlotId;
  label: string;
  /**
   * Optional presentation grouping. See {@link WorkspaceHomeSlotZone}.
   * Architect amendment — additive; existing contributions need no change.
   */
  zone?: WorkspaceHomeSlotZone;
};

export type WorkspaceHomeComponentDescriptor = {
  key: WorkspaceHomeComponentKey | string;
  slotId: WorkspaceHomeSlotId;
  primitiveKey: WorkspaceHomePrimitiveKey | string;
  title: string;
  dataRefs: Array<WorkspaceHomeDataRef | Record<string, unknown>>;
};

export type WorkspaceHomeSetupActivationStatus = "ready" | "not-configured" | "needs-data";

export type WorkspaceHomeSetupActivation = {
  status: WorkspaceHomeSetupActivationStatus;
  primitiveWidgets: WorkspaceHomePrimitiveKey[];
  requiredCanonicalData: string[];
  requiredSignals: string[];
  missingDataBehavior: "render-empty-state" | "platform-fallback" | "hide-widget";
};

export type WorkspaceHomeContribution = {
  id: string;
  label: string;
  description?: string;
  /**
   * Worker-facing question this home is built to answer first.
   *
   * Architect amendment (PR #1412 / docs/superpowers/specs/2026-05-31-archetype-aware-workspace-design.md):
   * names "what one question the worker arrives asking" — e.g. an HVAC dispatcher's
   * "what's on the board today?", an MSP operator's "what's red on the estate?".
   * Surfaces in business-setup activation summaries so admins can see the framing the
   * vertical home commits to. Optional and additive; absent on substrate-only delivery.
   */
  primaryOperatingQuestion?: string;
  /**
   * Ranked worker/operator concerns this home must make visible first.
   *
   * This is the archetype-profile guardrail from the configurable Workspace
   * design: every production profile must name the concrete worries it is
   * designed around so future archetypes cannot silently inherit a generic
   * dashboard with no operating-model fit.
   */
  topConcerns: string[];
  semanticArchetypeIds: string[];
  archetypeCategories: string[];
  setupActivation: WorkspaceHomeSetupActivation;
  slots: WorkspaceHomeSlot[];
  components: WorkspaceHomeComponentDescriptor[];
};

export type WorkspaceHomeRegistry = {
  contributions: WorkspaceHomeContribution[];
  componentKeys: ReadonlySet<string>;
};

export type WorkspaceHomeArchetypeRef = {
  archetypeId: string | null;
  category: string | null;
  name?: string | null;
  activationProfile?: unknown;
};

export type WorkspaceHomeStorefrontConfigRef = {
  archetype?: WorkspaceHomeArchetypeRef | null;
} | null;

export type WorkspaceHomeMatchKind = "exact" | "category" | "none";

export type WorkspaceHomeResolution =
  | {
      mode: "vertical";
      match: Exclude<WorkspaceHomeMatchKind, "none">;
      contribution: WorkspaceHomeContribution;
      fallback: null;
      setupAction: null;
    }
  | {
      mode: "unconfigured";
      match: "none";
      contribution: null;
      fallback: "platform";
      setupAction: "choose-or-finish-business-setup";
    };

export type WorkspaceHomeSetupActivationSummary = {
  archetypeId: string | null;
  archetypeName: string | null;
  mode: WorkspaceHomeResolution["mode"];
  match: WorkspaceHomeMatchKind;
  label: string;
  status: WorkspaceHomeSetupActivationStatus;
  sourceContributionId: string | null;
  /**
   * Projection of {@link WorkspaceHomeContribution.primaryOperatingQuestion} for setup
   * surfaces. `null` when the contribution does not declare one or when no contribution
   * matched (mode `unconfigured`). Honest absence — setup never invents a question.
   */
  primaryOperatingQuestion: string | null;
  topConcerns: string[];
  primitiveWidgets: WorkspaceHomePrimitiveKey[];
  requiredCanonicalData: string[];
  requiredSignals: string[];
  missingDataBehavior: WorkspaceHomeSetupActivation["missingDataBehavior"];
  fallback: "platform" | null;
  setupAction: WorkspaceHomeResolution["setupAction"];
};

export type WorkspaceHomeValidationResult = {
  ok: boolean;
  errors: string[];
  placeholder?: {
    componentKey: string;
    reason: "unknown-component-key" | "invalid-data-ref";
  };
};
