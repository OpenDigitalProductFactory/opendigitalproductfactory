// Pure helper: derive a human-readable composition view from archetype template
// data. No Prisma imports — callers load data and pass it in.

import type { Intent } from "@/components/ui/report-kit/statusColors";
import type { ActivationProfile, ArchetypeModule } from "@dpf/storefront-templates";

export type CompositionCompatibilityStatus =
  | "good"
  | "concern"
  | "acute"
  | "in-motion"
  | "unknown";

export type VisualPattern =
  | "standard-flow"
  | "slot-board"
  | "map-dispatch"
  | "asset-pool-board"
  | "stock-reorder-board"
  | "case-queue"
  | "trust-gate-board";

export interface StorefrontCompositionTemplateRef {
  compositionId: string;
  archetypeSlug: string;
  name: string;
  category: string;
  activationProfile: ActivationProfile | null;
}

export interface StorefrontServiceLineView {
  compositionId: string;
  role: "primary" | "secondary";
  archetypeSlug: string;
  name: string;
  category: string;
  operatorLabel: string;
  visualPattern: VisualPattern;
  status: CompositionCompatibilityStatus;
  statusLabel: string;
  statusIntent: Intent;
  statusIconName: string;
  contributedModules: ArchetypeModule[];
  contributedServiceCategories: string[];
  contributedItemCount: number;
  contributedSectionCount: number;
  warnings: string[];
}

export interface StorefrontCompositionView {
  storefrontId: string;
  primary: StorefrontServiceLineView;
  secondaries: StorefrontServiceLineView[];
  compatibilitySummary: {
    status: CompositionCompatibilityStatus;
    label: string;
    reasons: string[];
  };
}

// ─── Visual pattern ───────────────────────────────────────────────────────────

function resolveVisualPattern(
  category: string,
  modules: ArchetypeModule[],
): VisualPattern {
  if (category === "banking-financial-services" || category === "public-sector") {
    return "trust-gate-board";
  }
  if (category === "asset-rental") return "asset-pool-board";
  if (category === "retail-goods") return "stock-reorder-board";
  if (
    category === "hoa-property-management" ||
    (category === "professional-services" && !modules.includes("projects"))
  ) {
    return "case-queue";
  }
  if (
    modules.includes("service-operations") &&
    (category === "trades-maintenance" ||
      category === "facilities-maintenance" ||
      category === "automotive-services" ||
      category === "moving-and-logistics" ||
      category === "security-services")
  ) {
    return "map-dispatch";
  }
  if (
    category === "fitness-recreation" ||
    category === "beauty-personal-care" ||
    (category === "healthcare-wellness" && !modules.includes("customer-estate"))
  ) {
    return "slot-board";
  }
  return "standard-flow";
}

// ─── Compatibility ────────────────────────────────────────────────────────────

// Trust/compliance blocks: combinations where identity, regulatory model, or
// customer-data governance would be misleading without an explicit design.
const ACUTE_PAIRS = new Set<string>([
  "banking-financial-services|healthcare-wellness",
  "healthcare-wellness|banking-financial-services",
  "public-sector|banking-financial-services",
  "banking-financial-services|public-sector",
  "public-sector|retail-goods",
  "public-sector|fitness-recreation",
  "public-sector|beauty-personal-care",
  "public-sector|food-hospitality",
  "public-sector|professional-services",
]);

function resolveCompatibility(
  primaryCategory: string,
  secondaryCategory: string,
): { status: CompositionCompatibilityStatus; reason: string } {
  if (primaryCategory === secondaryCategory) {
    return { status: "good", reason: "Same service category — no capability conflicts." };
  }
  const pair = `${primaryCategory}|${secondaryCategory}`;
  if (ACUTE_PAIRS.has(pair)) {
    return {
      status: "acute",
      reason: `${primaryCategory} and ${secondaryCategory} carry different trust, compliance, or identity models. Confirm your operating design before enabling.`,
    };
  }
  return {
    status: "concern",
    reason: `Cross-category addition: ${secondaryCategory} introduces different capability requirements, vocabulary, and operating axes. Review before confirming.`,
  };
}

// ─── Operator label ───────────────────────────────────────────────────────────

