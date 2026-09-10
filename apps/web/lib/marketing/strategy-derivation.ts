// apps/web/lib/marketing/strategy-derivation.ts
//
// Deriving a FIRST marketing strategy from what the platform already knows:
// the organization's BusinessContext, its address, and its storefront
// archetype. Extracted from lib/marketing.ts, which had grown past the
// module-size ceiling and was mixing three jobs — deriving a strategy,
// normalizing persisted JSON back into shape, and formatting it for display.
//
// Everything here answers one question: "we have never been told, so what is
// the honest starting point?" Two rules hold throughout.
//
//   1. An observed fact always beats a derived one. Every builder returns the
//      organization's own answer when it has one and only falls back after.
//   2. A derived value says it is derived. The archetype seed segments carry
//      that in their description, because the drafter downstream cannot tell a
//      seed from a finding and would otherwise assert one as the other.

import type { Prisma } from "@dpf/db";
import { isRecord } from "@/lib/shared/coerce";
import type { MarketingPlaybook } from "@/lib/tak/marketing-playbooks";
import {
  MARKETING_CHANNELS,
  cleanText,
  dedupeStrings,
  type MarketingChannel,
  type MarketingLocalityModel,
  type MarketingRouteToMarket,
} from "./vocabulary";

/** Shapes re-declared structurally so this module does not import back into lib/marketing.ts. */
type NamedItem = { name: string; description?: string | null };
type Profile = { name: string; traits: string[]; painPoints: string[] };
type Offer = { name: string; description: string; ctaUrl?: string | null };
type Territory = { name: string; postalCodes: string[] };
type ConstraintSummary = {
  geography?: string | null;
  compliance?: string | null;
  productMaturity?: string | null;
  budget?: string | null;
};

export function summarizeAddress(address: Prisma.JsonValue | null | undefined): string | null {
  if (!isRecord(address)) return null;
  return dedupeStrings([
    typeof address.city === "string" ? address.city : null,
    typeof address.region === "string" ? address.region : null,
    typeof address.state === "string" ? address.state : null,
    typeof address.country === "string" ? address.country : null,
  ]).join(", ") || null;
}

export function inferRouteToMarket(
  revenueModel: string | null | undefined,
  ctaType: string | null | undefined,
): MarketingRouteToMarket {
  const value = `${revenueModel ?? ""} ${ctaType ?? ""}`.toLowerCase();
  if (value.includes("marketplace")) return "marketplace";
  if (value.includes("partner") || value.includes("channel")) return "channel-partner";
  if (value.includes("referral")) return "referral";
  if (value.includes("outbound") || value.includes("sales")) return "outbound";
  if (
    value.includes("subscription") ||
    value.includes("self-serve") ||
    value.includes("ecommerce") ||
    value.includes("purchase")
  ) {
    return "inbound";
  }
  if (value.includes("booking") || value.includes("inquiry")) return "direct-sales";
  return "hybrid";
}

export function inferLocalityModel(scope: string | null | undefined): MarketingLocalityModel {
  const value = (scope ?? "").toLowerCase();
  if (!value) return "regional";
  if (value.includes("online") || value.includes("remote") || value.includes("virtual")) {
    return "online-only";
  }
  if (value.includes("global") || value.includes("international") || value.includes("worldwide")) {
    return "international";
  }
  if (value.includes("national") || value.includes("country")) return "national";
  if (
    value.includes("neighborhood") ||
    value.includes("city") ||
    value.includes("town") ||
    value.includes("local")
  ) {
    return "hyperlocal";
  }
  return "regional";
}

export function inferPrimaryChannels(input: {
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

/** How an archetype default is marked so a reader never mistakes it for a finding. */
export const ARCHETYPE_DEFAULT_SUFFIX =
  "(archetype default — confirm or replace with what is true here)";

export function buildTargetSegments(
  customerSegments: string[],
  targetMarket: string | null,
  playbook?: MarketingPlaybook | null,
): NamedItem[] {
  const seeded = customerSegments.map((segment) => ({
    name: segment,
    description: cleanText(targetMarket),
  }));

  if (seeded.length > 0) return seeded;
  if (targetMarket) {
    return [{ name: targetMarket, description: "Imported from business context target market" }];
  }

  // BusinessContext is silent on a fresh install, which used to leave
  // targetSegments EMPTY. The drafter reads this field, so empty means every
  // generated asset is written for nobody — the reference install's marketing
  // coworker ran twice and produced nothing for exactly this reason.
  //
  // Choosing an archetype now gives a starting point instead: the groups that
  // archetype serves by definition. Labelled as an archetype default so nobody
  // mistakes a seed for a finding about THIS organization — the operator's own
  // answers and the coworker's research replace them.
  return (playbook?.seedSegments ?? []).map((segment) => ({
    name: segment.name,
    description: `${segment.description} ${ARCHETYPE_DEFAULT_SUFFIX}`,
  }));
}

export function buildIdealCustomerProfiles(
  segments: NamedItem[],
  valueProposition: string | null,
): Profile[] {
  return segments.map((segment) => ({
    name: segment.name,
    traits: dedupeStrings([segment.description ?? null]),
    painPoints: dedupeStrings([valueProposition]),
  }));
}

export function buildEntryOffers(input: {
  tagline: string | null;
  description: string | null;
  website: string | null;
}): Offer[] {
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

export function buildServiceTerritories(
  geographicScope: string | null,
  addressSummary: string | null,
): Territory[] {
  const name = cleanText(geographicScope) ?? cleanText(addressSummary);
  if (!name) return [];
  return [{ name, postalCodes: [] }];
}

export function buildDifferentiators(input: {
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

export function buildConstraints(input: {
  geographicScope: string | null;
  companyStage: string | null;
}): ConstraintSummary | null {
  const constraints: ConstraintSummary = {};
  if (cleanText(input.geographicScope)) constraints.geography = input.geographicScope;
  if (cleanText(input.companyStage)) constraints.productMaturity = input.companyStage;
  return Object.keys(constraints).length > 0 ? constraints : null;
}
