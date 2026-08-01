import { prisma, type Prisma } from "@dpf/db";
import {
  deriveRevenueModelFromActivationProfile,
  readActivationProfile,
} from "@/lib/storefront/archetype-activation";
import { upsertMarketingStrategyTolerant } from "@/lib/marketing/strategy-bootstrap";
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

export type MarketingReviewRecommendation = {
  primaryChannels: MarketingChannel[];
  skippedChannels: MarketingChannel[];
  cadence: MarketingReviewCadence | null;
  kpis: string[];
};

export type MarketingCampaignBriefArtifactInput = {
  title: string;
  objective: string;
  audience?: string;
  channels?: string[];
  cta?: string;
  proofAssets?: string[];
  kpis?: string[];
  notes?: string;
};

export type MarketingCampaignBriefArtifact = {
  title: string;
  objective: string;
  audience: string | null;
  channels: MarketingChannel[];
  cta: string | null;
  proofAssets: string[];
  kpis: string[];
  notes: string | null;
};

export type MarketingAssetTaskArtifactInput = {
  title: string;
  assetType: string;
  channel?: string;
  dueWindow?: string;
  brief?: string;
};

export type MarketingAssetTaskArtifact = {
  title: string;
  assetType: string;
  channel: MarketingChannel | null;
  dueWindow: string | null;
  brief: string | null;
};

export type MarketingKpiCheckpointArtifactInput = {
  metric: string;
  target?: string;
  cadence?: string;
  notes?: string;
};

export type MarketingKpiCheckpointArtifact = {
  metric: string;
  target: string | null;
  cadence: MarketingReviewCadence | null;
  notes: string | null;
};

export type MarketingAutomationCandidateArtifactInput = {
  title: string;
  trigger: string;
  action: string;
  approvalRequired?: boolean;
  rationale?: string;
};

export type MarketingAutomationCandidateArtifact = {
  title: string;
  trigger: string;
  action: string;
  approvalRequired: boolean;
  rationale: string | null;
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
    category: string | null;
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
    recommendation: MarketingReviewRecommendation | null;
  } | null;
  workProducts: {
    campaignBriefs: Array<MarketingCampaignBriefArtifact & {
      briefId: string;
      campaignId?: string | null;
      status: string;
      createdAt: Date;
    }>;
    assetTasks: Array<MarketingAssetTaskArtifact & {
      taskId: string;
      campaignId?: string | null;
      status: string;
      createdAt: Date;
    }>;
    kpiCheckpoints: Array<MarketingKpiCheckpointArtifact & {
      checkpointId: string;
      status: string;
      createdAt: Date;
    }>;
    automationCandidates: Array<MarketingAutomationCandidateArtifact & {
      candidateId: string;
      status: string;
      createdAt: Date;
    }>;
  };
  pendingDrafts: OutboundDraftRow[];
  approvedDrafts: OutboundDraftRow[];
  connectedChannels: string[]; // IntegrationCredential.integrationId values with status="connected"
  inboundMessages: InboundMessageRow[];
  staleAreas: string[];
};

export type InboundMessageRow = {
  inboundId: string;
  channelId: string;
  fromAddress: string | null;
  fromDisplayName: string | null;
  subject: string | null;
  body: string;
  receivedAt: Date;
  classification: "qualified-inquiry" | "support" | "spam" | "other" | null;
  draftedReplyId: string | null;
};

