// apps/web/lib/marketing/vocabulary.ts
//
// The closed vocabularies marketing reasons in: strategy status, route to
// market, locality model, review cadence, proof-asset type, review type and
// channel. Extracted from lib/marketing.ts so that modules deriving a strategy
// can read the vocabulary without importing the module that consumes them —
// lib/marketing.ts re-exports every name here, so no consumer changes.
//
// Also home to the two text helpers the derivation family shares with the
// normalizers. They are trivial, but duplicating them is how two spellings of
// "empty" appear in one codebase.

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

/** Trim to a non-empty string, or null. Whitespace is not a value. */
export function cleanText(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Clean, drop empties, and de-duplicate while preserving first-seen order. */
export function dedupeStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(cleanText).filter((value): value is string => Boolean(value)))];
}
