import { prisma, type Prisma } from "@dpf/db";
import {
  deriveRevenueModelFromActivationProfile,
  readActivationProfile,
} from "@/lib/storefront/archetype-activation";

export const MARKETING_STRATEGY_STATUS = ["draft", "active", "archived"] as const;
export type MarketingStrategyStatus = typeof MARKETING_STRATEGY_STATUS[number];

export const MARKETING_ROUTE_TO_MARKET = [
  "direct-sales",
  "inbound",
  "outbound",
  "channel-partner",
  "marketplace",
  "referral",
  "hybrid",
] as const;
export type MarketingRouteToMarket = typeof MARKETING_ROUTE_TO_MARKET[number];

export const MARKETING_LOCALITY_MODEL = [
  "hyperlocal",
  "regional",
  "national",
  "international",
  "online-only",
] as const;
export type MarketingLocalityModel = typeof MARKETING_LOCALITY_MODEL[number];

export const MARKETING_REVIEW_CADENCE = [
  "weekly",
  "monthly",
  "quarterly",
  "annually",
] as const;
export type MarketingReviewCadence = typeof MARKETING_REVIEW_CADENCE[number];

export const MARKETING_PROOF_ASSET_TYPE = [
  "case-study",
  "testimonial",
  "certification",
  "outcome",
  "award",
  "press",
] as const;
export type MarketingProofAssetType = typeof MARKETING_PROOF_ASSET_TYPE[number];

export const MARKETING_REVIEW_TYPE = [
  "scheduled",
  "ad-hoc",
  "ai-proactive",
  "post-campaign",
] as const;
export type MarketingReviewType = typeof MARKETING_REVIEW_TYPE[number];

export const MARKETING_CHANNELS = [
  "email",
  "linkedin",
  "facebook",
  "instagram",
  "x",
  "youtube",
  "tiktok",
  "outbound-mail",
  "event-attend",
  "event-sponsor",
  "referral",
  "partner",
  "content-seo",
  "paid-search",
  "paid-social",
  "podcast",
  "webinar",
  "phone",
] as const;
export type MarketingChannel = typeof MARKETING_CHANNELS[number];

export const DEFAULT_MARKETING_STRATEGY_STATUS: MarketingStrategyStatus = "draft";
export const DEFAULT_MARKETING_ROUTE_TO_MARKET: MarketingRouteToMarket = "hybrid";
export const DEFAULT_MARKETING_LOCALITY_MODEL: MarketingLocalityModel = "regional";
export const DEFAULT_MARKETING_REVIEW_CADENCE: MarketingReviewCadence = "quarterly";

type JsonRecord = Record<string, unknown>;

export type MarketingNamedItem = {
  name: string;
  description?: string | null;
};

export type MarketingProfile = {
  name: string;
  traits: string[];
  painPoints: string[];
};

export type MarketingOffer = {
  name: string;
  description?: string | null;
  ctaUrl?: string | null;
};

export type MarketingTerritory = {
  name: string;
  postalCodes: string[];
  radiusMiles?: number | null;
};

export type MarketingProofAsset = {
  type: MarketingProofAssetType;
  label: string;
  url?: string | null;
  accountId?: string | null;
};

export type MarketingConstraintSummary = {
  compliance?: string | null;
  geography?: string | null;
  capacity?: string | null;
  productMaturity?: string | null;
};

export type MarketingSuggestion = {
  kind?: string | null;
  target?: string | null;
  description: string;
  priority?: string | null;
};

export type MarketingWorkspaceSnapshot = {
  organization: {
    id: string;
    name: string;
    website: string | null;
    addressSummary: string | null;
  };
  storefront: {
    id: string | null;
    archetypeId: string | null;
    archetypeName: string | null;
    tagline: string | null;
    description: string | null;
    ctaType: string | null;
  };
  strategy: {
    strategyId: string;
    status: string;
    primaryGoal: string | null;
    routeToMarket: string;
    localityModel: string;
    geographicScope: string | null;
    primaryChannels: string[];
    secondaryChannels: string[];
    differentiators: string[];
    reviewCadence: string;
    lastReviewedAt: Date | null;
    nextReviewAt: Date | null;
    sourceSummary: string | null;
    specialistNotes: string | null;
    seasonalityNotes: string | null;
    targetSegments: MarketingNamedItem[];
    idealCustomerProfiles: MarketingProfile[];
    entryOffers: MarketingOffer[];
    proofAssets: MarketingProofAsset[];
    serviceTerritories: MarketingTerritory[];
    constraints: MarketingConstraintSummary | null;
  };
  latestReview: {
    reviewType: string;
    summary: string;
    createdAt: Date;
    suggestedActions: MarketingSuggestion[];
  } | null;
  staleAreas: string[];
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(cleanText).filter((value): value is string => Boolean(value)))];
}