export type OutboundDraftRow = {
  draftId: string;
  sourceType: "marketing-asset-task" | "marketing-campaign-brief" | "inbound-channel-message" | "manual";
  sourceId: string | null;
  assetTaskTitle: string | null;
  channelId: string;
  assetType: string;
  status: "draft" | "pending-review" | "approved" | "rejected" | "needs-changes" | "stale" | "published";
  body: string;
  bodyFormat: "markdown" | "html" | "plain";
  createdByAgentId: string | null;
  createdAt: Date;
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
  const friendlyLabels: Record<string, string> = {
    active: "Active",
    archived: "Archived",
    draft: "Needs strategist review",
    "direct-sales": "Sales-led outreach",
    inbound: "Inbound demand",
    outbound: "Outbound prospecting",
    "channel-partner": "Partner-led growth",
    marketplace: "Marketplace demand",
    referral: "Referral motion",
    hybrid: "Mixed route to market",
    hyperlocal: "Local market",
    regional: "Regional market",
    national: "National market",
    international: "International market",
    "online-only": "Online-only market",
    weekly: "Weekly",
    monthly: "Monthly",
    quarterly: "Quarterly",
    annually: "Annual",
    email: "Email",
    linkedin: "LinkedIn",
    facebook: "Facebook",
    instagram: "Instagram",
    x: "X",
    youtube: "YouTube",
    tiktok: "TikTok",
    "outbound-mail": "Direct mail",
    "event-attend": "Attend events",
    "event-sponsor": "Sponsor events",
    partner: "Partner",
    "content-seo": "Search-led content",
    "paid-search": "Paid search",
    "paid-social": "Paid social",
    podcast: "Podcast",
    webinar: "Webinar",
    phone: "Phone follow-up",
    "case-study": "Case study",
    testimonial: "Testimonial",
    certification: "Certification",
    outcome: "Outcome proof",
    award: "Award",
    press: "Press mention",
    scheduled: "Scheduled review",
    "ad-hoc": "Working session",
    "ai-proactive": "Strategist suggestion",
    "post-campaign": "Campaign review",
  };

  if (friendlyLabels[value]) return friendlyLabels[value];

  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatMarketingGap(value: string): string {
  const friendlyGaps: Record<string, string> = {
    "Geographic scope needs review":
      "Decide where we want to win customers first: local, regional, national, or international.",
    "Target segments need definition":
      "Name the buyer groups worth pursuing first.",
    "Primary channels need definition":
      "Choose the few channels that fit this business before creating campaigns.",
    "Proof assets are still missing":
      "Pick the proof that will make the offer credible: outcomes, testimonials, case studies, or credentials.",
    "Strategy review cadence is overdue":
      "Refresh the strategy before launching the next campaign.",
    "Initial strategy review has not been recorded yet":
      "Have the Marketing Strategist run the first strategy review.",
  };

  return friendlyGaps[value] ?? value;
}

export function formatMarketingDate(value: Date | null): string {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

export type MarketingReviewArtifactInput = {
  summary: string;
  primaryChannels?: string[];
  secondaryChannels?: string[];
  skippedChannels?: string[];
  kpis?: string[];
  cadence?: string;
  suggestedActions?: Array<string | MarketingSuggestion>;
};

export type MarketingReviewArtifact = {
  review: {
    reviewType: MarketingReviewType;
    summary: string;
    detectedChanges: {
      primaryChannels: MarketingChannel[];
      skippedChannels: MarketingChannel[];
      cadence: MarketingReviewCadence;
    };
    funnelAssessment: {
      kpis: string[];
    };
    suggestedActions: MarketingSuggestion[];
  };
  strategyUpdate: {
    status: MarketingStrategyStatus;
    primaryChannels: MarketingChannel[];
    secondaryChannels?: MarketingChannel[];
    reviewCadence: MarketingReviewCadence;
    lastReviewedAt: Date;
    nextReviewAt: Date;
    specialistNotes: string;
  };
};

function normalizeChannelList(values: string[] | undefined): MarketingChannel[] {
  return dedupeStrings(values ?? []).filter((channel): channel is MarketingChannel =>
    MARKETING_CHANNELS.includes(channel as MarketingChannel),
  );
}

function normalizeChannel(value: string | null | undefined): MarketingChannel | null {
  const cleaned = cleanText(value);
  return cleaned && MARKETING_CHANNELS.includes(cleaned as MarketingChannel)
    ? (cleaned as MarketingChannel)
    : null;
}

function normalizeReviewCadence(value: string | undefined): MarketingReviewCadence {
  return MARKETING_REVIEW_CADENCE.includes(value as MarketingReviewCadence)
    ? (value as MarketingReviewCadence)
    : "weekly";
}

function removeUndefinedFields<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined),
  ) as T;
}

