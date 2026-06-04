export const BASELINE_WORKSPACE_HOME_SLOT_IDS = [
  "today-now",
  "exceptions-needs-review",
  "coworker-handoffs",
] as const;

export type BaselineWorkspaceHomeSlotId = (typeof BASELINE_WORKSPACE_HOME_SLOT_IDS)[number];

export type WorkspaceHomeSlotId = BaselineWorkspaceHomeSlotId | string;

export type WorkspaceHomePrimitiveKey =
  | "today-strip"
  | "service-queue"
  | "customer-map"
  | "customer-health-map"
  | "exception-list"
  | "coworker-handoffs"
  | "metric-tile"
  | "calendar"
  | "activity-feed"
  | "platform-tiles";

export type WorkspaceHomeComponentKey =
  | "today-now-strip"
  | "service-queue"
  | "customer-map"
  | "customer-health-map"
  | "exception-queue"
  | "coworker-handoff-list"
  | "metric-tile"
  | "calendar-panel"
  | "activity-feed-panel"
  | "platform-tile-grid";

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
