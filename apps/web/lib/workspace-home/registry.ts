import {
  BASELINE_WORKSPACE_HOME_SLOT_IDS,
  type WorkspaceHomeComponentDescriptor,
  type WorkspaceHomeContribution,
  type WorkspaceHomeRegistry,
  type WorkspaceHomeResolution,
  type WorkspaceHomeStorefrontConfigRef,
  type WorkspaceHomeValidationResult,
} from "./types";
import { DEFAULT_WORKSPACE_HOME_CONTRIBUTIONS } from "./profiles";

export { BASELINE_WORKSPACE_HOME_SLOT_IDS };
export type {
  WorkspaceHomeComponentDescriptor,
  WorkspaceHomeContribution,
  WorkspaceHomeRegistry,
  WorkspaceHomeResolution,
  WorkspaceHomeStorefrontConfigRef,
};

// The 11 spec-canonical component-renderer keys from parent §5.5 (vertical
// workspace home design spec). Substrate-known set; additional vertical-
// specific component keys may be added at the contribution layer via the
// WorkspaceHomeComponentDescriptor.key `| string` escape.
// BI-5B8FE5C1 Phase 1 rename — replaces the provisional substrate names from
// PR #1237 with the parent-spec-canonical set the substrate sign-off ADR named
// as a "boundary BI-5B8FE5C1 fills out" follow-up.
const WORKSPACE_HOME_COMPONENT_KEYS = new Set<string>([
  "today-schedule",
  "unassigned-work",
  "technician-load",
  "customer-callbacks",
  "customer-map",
  "parts-watch",
  "notification-status",
  "inventory-alerts",
  "patient-queue",
  "retail-replenishment",
  "coworker-handoffs",
  "shift-summary",
  // Warehousing & fulfilment (2026-07-21 archetype). Kept in lockstep with
  // WorkspaceHomeComponentKey in types.ts — the registry fails closed on an
  // unknown key, so a profile referencing a key missing here breaks the
  // production build at page-data collection, not at typecheck.
  "stock-accuracy",
  "dock-capacity",
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

export const defaultWorkspaceHomeRegistry = createWorkspaceHomeRegistry(
  DEFAULT_WORKSPACE_HOME_CONTRIBUTIONS,
);

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

  if (!Array.isArray(contribution.topConcerns) || contribution.topConcerns.length === 0) {
    errors.push(`contribution ${contribution.id} must declare ranked topConcerns`);
  }

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
