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

export type WorkspaceHomeSlot = {
  id: WorkspaceHomeSlotId;
  label: string;
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
