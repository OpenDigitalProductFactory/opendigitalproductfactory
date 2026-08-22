// Pure, task-first setup + recovery model for a storefront owner (BI-C39DC90C).
//
// The live audit found /storefront dumped 17 competing actions, a 101-option
// service-line select, and generated "residue" a non-technical owner could not
// see or undo. This module turns the raw storefront data into:
//   • a small ordered set of setup TASKS with a plain status each,
//   • a generated-content INVENTORY grouped by what produced it, and
//   • an ADVANCED bucket that stays hidden until explicitly opened.
//
// No Prisma / React imports — callers load data and pass it in, and both the
// page and the UX-ceiling tests derive from one shape. The step VOCABULARY is
// archetype-driven (Menu / Tables / Reservations for a restaurant), so this is
// not restaurant-hardcoded — it just reads correctly for one.

import {
  analyzeSetupSurface,
  type SetupSurfaceDescriptor,
  type SetupUxReport,
} from "@dpf/validators";

export type SetupTaskStatus = "complete" | "attention" | "not-started";

export interface SetupTask {
  key: string;
  title: string;
  /** One plain sentence: what this step is for. */
  description: string;
  status: SetupTaskStatus;
  /** Short "what to do next" nudge when not complete. */
  hint?: string;
  /** Where the owner goes to work on it. */
  href: string;
}

export type GeneratedGroupState = "core" | "active" | "retained";

export interface GeneratedContentGroupInput {
  compositionId: string;
  name: string;
  category: string;
  role: "primary" | "secondary";
  itemsGenerated: number;
  sectionsGenerated: number;
  /** Retained = removed (soft-deleted) but its items/sections still exist. */
  retained?: boolean;
  /** Different category from the primary line — cross-industry expansion. */
  crossCategory?: boolean;
}

export interface GeneratedContentGroup {
  compositionId: string;
  name: string;
  role: "primary" | "secondary";
  state: GeneratedGroupState;
  itemsGenerated: number;
  sectionsGenerated: number;
  crossCategory: boolean;
  /** The core (primary) line is not removable; secondaries always are. */
  recoverable: boolean;
  /** Plain-language recovery action for this group. */
  recoveryLabel: string | null;
}

export interface SetupCapabilities {
  supportsResources: boolean;
  resourceLabel: string;
  resourceLabelSingular: string;
  supportsHours: boolean;
  supportsInbox: boolean;
}

export interface SetupModelInput {
  vocabulary: {
    itemsLabel: string;
    singleItemLabel: string;
    portalLabel: string;
    stakeholderLabel: string;
    teamLabel: string;
    inboxLabel: string;
  };
  capabilities: SetupCapabilities;
  config: {
    isPublished: boolean;
    hasTagline: boolean;
    hasHeroImage: boolean;
    hasContact: boolean;
  };
  content: {
    activeItemCount: number;
    visibleSectionCount: number;
  };
  resources: { count: number };
  availability: { operatingHoursConfigured: boolean };
  serviceLines: {
    primary: GeneratedContentGroupInput;
    secondaries: GeneratedContentGroupInput[];
    /** Removed lines whose generated content is retained (recoverable/purgeable). */
    retainedSecondaries: GeneratedContentGroupInput[];
  };
}

export interface StorefrontSetupModel {
  steps: SetupTask[];
  inventory: GeneratedContentGroup[];
  advanced: {
    /** Advanced / cross-industry expansion is collapsed until explicitly opened. */
    hidden: true;
    activeServiceLineCount: number;
    retainedServiceLineCount: number;
    hasCrossCategory: boolean;
  };
  summary: {
    completeCount: number;
    totalCount: number;
    published: boolean;
  };
}

// ─── Capability resolution (archetype-aware, not restaurant-hardcoded) ────────

const RESOURCE_LABELS: Record<string, { plural: string; singular: string }> = {
  "food-hospitality": { plural: "Tables", singular: "Table" },
  "beauty-personal-care": { plural: "Chairs & rooms", singular: "Station" },
  "healthcare-wellness": { plural: "Rooms", singular: "Room" },
  "fitness-recreation": { plural: "Spaces", singular: "Space" },
  "fabric-care-services": { plural: "Counters & stations", singular: "Station" },
  "agriculture-ranching": { plural: "Fields, pastures & pens", singular: "Area" },
  "manufacturing": { plural: "Lines, cells & stations", singular: "Work centre" },
};