function normalizeSuggestedActions(
  values: Array<string | MarketingSuggestion> | undefined,
): MarketingSuggestion[] {
  return (values ?? [])
    .map((value) => {
      if (typeof value === "string") {
        return { description: value, priority: "normal" };
      }
      return removeUndefinedFields({
        kind: value.kind,
        target: value.target,
        description: value.description,
        priority: value.priority ?? "normal",
      });
    })
    .filter((value) => cleanText(value.description));
}

export function buildMarketingReviewArtifact(
  input: MarketingReviewArtifactInput,
  now = new Date(),
): MarketingReviewArtifact {
  const summary = cleanText(input.summary) ?? "Marketing strategist recommendation";
  const cadence = normalizeReviewCadence(input.cadence);
  const skippedChannels = normalizeChannelList(input.skippedChannels);
  const skippedSet = new Set(skippedChannels);
  const primaryChannels = normalizeChannelList(input.primaryChannels).filter(
    (channel) => !skippedSet.has(channel),
  );
  const secondaryChannels = normalizeChannelList(input.secondaryChannels);
  const kpis = dedupeStrings(input.kpis ?? []);
  const nextReviewAt = addDays(now, getCadenceWindow(cadence));

  return {
    review: {
      reviewType: "ai-proactive",
      summary,
      detectedChanges: {
        primaryChannels,
        skippedChannels,
        cadence,
      },
      funnelAssessment: {
        kpis,
      },
      suggestedActions: normalizeSuggestedActions(input.suggestedActions),
    },
    strategyUpdate: {
      status: "active",
      primaryChannels,
      ...(secondaryChannels.length > 0 ? { secondaryChannels } : {}),
      reviewCadence: cadence,
      lastReviewedAt: now,
      nextReviewAt,
      specialistNotes: summary,
    },
  };
}

export function buildMarketingCampaignBriefArtifact(
  input: MarketingCampaignBriefArtifactInput,
): MarketingCampaignBriefArtifact {
  return {
    title: cleanText(input.title) ?? "Marketing campaign brief",
    objective: cleanText(input.objective) ?? "Create measurable marketing demand",
    audience: cleanText(input.audience),
    channels: normalizeChannelList(input.channels),
    cta: cleanText(input.cta),
    proofAssets: dedupeStrings(input.proofAssets ?? []),
    kpis: dedupeStrings(input.kpis ?? []),
    notes: cleanText(input.notes),
  };
}

export function buildMarketingAssetTaskArtifact(
  input: MarketingAssetTaskArtifactInput,
): MarketingAssetTaskArtifact {
  return {
    title: cleanText(input.title) ?? "Marketing asset task",
    assetType: cleanText(input.assetType) ?? "content",
    channel: normalizeChannel(input.channel),
    dueWindow: cleanText(input.dueWindow),
    brief: cleanText(input.brief),
  };
}

export function buildMarketingKpiCheckpointArtifact(
  input: MarketingKpiCheckpointArtifactInput,
): MarketingKpiCheckpointArtifact {
  return {
    metric: cleanText(input.metric) ?? "qualified inquiries",
    target: cleanText(input.target),
    cadence: cleanText(input.cadence) ? normalizeReviewCadence(input.cadence) : null,
    notes: cleanText(input.notes),
  };
}

export function buildMarketingAutomationCandidateArtifact(
  input: MarketingAutomationCandidateArtifactInput,
): MarketingAutomationCandidateArtifact {
  return {
    title: cleanText(input.title) ?? "Marketing automation candidate",
    trigger: cleanText(input.trigger) ?? "Manual review",
    action: cleanText(input.action) ?? "Create an internal follow-up task",
    approvalRequired: input.approvalRequired ?? true,
    rationale: cleanText(input.rationale),
  };
}

