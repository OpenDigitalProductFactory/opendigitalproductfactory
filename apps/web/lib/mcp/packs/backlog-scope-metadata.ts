import { BACKLOG_SCOPE_KIND_VALUES } from "@/lib/explore/backlog";

type ToolProperty = Record<string, unknown>;

export const backlogScopeCreateProperties: Record<string, ToolProperty> = {
  scopeKind: {
    type: "string",
    enum: [...BACKLOG_SCOPE_KIND_VALUES],
    description: "Planning scope: platform, common, archetype-category, archetype-leaf, multi-archetype, or unknown.",
  },
  archetypeCategories: {
    type: "array",
    items: { type: "string" },
    description: "Archetype category slugs this work specifically serves, e.g. fabric-care-services.",
  },
  archetypeIds: {
    type: "array",
    items: { type: "string" },
    description: "Leaf archetype slugs this work specifically serves, e.g. dry-cleaning-plant-network.",
  },
  scopeRationale: { type: "string", description: "Short reason for the planning scope classification." },
  lifecycleTags: {
    type: "array",
    items: { type: "string" },
    description: "Product/service lifecycle tags for roadmapping and budgeting, e.g. claim-ticket, ready-promise, booking, invoice.",
  },
};

export const backlogScopeUpdateProperties: Record<string, ToolProperty> = {
  scopeKind: backlogScopeCreateProperties.scopeKind,
  archetypeCategories: {
    type: "array",
    items: { type: "string" },
    description: "Replace archetype category scope slugs.",
  },
  archetypeIds: {
    type: "array",
    items: { type: "string" },
    description: "Replace leaf archetype scope slugs.",
  },
  scopeRationale: backlogScopeCreateProperties.scopeRationale,
  lifecycleTags: {
    type: "array",
    items: { type: "string" },
    description: "Replace product/service lifecycle tags.",
  },
};

export const backlogScopeFilterProperties: Record<string, ToolProperty> = {
  scopeKind: {
    type: "string",
    enum: [...BACKLOG_SCOPE_KIND_VALUES],
    description: "Filter by planning scope.",
  },
  archetypeCategory: { type: "string", description: "Filter to work tagged with one archetype category slug." },
  archetypeId: { type: "string", description: "Filter to work tagged with one leaf archetype slug." },
  lifecycleTag: { type: "string", description: "Filter to work tagged with one product/service lifecycle tag." },
};

/** Product-management scope is separate from archetype/planning scope. */
export const backlogProductScopeCreateProperties: Record<string, ToolProperty> = {
  organizationId: {
    type: "string",
    description:
      "Organization orgId, slug, or internal id. Required with business product-line/product scope.",
  },
  productLineId: {
    type: "string",
    description:
      "Business ProductLine lineId, key, or internal id. Do not use for a DigitalProduct.",
  },
  businessProductId: {
    type: "string",
    description:
      "Goods and Services Product productId, key, or internal id. Do not fabricate or substitute a DigitalProduct.",
  },
  digitalProductId: {
    type: "string",
    description:
      "DigitalProduct productId or internal id for digital-architecture work. Mutually exclusive with business product-line/product scope.",
  },
};

export const backlogProductScopeUpdateProperties =
  backlogProductScopeCreateProperties;

export const backlogScopeSelect = {
  scopeKind: true,
  archetypeCategories: true,
  archetypeIds: true,
  scopeRationale: true,
  lifecycleTags: true,
} as const;

export function optionalStringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function stringArrayParam(params: Record<string, unknown>, key: string): string[] | undefined {
  const value = params[key];
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean))];
}

export function validScopeKind(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const scopeKind = value.trim();
  return (BACKLOG_SCOPE_KIND_VALUES as readonly string[]).includes(scopeKind) ? scopeKind : undefined;
}

export function addScopeFilters(where: Record<string, unknown>, params: Record<string, unknown>): void {
  const scopeKind = validScopeKind(params["scopeKind"]);
  if (scopeKind) where["scopeKind"] = scopeKind;
  const archetypeCategory = optionalStringParam(params, "archetypeCategory");
  if (archetypeCategory) where["archetypeCategories"] = { has: archetypeCategory };
  const archetypeId = optionalStringParam(params, "archetypeId");
  if (archetypeId) where["archetypeIds"] = { has: archetypeId };
  const lifecycleTag = optionalStringParam(params, "lifecycleTag");
  if (lifecycleTag) where["lifecycleTags"] = { has: lifecycleTag };
}

export function scopeData<T extends {
  scopeKind: string | null;
  archetypeCategories: string[];
  archetypeIds: string[];
  scopeRationale?: string | null;
  lifecycleTags: string[];
}>(row: T) {
  return {
    scopeKind: row.scopeKind,
    archetypeCategories: row.archetypeCategories,
    archetypeIds: row.archetypeIds,
    ...(Object.prototype.hasOwnProperty.call(row, "scopeRationale") ? { scopeRationale: row.scopeRationale ?? null } : {}),
    lifecycleTags: row.lifecycleTags,
  };
}