function parseJsonArray<T>(value: Prisma.JsonValue | null | undefined): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function summarizeAddress(address: Prisma.JsonValue | null | undefined): string | null {
  if (!isRecord(address)) return null;
  return dedupeStrings([
    typeof address.city === "string" ? address.city : null,
    typeof address.region === "string" ? address.region : null,
    typeof address.state === "string" ? address.state : null,
    typeof address.country === "string" ? address.country : null,
  ]).join(", ") || null;
}

function inferRouteToMarket(
  revenueModel: string | null | undefined,
  ctaType: string | null | undefined,
): MarketingRouteToMarket {
  const value = `${revenueModel ?? ""} ${ctaType ?? ""}`.toLowerCase();
  if (value.includes("marketplace")) return "marketplace";
  if (value.includes("partner") || value.includes("channel")) return "channel-partner";
  if (value.includes("referral")) return "referral";
  if (value.includes("outbound")) return "outbound";
  if (value.includes("inbound")) return "inbound";
  if (
    value.includes("appointment") ||
    value.includes("quote") ||
    value.includes("sales") ||
    value.includes("booking") ||
    value.includes("purchase")
  ) {
    return "direct-sales";
  }
  return DEFAULT_MARKETING_ROUTE_TO_MARKET;
}

function inferLocalityModel(scope: string | null | undefined): MarketingLocalityModel {
  const value = (scope ?? "").toLowerCase();
  if (value.includes("online") || value.includes("remote")) return "online-only";
  if (value.includes("international") || value.includes("global")) return "international";
  if (value.includes("national") || value.includes("countrywide")) return "national";
  if (value.includes("local") || value.includes("city") || value.includes("neighborhood")) {
    return "hyperlocal";
  }
  if (value.includes("regional") || value.includes("state") || value.includes("county")) {
    return "regional";
  }
  return DEFAULT_MARKETING_LOCALITY_MODEL;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getCadenceWindow(cadence: MarketingReviewCadence): number {
  switch (cadence) {
    case "weekly":
      return 7;
    case "monthly":
      return 30;
    case "annually":
      return 365;
    case "quarterly":
    default:
      return 90;
  }
}

function inferPrimaryChannels(input: {
  targetMarket: string | null;
  customerSegments: string[];
  geographicScope: string | null;
  ctaType: string | null;
}): MarketingChannel[] {
  const hints = `${input.targetMarket ?? ""} ${input.customerSegments.join(" ")}`.toLowerCase();
  const channels: MarketingChannel[] = ["content-seo", "email"];

  if (
    hints.includes("business") ||
    hints.includes("b2b") ||
    hints.includes("company") ||
    hints.includes("organization") ||
    hints.includes("professional")
  ) {
    channels.push("linkedin");
  }

  if (input.ctaType === "booking" || input.ctaType === "inquiry") {
    channels.push("phone");
  }

  const localityModel = inferLocalityModel(input.geographicScope);
  if (localityModel === "hyperlocal" || localityModel === "regional") {
    channels.push("event-attend");
  }

  return dedupeStrings(channels).filter((channel): channel is MarketingChannel =>
    MARKETING_CHANNELS.includes(channel as MarketingChannel),
  );
}

function buildTargetSegments(
  customerSegments: string[],
  targetMarket: string | null,
): MarketingNamedItem[] {
  const seeded = customerSegments.map((segment) => ({
    name: segment,
    description: cleanText(targetMarket),
  }));

  if (seeded.length > 0) return seeded;
  if (!targetMarket) return [];

  return [{ name: targetMarket, description: "Imported from business context target market" }];
}

function buildIdealCustomerProfiles(
  segments: MarketingNamedItem[],
  valueProposition: string | null,
): MarketingProfile[] {
  return segments.map((segment) => ({
    name: segment.name,
    traits: dedupeStrings([segment.description ?? null]),
    painPoints: dedupeStrings([valueProposition]),
  }));
}

function buildEntryOffers(input: {
  tagline: string | null;
  description: string | null;
  website: string | null;
}): MarketingOffer[] {
  const description = cleanText(input.description) ?? cleanText(input.tagline);
  if (!description) return [];

  return [
    {
      name: cleanText(input.tagline) ?? "Primary offer",
      description,
      ctaUrl: cleanText(input.website),
    },
  ];
}

function buildServiceTerritories(
  geographicScope: string | null,
  addressSummary: string | null,
): MarketingTerritory[] {
  const name = cleanText(geographicScope) ?? cleanText(addressSummary);
  if (!name) return [];
  return [{ name, postalCodes: [] }];
}

function buildDifferentiators(input: {
  valueProposition: string | null;
  archetypeName: string | null;
  industry: string | null;
}): string[] {
  return dedupeStrings([
    input.valueProposition,
    input.archetypeName ? `${input.archetypeName} positioning` : null,
    input.industry ? `${input.industry} expertise` : null,
  ]);
}

function buildConstraints(input: {
  geographicScope: string | null;
  companyStage: string | null;
}): MarketingConstraintSummary | null {
  const constraints: MarketingConstraintSummary = {};
  if (cleanText(input.geographicScope)) constraints.geography = input.geographicScope;
  if (cleanText(input.companyStage)) constraints.productMaturity = input.companyStage;
  return Object.keys(constraints).length > 0 ? constraints : null;
}

function normalizeSuggestions(value: Prisma.JsonValue | null | undefined): MarketingSuggestion[] {
  return parseJsonArray<JsonRecord>(value)
    .map((item) => ({
      kind: typeof item.kind === "string" ? item.kind : null,
      target: typeof item.target === "string" ? item.target : null,
      description:
        typeof item.description === "string"
          ? item.description
          : typeof item.summary === "string"
            ? item.summary
            : "",
      priority: typeof item.priority === "string" ? item.priority : null,
    }))
    .filter((item) => item.description.length > 0);
}

function normalizeNamedItems(value: Prisma.JsonValue | null | undefined): MarketingNamedItem[] {
  return parseJsonArray<JsonRecord>(value)
    .map((item) => ({
      name: typeof item.name === "string" ? item.name : "",
      description: typeof item.description === "string" ? item.description : null,
    }))
    .filter((item) => item.name.length > 0);
}

function normalizeProfiles(value: Prisma.JsonValue | null | undefined): MarketingProfile[] {
  return parseJsonArray<JsonRecord>(value)
    .map((item) => ({
      name: typeof item.name === "string" ? item.name : "",
      traits: Array.isArray(item.traits)
        ? item.traits.filter((trait): trait is string => typeof trait === "string")
        : [],
      painPoints: Array.isArray(item.painPoints)
        ? item.painPoints.filter((pain): pain is string => typeof pain === "string")
        : [],
    }))
    .filter((item) => item.name.length > 0);
}

function normalizeOffers(value: Prisma.JsonValue | null | undefined): MarketingOffer[] {
  return parseJsonArray<JsonRecord>(value)
    .map((item) => ({
      name: typeof item.name === "string" ? item.name : "",
      description: typeof item.description === "string" ? item.description : null,
      ctaUrl: typeof item.ctaUrl === "string" ? item.ctaUrl : null,
    }))
    .filter((item) => item.name.length > 0);
}

function normalizeProofAssets(value: Prisma.JsonValue | null | undefined): MarketingProofAsset[] {
  return parseJsonArray<JsonRecord>(value)
    .map((item) => ({
      type:
        typeof item.type === "string" &&
        MARKETING_PROOF_ASSET_TYPE.includes(item.type as MarketingProofAssetType)
          ? (item.type as MarketingProofAssetType)
          : "outcome",
      label: typeof item.label === "string" ? item.label : "",
      url: typeof item.url === "string" ? item.url : null,
      accountId: typeof item.accountId === "string" ? item.accountId : null,
    }))
    .filter((item) => item.label.length > 0);
}

function normalizeTerritories(value: Prisma.JsonValue | null | undefined): MarketingTerritory[] {
  return parseJsonArray<JsonRecord>(value)
    .map((item) => ({
      name: typeof item.name === "string" ? item.name : "",
      postalCodes: Array.isArray(item.postalCodes)
        ? item.postalCodes.filter((code): code is string => typeof code === "string")
        : [],
      radiusMiles: typeof item.radiusMiles === "number" ? item.radiusMiles : null,
    }))
    .filter((item) => item.name.length > 0);
}

function normalizeConstraints(
  value: Prisma.JsonValue | null | undefined,
): MarketingConstraintSummary | null {
  if (!isRecord(value)) return null;
  const constraints: MarketingConstraintSummary = {
    compliance: typeof value.compliance === "string" ? value.compliance : null,
    geography: typeof value.geography === "string" ? value.geography : null,
    capacity: typeof value.capacity === "string" ? value.capacity : null,
    productMaturity:
      typeof value.productMaturity === "string" ? value.productMaturity : null,
  };
  return Object.values(constraints).some(Boolean) ? constraints : null;
}

function determineStaleAreas(snapshot: {
  geographicScope: string | null;
  targetSegments: MarketingNamedItem[];
  primaryChannels: string[];
  proofAssets: MarketingProofAsset[];
  nextReviewAt: Date | null;
  latestReviewAt: Date | null;
}): string[] {
  const staleAreas: string[] = [];
  if (!cleanText(snapshot.geographicScope)) staleAreas.push("Geographic scope needs review");
  if (snapshot.targetSegments.length === 0) staleAreas.push("Target segments need definition");
  if (snapshot.primaryChannels.length === 0) staleAreas.push("Primary channels need definition");
  if (snapshot.proofAssets.length === 0) staleAreas.push("Proof assets are still missing");
  if (snapshot.nextReviewAt && snapshot.nextReviewAt.getTime() < Date.now()) {
    staleAreas.push("Strategy review cadence is overdue");
  } else if (!snapshot.latestReviewAt) {
    staleAreas.push("Initial strategy review has not been recorded yet");
  }
  return staleAreas;
}

export function formatMarketingLabel(value: string): string {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatMarketingDate(value: Date | null): string {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

export async function getMarketingWorkspaceSnapshot(): Promise<MarketingWorkspaceSnapshot | null> {
  const organization = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
    include: {
      businessContext: true,
      storefrontConfig: {
        include: {
          archetype: {
            select: {
              id: true,
              name: true,
              category: true,
              ctaType: true,
              activationProfile: true,
            },
          },
        },
      },
    },
  });

  if (!organization) return null;

  const activationProfile = readActivationProfile(
    organization.storefrontConfig?.archetype?.activationProfile,
  );
  const activationRevenueModel = deriveRevenueModelFromActivationProfile(
    activationProfile,
    organization.storefrontConfig?.archetype?.ctaType ?? "inquiry",
  );
  const addressSummary = summarizeAddress(organization.address);
  const customerSegments = organization.businessContext?.customerSegments ?? [];
  const targetSegments = buildTargetSegments(
    customerSegments,
    cleanText(organization.businessContext?.targetMarket),
  );
  const idealCustomerProfiles = buildIdealCustomerProfiles(
    targetSegments,
    cleanText(organization.businessContext?.valueProposition),
  );
  const routeToMarket = inferRouteToMarket(
    cleanText(organization.businessContext?.revenueModel) ?? activationRevenueModel,
    organization.storefrontConfig?.archetype?.ctaType ?? null,
  );
  const localityModel = inferLocalityModel(organization.businessContext?.geographicScope);
  const primaryChannels = inferPrimaryChannels({
    targetMarket: cleanText(organization.businessContext?.targetMarket),
    customerSegments,
    geographicScope: cleanText(organization.businessContext?.geographicScope),
    ctaType: organization.storefrontConfig?.archetype?.ctaType ?? null,
  });
  const entryOffers = buildEntryOffers({
    tagline: cleanText(organization.storefrontConfig?.tagline),
    description: cleanText(organization.storefrontConfig?.description),
    website: cleanText(organization.website),
  });
  const serviceTerritories = buildServiceTerritories(
    cleanText(organization.businessContext?.geographicScope),
    addressSummary,
  );
  const differentiators = buildDifferentiators({
    valueProposition: cleanText(organization.businessContext?.valueProposition),
    archetypeName: cleanText(organization.storefrontConfig?.archetype?.name),
    industry: cleanText(organization.businessContext?.industry),
  });
  const constraints = buildConstraints({
    geographicScope: cleanText(organization.businessContext?.geographicScope),
    companyStage: cleanText(organization.businessContext?.companyStage),
  });
  const now = new Date();
  const nextReviewAt = addDays(now, getCadenceWindow(DEFAULT_MARKETING_REVIEW_CADENCE));
  const sourceSummary = dedupeStrings([
    "Bootstrapped from Organization, BusinessContext, and StorefrontConfig",
    organization.storefrontConfig?.archetypeId
      ? `Storefront archetype: ${organization.storefrontConfig.archetypeId}`
      : null,
  ]).join(". ");

  const strategy = await prisma.marketingStrategy.upsert({
    where: { organizationId: organization.id },
    update: {},
    create: {
      organizationId: organization.id,
      storefrontId: organization.storefrontConfig?.id,
      status: DEFAULT_MARKETING_STRATEGY_STATUS,
      primaryGoal:
        cleanText(organization.businessContext?.valueProposition) ??
        cleanText(organization.businessContext?.description) ??
        cleanText(organization.storefrontConfig?.tagline),
      routeToMarket,
      localityModel,
      geographicScope: cleanText(organization.businessContext?.geographicScope) ?? addressSummary,
      ...(serviceTerritories.length > 0
        ? { serviceTerritories: serviceTerritories as Prisma.InputJsonValue }
        : {}),
      ...(targetSegments.length > 0
        ? { targetSegments: targetSegments as Prisma.InputJsonValue }
        : {}),
      ...(idealCustomerProfiles.length > 0
        ? { idealCustomerProfiles: idealCustomerProfiles as Prisma.InputJsonValue }
        : {}),
      ...(entryOffers.length > 0 ? { entryOffers: entryOffers as Prisma.InputJsonValue } : {}),
      primaryChannels,
      differentiators,
      ...(constraints ? { constraints: constraints as Prisma.InputJsonValue } : {}),
      reviewCadence: DEFAULT_MARKETING_REVIEW_CADENCE,
      nextReviewAt,
      sourceSummary,
    },
  });

  const latestReview = await prisma.marketingReview.findFirst({
    where: { strategyId: strategy.strategyId },
    orderBy: { createdAt: "desc" },
  });

  const normalizedSnapshot: MarketingWorkspaceSnapshot = {
    organization: {
      id: organization.id,
      name: organization.name,
      website: cleanText(organization.website),
      addressSummary,
    },
    storefront: {
      id: organization.storefrontConfig?.id ?? null,
      archetypeId: organization.storefrontConfig?.archetypeId ?? null,
      archetypeName: cleanText(organization.storefrontConfig?.archetype?.name),
      tagline: cleanText(organization.storefrontConfig?.tagline),
      description: cleanText(organization.storefrontConfig?.description),
      ctaType: cleanText(organization.storefrontConfig?.archetype?.ctaType),
    },
    strategy: {
      strategyId: strategy.strategyId,
      status: strategy.status,
      primaryGoal: cleanText(strategy.primaryGoal),
      routeToMarket: strategy.routeToMarket,
      localityModel: strategy.localityModel,
      geographicScope: cleanText(strategy.geographicScope),
      primaryChannels: strategy.primaryChannels,
      secondaryChannels: strategy.secondaryChannels,
      differentiators: strategy.differentiators,
      reviewCadence: strategy.reviewCadence,
      lastReviewedAt: strategy.lastReviewedAt,
      nextReviewAt: strategy.nextReviewAt,
      sourceSummary: cleanText(strategy.sourceSummary),
      specialistNotes: cleanText(strategy.specialistNotes),
      seasonalityNotes: cleanText(strategy.seasonalityNotes),
      targetSegments: normalizeNamedItems(strategy.targetSegments),
      idealCustomerProfiles: normalizeProfiles(strategy.idealCustomerProfiles),
      entryOffers: normalizeOffers(strategy.entryOffers),
      proofAssets: normalizeProofAssets(strategy.proofAssets),
      serviceTerritories: normalizeTerritories(strategy.serviceTerritories),
      constraints: normalizeConstraints(strategy.constraints),
    },
    latestReview: latestReview
      ? {
          reviewType: latestReview.reviewType,
          summary: latestReview.summary,
          createdAt: latestReview.createdAt,
          suggestedActions: normalizeSuggestions(latestReview.suggestedActions),
        }
      : null,
    staleAreas: [],
  };

  normalizedSnapshot.staleAreas = determineStaleAreas({
    geographicScope: normalizedSnapshot.strategy.geographicScope,
    targetSegments: normalizedSnapshot.strategy.targetSegments,
    primaryChannels: normalizedSnapshot.strategy.primaryChannels,
    proofAssets: normalizedSnapshot.strategy.proofAssets,
    nextReviewAt: normalizedSnapshot.strategy.nextReviewAt,
    latestReviewAt: normalizedSnapshot.latestReview?.createdAt ?? null,
  });

  return normalizedSnapshot;
}