function normalizeReviewRecommendation(
  detectedChanges: Prisma.JsonValue | null | undefined,
  funnelAssessment: Prisma.JsonValue | null | undefined,
): MarketingReviewRecommendation | null {
  if (!isRecord(detectedChanges) && !isRecord(funnelAssessment)) return null;
  const changes = isRecord(detectedChanges) ? detectedChanges : {};
  const funnel = isRecord(funnelAssessment) ? funnelAssessment : {};
  const primaryChannels = Array.isArray(changes.primaryChannels)
    ? normalizeChannelList(changes.primaryChannels.filter((value): value is string => typeof value === "string"))
    : [];
  const skippedChannels = Array.isArray(changes.skippedChannels)
    ? normalizeChannelList(changes.skippedChannels.filter((value): value is string => typeof value === "string"))
    : [];
  const cadence = typeof changes.cadence === "string" &&
    MARKETING_REVIEW_CADENCE.includes(changes.cadence as MarketingReviewCadence)
    ? (changes.cadence as MarketingReviewCadence)
    : null;
  const kpis = Array.isArray(funnel.kpis)
    ? dedupeStrings(funnel.kpis.filter((value): value is string => typeof value === "string"))
    : [];

  if (primaryChannels.length === 0 && skippedChannels.length === 0 && !cadence && kpis.length === 0) {
    return null;
  }

  return { primaryChannels, skippedChannels, cadence, kpis };
}

export async function recordMarketingStrategistReview(input: {
  recommendation: MarketingReviewArtifactInput;
  createdByAgentId?: string | null;
}): Promise<{ reviewId: string; strategyId: string; message: string } | null> {
  const snapshot = await getMarketingWorkspaceSnapshot();
  if (!snapshot) return null;

  const artifact = buildMarketingReviewArtifact(input.recommendation);
  const review = await prisma.marketingReview.create({
    data: {
      organizationId: snapshot.organization.id,
      strategyId: snapshot.strategy.strategyId,
      reviewType: artifact.review.reviewType,
      summary: artifact.review.summary,
      detectedChanges: artifact.review.detectedChanges as Prisma.InputJsonValue,
      funnelAssessment: artifact.review.funnelAssessment as Prisma.InputJsonValue,
      suggestedActions: artifact.review.suggestedActions as Prisma.InputJsonValue,
      createdByAgentId: input.createdByAgentId ?? null,
    },
    select: { reviewId: true },
  });

  await prisma.marketingStrategy.update({
    where: { strategyId: snapshot.strategy.strategyId },
    data: artifact.strategyUpdate,
  });

  return {
    reviewId: review.reviewId,
    strategyId: snapshot.strategy.strategyId,
    message: `Saved marketing review ${review.reviewId}`,
  };
}

export async function createMarketingCampaignBrief(input: {
  brief: MarketingCampaignBriefArtifactInput;
  createdByAgentId?: string | null;
}): Promise<{ briefId: string; strategyId: string; message: string } | null> {
  const snapshot = await getMarketingWorkspaceSnapshot();
  if (!snapshot) return null;

  const artifact = buildMarketingCampaignBriefArtifact(input.brief);
  const record = await prisma.marketingCampaignBrief.create({
    data: {
      organizationId: snapshot.organization.id,
      strategyId: snapshot.strategy.strategyId,
      title: artifact.title,
      objective: artifact.objective,
      audience: artifact.audience,
      channels: artifact.channels,
      cta: artifact.cta,
      proofAssets: artifact.proofAssets,
      kpis: artifact.kpis,
      notes: artifact.notes,
      createdByAgentId: input.createdByAgentId ?? null,
    },
    select: { briefId: true },
  });

  return {
    briefId: record.briefId,
    strategyId: snapshot.strategy.strategyId,
    message: `Saved marketing campaign brief ${record.briefId}`,
  };
}

