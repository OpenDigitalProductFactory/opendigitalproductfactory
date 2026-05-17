/**
 * Portfolio node view model
 *
 * Pure mapping from a raw TaxonomyNode (description + governance JSON +
 * enrichment JSON) into a typed render-ready shape used by the portfolio
 * detail page (Task 3.3 of the discovery -> portfolio gap closure plan).
 *
 * Unknown JSON shapes log a one-line `[view-model]` warning and emit null
 * for the offending field; valid known shapes flow through with strict
 * types. The `raw` fields are JSON-cloned so callers cannot accidentally
 * mutate the source object.
 *
 * Hand-rolled type guards (no Zod) — keeps this module dependency-free
 * since it ships in the web app's render path.
 */

export interface PromotionView {
  mode: "auto" | "manual" | string;
  classifyAs?: string;
}

export interface GovernanceView {
  promotion: PromotionView | null;
  /** Optional governance.requiredFields per spec section 6.3. Future Chunk 7 sets this. */
  requiredFields: string[] | null;
  /** Entire JSON for debugging/hover display. JSON-cloned. */
  raw: Record<string, unknown> | null;
}

export interface EnrichmentReference {
  label: string;
  href: string;
}

export interface SectorCommercialMarket {
  sector: string;
  market: string;
}

export interface EnrichmentView {
  standards: string[] | null;
  patterns: string[] | null;
  references: EnrichmentReference[] | null;
  sampleServices: string | null;
  offeringConsiderations: string | null;
  commercialMarket: string | null;
  sectorCommercialMarkets: SectorCommercialMarket[] | null;
  /** Entire JSON for debugging/hover display. JSON-cloned. */
  raw: Record<string, unknown> | null;
}

export interface PortfolioNodeViewModel {
  /** Equal to node.description; empty strings collapse to null. */
  about: string | null;
  governance: GovernanceView;
  enrichment: EnrichmentView;
}

export interface PortfolioNodeInput {
  description: string | null;
  governance: unknown;
  enrichment: unknown;
}

// --- type guards -------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function cloneObject(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function warn(message: string): void {
  console.warn(`[view-model] ${message}`);
}

// --- about -------------------------------------------------------------

function projectAbout(description: string | null): string | null {
  if (description === null) return null;
  if (description === "") return null;
  return description;
}

// --- governance --------------------------------------------------------

function projectPromotion(governance: Record<string, unknown>): PromotionView | null {
  if (!("promotion" in governance)) return null;
  const promotion = governance.promotion;
  if (!isPlainObject(promotion)) {
    warn("governance.promotion is not an object; ignoring");
    return null;
  }
  const mode = promotion.mode;
  if (typeof mode !== "string") {
    warn("governance.promotion.mode is not a string; ignoring");
    return null;
  }
  const view: PromotionView = { mode };
  if (typeof promotion.classifyAs === "string") {
    view.classifyAs = promotion.classifyAs;
  }
  return view;
}

function projectRequiredFields(governance: Record<string, unknown>): string[] | null {
  if (!("requiredFields" in governance)) return null;
  const required = governance.requiredFields;
  if (!isStringArray(required)) {
    warn("governance.requiredFields is not a string[]; ignoring");
    return null;
  }
  return [...required];
}

function projectGovernance(governance: unknown): GovernanceView {
  if (governance === null || governance === undefined) {
    return { promotion: null, requiredFields: null, raw: null };
  }
  if (!isPlainObject(governance)) {
    warn("governance is not an object; ignoring");
    return { promotion: null, requiredFields: null, raw: null };
  }
  return {
    promotion: projectPromotion(governance),
    requiredFields: projectRequiredFields(governance),
    raw: cloneObject(governance),
  };
}

// --- enrichment --------------------------------------------------------

function projectStandards(enrichment: Record<string, unknown>): string[] | null {
  if (!("standards" in enrichment)) return null;
  const standards = enrichment.standards;
  if (!isStringArray(standards)) {
    warn("enrichment.standards is not a string[]; ignoring");
    return null;
  }
  return [...standards];
}

function projectPatterns(enrichment: Record<string, unknown>): string[] | null {
  if (!("patterns" in enrichment)) return null;
  const patterns = enrichment.patterns;
  if (!isStringArray(patterns)) {
    warn("enrichment.patterns is not a string[]; ignoring");
    return null;
  }
  return [...patterns];
}

function projectReferences(enrichment: Record<string, unknown>): EnrichmentReference[] | null {
  if (!("references" in enrichment)) return null;
  const references = enrichment.references;
  if (!Array.isArray(references)) {
    warn("enrichment.references is not an array; ignoring");
    return null;
  }
  const projected: EnrichmentReference[] = [];
  for (const entry of references) {
    if (!isPlainObject(entry)) continue;
    const { label, href } = entry;
    if (typeof label !== "string" || typeof href !== "string") continue;
    projected.push({ label, href });
  }
  return projected;
}

function projectTextField(enrichment: Record<string, unknown>, key: string): string | null {
  if (!(key in enrichment)) return null;
  const value = enrichment[key];
  if (typeof value !== "string") {
    warn(`enrichment.${key} is not a string; ignoring`);
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function projectSectorCommercialMarkets(
  enrichment: Record<string, unknown>,
): SectorCommercialMarket[] | null {
  const source = enrichment.industryMarkets ?? enrichment.sectorCommercialMarkets;
  if (source === undefined) return null;
  if (!isPlainObject(source)) {
    warn("enrichment.industryMarkets is not an object; ignoring");
    return null;
  }

  const projected = Object.entries(source)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([sector, market]) => ({ sector, market: market.trim() }))
    .filter((entry) => entry.sector.trim() !== "" && entry.market !== "");

  return projected.length > 0 ? projected : null;
}

function projectEnrichment(enrichment: unknown): EnrichmentView {
  if (enrichment === null || enrichment === undefined) {
    return {
      standards: null,
      patterns: null,
      references: null,
      sampleServices: null,
      offeringConsiderations: null,
      commercialMarket: null,
      sectorCommercialMarkets: null,
      raw: null,
    };
  }
  if (!isPlainObject(enrichment)) {
    warn("enrichment is not an object; ignoring");
    return {
      standards: null,
      patterns: null,
      references: null,
      sampleServices: null,
      offeringConsiderations: null,
      commercialMarket: null,
      sectorCommercialMarkets: null,
      raw: null,
    };
  }
  return {
    standards: projectStandards(enrichment),
    patterns: projectPatterns(enrichment),
    references: projectReferences(enrichment),
    sampleServices: projectTextField(enrichment, "sampleServices"),
    offeringConsiderations: projectTextField(enrichment, "offeringConsiderations"),
    commercialMarket: projectTextField(enrichment, "commercialMarket"),
    sectorCommercialMarkets: projectSectorCommercialMarkets(enrichment),
    raw: cloneObject(enrichment),
  };
}

// --- public ------------------------------------------------------------

export function toPortfolioNodeViewModel(node: PortfolioNodeInput): PortfolioNodeViewModel {
  return {
    about: projectAbout(node.description),
    governance: projectGovernance(node.governance),
    enrichment: projectEnrichment(node.enrichment),
  };
}