/** Categories where the storefront is booking/availability-shaped. */
const BOOKING_CATEGORIES = new Set([
  "food-hospitality",
  "beauty-personal-care",
  "healthcare-wellness",
  "fitness-recreation",
  "pet-services",
  "professional-services",
  "fabric-care-services",
]);

export function resolveSetupCapabilities(
  category: string | null | undefined,
  modules: readonly string[] = [],
): SetupCapabilities {
  const cat = category ?? "";
  const isBooking = BOOKING_CATEGORIES.has(cat) || modules.includes("service-operations");
  const labels = RESOURCE_LABELS[cat] ?? { plural: "Resources", singular: "Resource" };
  return {
    supportsResources: isBooking,
    resourceLabel: labels.plural,
    resourceLabelSingular: labels.singular,
    supportsHours: isBooking,
    supportsInbox: true,
  };
}

// ─── Recovery labels ──────────────────────────────────────────────────────────

function recoveryLabelFor(state: GeneratedGroupState): string | null {
  switch (state) {
    case "core":
      return null; // the primary line is the storefront itself — not removable
    case "active":
      return "Remove line (undoable)";
    case "retained":
      return "Restore or remove permanently";
  }
}

function toGroup(input: GeneratedContentGroupInput): GeneratedContentGroup {
  const state: GeneratedGroupState =
    input.role === "primary" ? "core" : input.retained ? "retained" : "active";
  return {
    compositionId: input.compositionId,
    name: input.name,
    role: input.role,
    state,
    itemsGenerated: input.itemsGenerated,
    sectionsGenerated: input.sectionsGenerated,
    crossCategory: input.crossCategory ?? false,
    recoverable: input.role === "secondary",
    recoveryLabel: recoveryLabelFor(state),
  };
}

// ─── Model derivation ─────────────────────────────────────────────────────────

export function deriveStorefrontSetupModel(input: SetupModelInput): StorefrontSetupModel {
  const { vocabulary: v, capabilities: cap, config, content, resources, availability } = input;

  const steps: SetupTask[] = [];

  // 1 — Brand / public profile
  steps.push({
    key: "brand",
    title: "Brand & public profile",
    description: `Your name, tagline, hero image, and contact details — what ${v.stakeholderLabel.toLowerCase()} see first.`,
    status: config.hasTagline && config.hasContact ? "complete" : "attention",
    hint: config.hasTagline ? undefined : "Add a tagline and contact details.",
    href: "/storefront/settings/business",
  });

  // 2 — Archetype-owned public offerings. `itemsLabel` is already the complete
  // plural label; appending a guessed singular produced labels such as
  // "Campaigns & Appeals & campaigns".
  steps.push({
    key: "items",
    title: v.itemsLabel,
    description: `The ${v.itemsLabel.toLowerCase()} ${v.stakeholderLabel.toLowerCase()} browse and act on.`,
    status: content.activeItemCount > 0 ? "complete" : "not-started",
    hint: content.activeItemCount > 0 ? undefined : `Add your first ${v.singleItemLabel.toLowerCase()}.`,
    href: "/storefront/items",
  });

  // 3 — Tables / resources (booking-shaped archetypes only)
  if (cap.supportsResources) {
    steps.push({
      key: "resources",
      title: `${cap.resourceLabel} & ${v.teamLabel.toLowerCase()}`,
      description: `The ${cap.resourceLabel.toLowerCase()} and ${v.teamLabel.toLowerCase()} that ${v.inboxLabel.toLowerCase()} are assigned to.`,
      status: resources.count > 0 ? "complete" : "not-started",
      hint: resources.count > 0 ? undefined : `Add a ${cap.resourceLabelSingular.toLowerCase()}.`,
      href: "/storefront/team",
    });
  }

  // 4 — Hours / availability (booking-shaped archetypes only)
  if (cap.supportsHours) {
    steps.push({
      key: "hours",
      title: "Hours & availability",
      description: `When you are open, so ${v.inboxLabel.toLowerCase()} land on real slots.`,
      status: availability.operatingHoursConfigured ? "complete" : "attention",
      hint: availability.operatingHoursConfigured ? undefined : "Set your operating hours.",
      href: "/storefront/settings/operations",
    });
  }

  // 5 — Reservations / inbox
  if (cap.supportsInbox) {
    steps.push({
      key: "inbox",
      title: v.inboxLabel,
      description: `Where ${v.stakeholderLabel.toLowerCase()} requests arrive and you respond.`,
      // The inbox exists as soon as the storefront does; it is "ready", not a
      // blocking setup gate — surface it as complete once items exist to act on.
      status: content.activeItemCount > 0 ? "complete" : "not-started",
      hint: content.activeItemCount > 0 ? undefined : `Add ${v.itemsLabel.toLowerCase()} so ${v.stakeholderLabel.toLowerCase()} can reach you.`,
      href: "/storefront/inbox",
    });
  }

  const completeCount = steps.filter((s) => s.status === "complete").length;

  // ── Generated-content inventory ────────────────────────────────────────────
  const inventory: GeneratedContentGroup[] = [
    toGroup(input.serviceLines.primary),
    ...input.serviceLines.secondaries.map(toGroup),
    ...input.serviceLines.retainedSecondaries.map((g) => toGroup({ ...g, retained: true })),
  ];

  const hasCrossCategory = [
    ...input.serviceLines.secondaries,
    ...input.serviceLines.retainedSecondaries,
  ].some((g) => g.crossCategory);

  return {
    steps,
    inventory,
    advanced: {
      hidden: true,
      activeServiceLineCount: input.serviceLines.secondaries.length,
      retainedServiceLineCount: input.serviceLines.retainedSecondaries.length,
      hasCrossCategory,
    },
    summary: {
      completeCount,
      totalCount: steps.length,
      published: config.isPublished,
    },
  };
}