export async function createMarketingAssetTask(input: {
  task: MarketingAssetTaskArtifactInput;
  createdByAgentId?: string | null;
}): Promise<{ taskId: string; strategyId: string; message: string } | null> {
  const snapshot = await getMarketingWorkspaceSnapshot();
  if (!snapshot) return null;

  const artifact = buildMarketingAssetTaskArtifact(input.task);
  const record = await prisma.marketingAssetTask.create({
    data: {
      organizationId: snapshot.organization.id,
      strategyId: snapshot.strategy.strategyId,
      title: artifact.title,
      assetType: artifact.assetType,
      channel: artifact.channel,
      dueWindow: artifact.dueWindow,
      brief: artifact.brief,
      createdByAgentId: input.createdByAgentId ?? null,
    },
    select: { taskId: true },
  });

  return {
    taskId: record.taskId,
    strategyId: snapshot.strategy.strategyId,
    message: `Saved marketing asset task ${record.taskId}`,
  };
}

export async function recordMarketingKpiCheckpoint(input: {
  checkpoint: MarketingKpiCheckpointArtifactInput;
  createdByAgentId?: string | null;
}): Promise<{ checkpointId: string; strategyId: string; message: string } | null> {
  const snapshot = await getMarketingWorkspaceSnapshot();
  if (!snapshot) return null;

  const artifact = buildMarketingKpiCheckpointArtifact(input.checkpoint);
  const record = await prisma.marketingKpiCheckpoint.create({
    data: {
      organizationId: snapshot.organization.id,
      strategyId: snapshot.strategy.strategyId,
      metric: artifact.metric,
      target: artifact.target,
      cadence: artifact.cadence,
      notes: artifact.notes,
      createdByAgentId: input.createdByAgentId ?? null,
    },
    select: { checkpointId: true },
  });

  return {
    checkpointId: record.checkpointId,
    strategyId: snapshot.strategy.strategyId,
    message: `Saved marketing KPI checkpoint ${record.checkpointId}`,
  };
}

