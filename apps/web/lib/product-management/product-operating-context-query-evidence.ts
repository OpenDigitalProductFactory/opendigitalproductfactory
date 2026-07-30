import type {
  ConsumerEvidenceContextItem,
  IntelligenceContextItem,
} from "./product-operating-context";
import { normalizeProductIntelligenceScope } from "./product-intelligence-scope";
import {
  dateOf,
  recordOf,
  stringOf,
  type ProductSoldRow,
} from "./product-operating-context-query-types";

export function researchEvidenceOf(metadata: unknown): {
  confidence: "low" | "medium" | "high" | null;
  comparisonKind: "first-run" | "changed-since" | null;
  emptyReason:
    | "no-results"
    | "provider-unavailable"
    | "synthesis-empty"
    | null;
  retrievedAt: Date | null;
  sourceUrls: string[];
} {
  const evidence = recordOf(recordOf(metadata)["evidence"]);
  const confidence =
    evidence["confidence"] === "low" ||
    evidence["confidence"] === "medium" ||
    evidence["confidence"] === "high"
      ? evidence["confidence"]
      : null;
  const comparisonKind =
    evidence["comparisonKind"] === "first-run" ||
    evidence["comparisonKind"] === "changed-since"
      ? evidence["comparisonKind"]
      : null;
  const emptyReason =
    evidence["emptyReason"] === "no-results" ||
    evidence["emptyReason"] === "provider-unavailable" ||
    evidence["emptyReason"] === "synthesis-empty"
      ? evidence["emptyReason"]
      : null;
  const sourceUrls = Array.isArray(evidence["sourceUrls"])
    ? evidence["sourceUrls"].filter(
        (url): url is string => typeof url === "string" && url.length > 0,
      )
    : [];
  return {
    confidence,
    comparisonKind,
    emptyReason,
    retrievedAt: dateOf(evidence["retrievedAt"]),
    sourceUrls,
  };
}

export function researchLocatorEvidenceOf(locatorValue: unknown): {
  confidence: "low" | "medium" | "high" | null;
  comparisonKind: "first-run" | "changed-since" | null;
  sourceUrls: string[];
} {
  const locator = recordOf(locatorValue);
  const confidence =
    locator["confidence"] === "low" ||
    locator["confidence"] === "medium" ||
    locator["confidence"] === "high"
      ? locator["confidence"]
      : null;
  const comparisonKind =
    locator["comparisonKind"] === "first-run" ||
    locator["comparisonKind"] === "changed-since"
      ? locator["comparisonKind"]
      : null;
  const sourceUrls = Array.isArray(locator["urls"])
    ? locator["urls"].filter(
        (url): url is string => typeof url === "string" && url.trim().length > 0,
      )
    : [];
  return { confidence, comparisonKind, sourceUrls };
}

export function reviewedResearchScopeOf(
  locatorValue: unknown,
  organizationId: string,
) {
  const locator = recordOf(locatorValue);
  if (stringOf(locator["sourceType"]) !== "research") return null;
  try {
    return normalizeProductIntelligenceScope({
      organizationId,
      productLineId: stringOf(locator["productLineId"]),
      businessProductId: stringOf(locator["businessProductId"]),
      digitalProductId: stringOf(locator["digitalProductId"]),
    });
  } catch {
    return null;
  }
}

export function scopeIsVisible(
  scope: ReturnType<typeof normalizeProductIntelligenceScope>,
  visible: {
    productLineIds: string[];
    productIds: string[];
    digitalProductIds: string[];
  },
): boolean {
  if (scope.kind === "organization") return true;
  if (scope.kind === "product-line") {
    return visible.productLineIds.includes(scope.productLineId!);
  }
  if (scope.kind === "business-product") {
    return visible.productIds.includes(scope.businessProductId!);
  }
  return visible.digitalProductIds.includes(scope.digitalProductId!);
}

export function dedupeIntelligenceItems(
  items: IntelligenceContextItem[],
): IntelligenceContextItem[] {
  const byCanonicalSource = new Map<string, IntelligenceContextItem>();
  for (const item of items) {
    const key = `${item.sourceKind}:${item.id}`;
    const existing = byCanonicalSource.get(key);
    if (!existing) {
      byCanonicalSource.set(key, item);
      continue;
    }
    byCanonicalSource.set(key, {
      ...existing,
      asOf:
        existing.asOf.getTime() >= item.asOf.getTime()
          ? existing.asOf
          : item.asOf,
      retrievedAt:
        !existing.retrievedAt ||
        (item.retrievedAt &&
          item.retrievedAt.getTime() > existing.retrievedAt.getTime())
          ? item.retrievedAt
          : existing.retrievedAt,
      sourceUrls: Array.from(
        new Set([...(existing.sourceUrls ?? []), ...(item.sourceUrls ?? [])]),
      ).sort(),
    });
  }
  return [...byCanonicalSource.values()];
}

export function intelligenceScopeOf(row: {
  productLineId: string | null;
  businessProductId: string | null;
  digitalProductId: string | null;
}, organizationId: string) {
  return normalizeProductIntelligenceScope({
    organizationId,
    productLineId: row.productLineId,
    businessProductId: row.businessProductId,
    digitalProductId: row.digitalProductId,
  }).kind;
}

export function productSoldConsumers(
  row: ProductSoldRow,
): ConsumerEvidenceContextItem[] {
  const fromParties = row.parties.flatMap((party) => {
    if (
      party.role !== "account" &&
      party.role !== "consumer" &&
      party.role !== "subscriber"
    ) {
      return [];
    }
    const snapshot = recordOf(party.displaySnapshot);
    const label =
      stringOf(snapshot["name"]) ??
      stringOf(snapshot["email"]) ??
      stringOf(snapshot["accountId"]);
    if (!label) return [];
    return [
      {
        id: party.id,
        sourceKind: "product-sold-party",
        asOf: party.observedAt,
        role: party.role,
        label,
        canonicalLinkEstablished: true,
      } satisfies ConsumerEvidenceContextItem,
    ];
  });
  if (fromParties.length > 0) return fromParties;

  return row.evidence.flatMap((evidence) => {
    const snapshot = recordOf(evidence.evidenceSnapshot);
    const label =
      stringOf(snapshot["customerName"]) ??
      stringOf(snapshot["customerEmail"]);
    if (!label) return [];
    return [
      {
        id: evidence.id,
        sourceKind: evidence.evidenceKind,
        asOf: evidence.observedAt,
        role: "consumer",
        label,
        canonicalLinkEstablished: false,
      } satisfies ConsumerEvidenceContextItem,
    ];
  });
}