// ─── UX-ceiling surface descriptor ────────────────────────────────────────────

/**
 * Assemble the descriptor the setup surface presents so a test (or a runtime
 * audit) can hold it to the SETUP_UX_CEILINGS. `prose` is the visible copy the
 * component renders; `extraActions` are controls beyond the per-step links and
 * per-group recovery actions (e.g. Publish, the advanced disclosure toggle).
 *
 * Row-level recovery actions get a distinguishing accessible name ("Remove
 * Coffee Shop line") so they never trip the repeated-terse-label check, and the
 * advanced service-line option list is declared collapsed-until-opened.
 */
export function buildSetupSurfaceDescriptor(
  model: StorefrontSetupModel,
  opts: {
    route: string;
    prose: string;
    extraActions?: { label: string; accessibleLabel?: string }[];
    availableServiceLineCount?: number;
  },
): SetupSurfaceDescriptor {
  const stepActions = model.steps.map((s) => ({ label: s.title }));
  const recoveryActions = model.inventory
    .filter((g) => g.recoverable && g.recoveryLabel)
    .map((g) => ({ label: g.recoveryLabel as string, accessibleLabel: `${g.recoveryLabel} — ${g.name}` }));

  const recoverableGroups = model.inventory.filter((g) => g.role === "secondary");

  return {
    route: opts.route,
    text: opts.prose,
    actions: [...(opts.extraActions ?? []), ...stepActions, ...recoveryActions],
    optionGroups: opts.availableServiceLineCount
      ? [
          {
            label: "Add advanced service line",
            optionCount: opts.availableServiceLineCount,
            collapsedUntilOpened: true,
          },
        ]
      : [],
    recovery: {
      generatedGroups: recoverableGroups.length,
      recoverableGroups: recoverableGroups.filter((g) => g.recoverable).length,
    },
  };
}

/** Convenience: derive the model and immediately check its surface. */
export function auditSetupSurface(
  model: StorefrontSetupModel,
  opts: Parameters<typeof buildSetupSurfaceDescriptor>[1],
): SetupUxReport {
  return analyzeSetupSurface(buildSetupSurfaceDescriptor(model, opts));
}
