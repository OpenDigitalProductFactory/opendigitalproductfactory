import {
  BASELINE_WORKSPACE_HOME_SLOT_IDS,
  type WorkspaceHomeComponentDescriptor,
  type WorkspaceHomeContribution,
  type WorkspaceHomeMatchKind,
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
  // Fabric care services (2026-07-22 archetype). Kept in lockstep with
  // WorkspaceHomeComponentKey in types.ts for the fail-closed registry guard.
  "plant-capacity",
  "ticket-exceptions",
  "garment-tracking",
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

/** An occupation-scoped contribution declares one or more occupationKeys. */
function isOccupationScoped(contribution: WorkspaceHomeContribution): boolean {
  return Array.isArray(contribution.occupationKeys) && contribution.occupationKeys.length > 0;
}

function verticalResolution(
  match: Exclude<WorkspaceHomeMatchKind, "none">,
  contribution: WorkspaceHomeContribution,
): WorkspaceHomeResolution {
  return { mode: "vertical", match, contribution, fallback: null, setupAction: null };
}

/**
 * Resolve the workspace-home contribution for a signed-in employee (EP-EMPLOYEE-OCCUPATION
 * P2, spec §5.3). Most-specific-wins over five tiers, every step falling through honestly:
 *   1. archetypeId × occupation  — occupation home for this exact business type
 *   2. category × occupation      — occupation home generic across the industry
 *   3. archetypeId                — existing archetype-level home (unchanged)
 *   4. category                   — existing category-level home (unchanged)
 *   5. platform fallback          — unconfigured → PlatformWorkspaceHome
 *
 * `occupationKey` is the signed-in employee's resolved occupation (from the P1 resolver,
 * apps/web/lib/workforce/occupation.ts). Absent/empty → tiers 1-2 are skipped and behaviour
 * is exactly as before this change. Occupation-scoped contributions are excluded from the
 * archetype/category tiers so one occupation's home never leaks to every worker of the archetype.
 */
export function resolveWorkspaceHomeContribution({
  storefrontConfig,
  occupationKey = null,
  registry = defaultWorkspaceHomeRegistry,
}: {
  storefrontConfig: WorkspaceHomeStorefrontConfigRef;
  occupationKey?: string | null;
  registry?: WorkspaceHomeRegistry;
}): WorkspaceHomeResolution {
  const archetype = storefrontConfig?.archetype;
  if (!archetype?.archetypeId && !archetype?.category) {
    return unconfiguredWorkspaceHomeResolution();
  }

  const archetypeId = archetype.archetypeId ?? "";
  const category = archetype.category ?? "";
  const occ =
    typeof occupationKey === "string" && occupationKey.length > 0 ? occupationKey : null;

  // Tier 1 — archetypeId × occupation.
  if (occ && archetypeId) {
    const match = registry.contributions.find(
      (c) => c.semanticArchetypeIds.includes(archetypeId) && (c.occupationKeys ?? []).includes(occ),
    );
    if (match) return verticalResolution("archetype-occupation", match);
  }

  // Tier 2 — category × occupation.
  if (occ && category) {
    const match = registry.contributions.find(
      (c) => c.archetypeCategories.includes(category) && (c.occupationKeys ?? []).includes(occ),
    );
    if (match) return verticalResolution("category-occupation", match);
  }

  // Tier 3 — archetypeId (archetype-level home only; occupation-scoped excluded).
  if (archetypeId) {
    const match = registry.contributions.find(
      (c) => !isOccupationScoped(c) && c.semanticArchetypeIds.includes(archetypeId),
    );
    if (match) return verticalResolution("exact", match);
  }

  // Tier 4 — category (archetype-level home only).
  if (category) {
    const match = registry.contributions.find(
      (c) => !isOccupationScoped(c) && c.archetypeCategories.includes(category),
    );
    if (match) return verticalResolution("category", match);
  }

  // Tier 5 — platform fallback.
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
