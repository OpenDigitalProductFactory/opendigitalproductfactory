import {
  BASELINE_WORKSPACE_HOME_SLOT_IDS,
  type WorkspaceHomeComponentDescriptor,
  type WorkspaceHomeContribution,
  type WorkspaceHomeRegistry,
  type WorkspaceHomeResolution,
  type WorkspaceHomeStorefrontConfigRef,
  type WorkspaceHomeValidationResult,
} from "./types";

export { BASELINE_WORKSPACE_HOME_SLOT_IDS };
export type {
  WorkspaceHomeComponentDescriptor,
  WorkspaceHomeContribution,
  WorkspaceHomeRegistry,
  WorkspaceHomeResolution,
  WorkspaceHomeStorefrontConfigRef,
};

const WORKSPACE_HOME_COMPONENT_KEYS = new Set<string>([
  "today-now-strip",
  "service-queue",
  "customer-map",
  "customer-health-map",
  "exception-queue",
  "coworker-handoff-list",
  "metric-tile",
  "calendar-panel",
  "activity-feed-panel",
  "platform-tile-grid",
]);

const WORKSPACE_HOME_DATA_REF_KINDS = new Set(["projection", "canonical-data", "signal"]);

export function createWorkspaceHomeRegistry(
  contributions: WorkspaceHomeContribution[] = [],
): WorkspaceHomeRegistry {
  const registry: WorkspaceHomeRegistry = {
    contributions: [],
    componentKeys: WORKSPACE_HOME_COMPONENT_KEYS,
  };

  for (const contribution of contributions) {
    registerWorkspaceHomeContribution(registry, contribution);
  }

  return registry;
}

export const defaultWorkspaceHomeRegistry = createWorkspaceHomeRegistry();

export function registerWorkspaceHomeContribution(
  registry: WorkspaceHomeRegistry,
  contribution: WorkspaceHomeContribution,
): WorkspaceHomeRegistry {
  const validation = validateWorkspaceHomeContribution(contribution);
  if (!validation.ok) {
    throw new Error(validation.errors.join("; "));
  }

  registry.contributions.push(contribution);
  return registry;
}

export function validateWorkspaceHomeContribution(
  contribution: WorkspaceHomeContribution,
): WorkspaceHomeValidationResult {
  const errors: string[] = [];
  const slotIds = new Set(contribution.slots.map((slot) => slot.id));

  for (const baselineSlotId of BASELINE_WORKSPACE_HOME_SLOT_IDS) {
    if (!slotIds.has(baselineSlotId)) {
      errors.push(`missing baseline slot: ${baselineSlotId}`);
    }
  }

  for (const component of contribution.components) {
    const validation = validateWorkspaceHomeComponent(component);
    errors.push(...validation.errors);
    if (!slotIds.has(component.slotId)) {
      errors.push(`component ${component.key} references unknown slot: ${component.slotId}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function validateWorkspaceHomeComponent(
  component: WorkspaceHomeComponentDescriptor,
): WorkspaceHomeValidationResult {
  const errors: string[] = [];

  if (!WORKSPACE_HOME_COMPONENT_KEYS.has(component.key)) {
    return {
      ok: false,
      errors: [`unknown component key: ${component.key}`],
      placeholder: {
        componentKey: component.key,
        reason: "unknown-component-key",
      },
    };
  }

  for (const dataRef of component.dataRefs) {
    const kind = typeof dataRef.kind === "string" ? dataRef.kind : "";
    if (!WORKSPACE_HOME_DATA_REF_KINDS.has(kind)) {
      errors.push(`unsupported dataRef kind: ${kind}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    placeholder: errors.length
      ? {
          componentKey: component.key,
          reason: "invalid-data-ref",
        }
      : undefined,
  };
}

export function resolveWorkspaceHomeContribution({
  storefrontConfig,
  registry = defaultWorkspaceHomeRegistry,
}: {
  storefrontConfig: WorkspaceHomeStorefrontConfigRef;
  registry?: WorkspaceHomeRegistry;
}): WorkspaceHomeResolution {
  const archetype = storefrontConfig?.archetype;
  if (!archetype?.archetypeId && !archetype?.category) {
    return unconfiguredWorkspaceHomeResolution();
  }

  const exact = archetype.archetypeId
    ? registry.contributions.find((contribution) =>
        contribution.semanticArchetypeIds.includes(archetype.archetypeId ?? ""),
      )
    : null;

  if (exact) {
    return {
      mode: "vertical",
      match: "exact",
      contribution: exact,
      fallback: null,
      setupAction: null,
    };
  }

  const category = archetype.category
    ? registry.contributions.find((contribution) =>
        contribution.archetypeCategories.includes(archetype.category ?? ""),
      )
    : null;

  if (category) {
    return {
      mode: "vertical",
      match: "category",
      contribution: category,
      fallback: null,
      setupAction: null,
    };
  }

  return unconfiguredWorkspaceHomeResolution();
}

function unconfiguredWorkspaceHomeResolution(): WorkspaceHomeResolution {
  return {
    mode: "unconfigured",
    match: "none",
    contribution: null,
    fallback: "platform",
    setupAction: "choose-or-finish-business-setup",
  };
}