export async function createMarketingAutomationCandidate(input: {
  candidate: MarketingAutomationCandidateArtifactInput;
  createdByAgentId?: string | null;
}): Promise<{ candidateId: string; strategyId: string; message: string } | null> {
  const snapshot = await getMarketingWorkspaceSnapshot();
  if (!snapshot) return null;

  const artifact = buildMarketingAutomationCandidateArtifact(input.candidate);
  const record = await prisma.marketingAutomationCandidate.create({
    data: {
      organizationId: snapshot.organization.id,
      strategyId: snapshot.strategy.strategyId,
      title: artifact.title,
      trigger: artifact.trigger,
      action: artifact.action,
      approvalRequired: artifact.approvalRequired,
      rationale: artifact.rationale,
      createdByAgentId: input.createdByAgentId ?? null,
    },
    select: { candidateId: true },
  });

  return {
    candidateId: record.candidateId,
    strategyId: snapshot.strategy.strategyId,
    message: `Saved marketing automation candidate ${record.candidateId}`,
  };
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

  const strategy = await upsertMarketingStrategyTolerant(prisma.marketingStrategy, {
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

  const [
    campaignBriefs,
    assetTasks,
    kpiCheckpoints,
    automationCandidates,
    pendingDraftsRaw,
    approvedDraftsRaw,
    connectedIntegrations,
    inboundRaw,
  ] = await Promise.all([
    prisma.marketingCampaignBrief.findMany({
      where: { strategyId: strategy.strategyId },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.marketingAssetTask.findMany({
      where: { strategyId: strategy.strategyId },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.marketingKpiCheckpoint.findMany({
      where: { strategyId: strategy.strategyId },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.marketingAutomationCandidate.findMany({
      where: { strategyId: strategy.strategyId },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.outboundDraft.findMany({
      where: {
        organizationId: organization.id,
        domain: "marketing",
        status: { in: ["pending-review", "needs-changes"] },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.outboundDraft.findMany({
      where: {
        organizationId: organization.id,
        domain: "marketing",
        status: "approved",
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
    prisma.integrationCredential.findMany({
      where: { status: "connected" },
      select: { integrationId: true },
    }),
    prisma.inboundChannelMessage.findMany({
      where: { organizationId: organization.id, domain: "marketing" },
      orderBy: { receivedAt: "desc" },
      take: 20,
    }),
  ]);

  // Map asset task ids to titles for the queue panel
  const taskIdToTitle = new Map(assetTasks.map((t) => [t.taskId, t.title]));
  const toRow = (draft: typeof pendingDraftsRaw[number]): OutboundDraftRow => ({
    draftId: draft.draftId,
    sourceType: draft.sourceType as OutboundDraftRow["sourceType"],
    sourceId: draft.sourceId,
    assetTaskTitle:
      draft.sourceType === "marketing-asset-task" && draft.sourceId
        ? taskIdToTitle.get(draft.sourceId) ?? null
        : null,
    channelId: draft.channelId,
    assetType: draft.assetType,
    status: draft.status as OutboundDraftRow["status"],
    body: draft.body,
    bodyFormat: draft.bodyFormat as OutboundDraftRow["bodyFormat"],
    createdByAgentId: draft.createdByAgentId,
    createdAt: draft.createdAt,
  });
  const pendingDrafts: OutboundDraftRow[] = pendingDraftsRaw.map(toRow);
  const approvedDrafts: OutboundDraftRow[] = approvedDraftsRaw.map(toRow);
  const connectedChannels = connectedIntegrations.map((i) => i.integrationId);
  const inboundMessages: InboundMessageRow[] = inboundRaw.map((m) => ({
    inboundId: m.inboundId,
    channelId: m.channelId,
    fromAddress: m.fromAddress,
    fromDisplayName: m.fromDisplayName,
    subject: m.subject,
    body: m.body,
    receivedAt: m.receivedAt,
    classification: m.classification as InboundMessageRow["classification"],
    draftedReplyId: m.draftedReplyId,
  }));

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
      category: cleanText(organization.storefrontConfig?.archetype?.category),
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
          recommendation: normalizeReviewRecommendation(
            latestReview.detectedChanges,
            latestReview.funnelAssessment,
          ),
        }
      : null,
    workProducts: {
      campaignBriefs: campaignBriefs.map((brief) => ({
        briefId: brief.briefId,
        campaignId: brief.campaignId,
        title: brief.title,
        objective: brief.objective,
        audience: cleanText(brief.audience),
        channels: normalizeChannelList(brief.channels),
        cta: cleanText(brief.cta),
        proofAssets: dedupeStrings(brief.proofAssets),
        kpis: dedupeStrings(brief.kpis),
        notes: cleanText(brief.notes),
        status: brief.status,
        createdAt: brief.createdAt,
      })),
      assetTasks: assetTasks.map((task) => ({
        taskId: task.taskId,
        campaignId: task.campaignId,
        title: task.title,
        assetType: task.assetType,
        channel: normalizeChannel(task.channel),
        dueWindow: cleanText(task.dueWindow),
        brief: cleanText(task.brief),
        status: task.status,
        createdAt: task.createdAt,
      })),
      kpiCheckpoints: kpiCheckpoints.map((checkpoint) => ({
        checkpointId: checkpoint.checkpointId,
        metric: checkpoint.metric,
        target: cleanText(checkpoint.target),
        cadence: cleanText(checkpoint.cadence)
          ? normalizeReviewCadence(checkpoint.cadence ?? undefined)
          : null,
        notes: cleanText(checkpoint.notes),
        status: checkpoint.status,
        createdAt: checkpoint.createdAt,
      })),
      automationCandidates: automationCandidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        title: candidate.title,
        trigger: candidate.trigger,
        action: candidate.action,
        approvalRequired: candidate.approvalRequired,
        rationale: cleanText(candidate.rationale),
        status: candidate.status,
        createdAt: candidate.createdAt,
      })),
    },
    pendingDrafts,
    approvedDrafts,
    connectedChannels,
    inboundMessages,
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