const STATUS_LABELS: Record<CompositionCompatibilityStatus, string> = {
  good: "Compatible",
  concern: "Review recommended",
  acute: "Confirm design first",
  "in-motion": "Applying…",
  unknown: "Metadata missing",
};

const STATUS_ICONS: Record<CompositionCompatibilityStatus, string> = {
  good: "check-circle",
  concern: "alert-triangle",
  acute: "shield-alert",
  "in-motion": "loader",
  unknown: "help-circle",
};

const STATUS_INTENTS: Record<CompositionCompatibilityStatus, Intent> = {
  good: "success",
  concern: "warning",
  acute: "danger",
  "in-motion": "accent",
  unknown: "neutral",
};

// ─── Main derive function ─────────────────────────────────────────────────────

export function deriveStorefrontCompositionView(input: {
  storefrontId: string;
  primary: StorefrontCompositionTemplateRef;
  secondaries: StorefrontCompositionTemplateRef[];
  seededCountsByCompositionId?: Record<string, { items: number; sections: number }>;
}): StorefrontCompositionView {
  const { storefrontId, primary, secondaries, seededCountsByCompositionId = {} } = input;

  function buildLineView(
    ref: StorefrontCompositionTemplateRef,
    role: "primary" | "secondary",
    secondaryStatus?: CompositionCompatibilityStatus,
    secondaryWarnings?: string[],
  ): StorefrontServiceLineView {
    if (!ref.activationProfile) {
      const counts = seededCountsByCompositionId[ref.compositionId] ?? { items: 0, sections: 0 };
      return {
        compositionId: ref.compositionId,
        role,
        archetypeSlug: ref.archetypeSlug,
        name: ref.name,
        category: ref.category,
        operatorLabel: ref.name,
        visualPattern: "standard-flow",
        status: "unknown",
        statusLabel: STATUS_LABELS.unknown,
        statusIntent: STATUS_INTENTS.unknown,
        statusIconName: STATUS_ICONS.unknown,
        contributedModules: [],
        contributedServiceCategories: [],
        contributedItemCount: counts.items,
        contributedSectionCount: counts.sections,
        warnings: ["Archetype metadata is incomplete — compatibility cannot be assessed."],
      };
    }

    const profile = ref.activationProfile;
    const counts = seededCountsByCompositionId[ref.compositionId] ?? { items: 0, sections: 0 };
    const status = secondaryStatus ?? "good";

    return {
      compositionId: ref.compositionId,
      role,
      archetypeSlug: ref.archetypeSlug,
      name: ref.name,
      category: ref.category,
      operatorLabel: ref.name,
      visualPattern: resolveVisualPattern(ref.category, profile.modules),
      status,
      statusLabel: STATUS_LABELS[status],
      statusIntent: STATUS_INTENTS[status],
      statusIconName: STATUS_ICONS[status],
      contributedModules: profile.modules,
      contributedServiceCategories: profile.seededServiceCategories ?? [],
      contributedItemCount: counts.items,
      contributedSectionCount: counts.sections,
      warnings: secondaryWarnings ?? [],
    };
  }

  const primaryView = buildLineView(primary, "primary");

  const secondaryViews: StorefrontServiceLineView[] = secondaries.map((sec) => {
    const { status, reason } = resolveCompatibility(primary.category, sec.category);
    const warnings = status !== "good" ? [reason] : [];
    return buildLineView(sec, "secondary", status, warnings);
  });

  const worstStatus = secondaryViews.reduce<CompositionCompatibilityStatus>(
    (worst, v) => {
      const rank: Record<CompositionCompatibilityStatus, number> = {
        unknown: 1, "in-motion": 1, good: 2, concern: 3, acute: 4,
      };
      return rank[v.status] > rank[worst] ? v.status : worst;
    },
    "good",
  );

  const summaryReasons = secondaryViews.flatMap((v) => v.warnings);
  const summaryLabel =
    secondaryViews.length === 0
      ? "Single service line"
      : STATUS_LABELS[worstStatus];

  return {
    storefrontId,
    primary: primaryView,
    secondaries: secondaryViews,
    compatibilitySummary: {
      status: worstStatus,
      label: summaryLabel,
      reasons: summaryReasons,
    },
  };
}
