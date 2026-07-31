import { isRecord } from "@/lib/shared/coerce";

export const RESTAURANT_TABLE_SHAPES = [
  "round",
  "square",
  "rectangle",
  "booth",
  "bar",
] as const;

export type RestaurantTableShape = (typeof RESTAURANT_TABLE_SHAPES)[number];

export interface RestaurantTableAttributes {
  shape: RestaurantTableShape;
  combinationGroup: string | null;
  combinableWith: string[];
}

export type RestaurantTableAttributesValidation =
  | { ok: true; value: RestaurantTableAttributes }
  | { ok: false; error: string };

const SHAPE_SET = new Set<string>(RESTAURANT_TABLE_SHAPES);
const MAX_REFERENCE_LENGTH = 160;
const MAX_COMBINATION_LINKS = 24;

function cleanReference(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_REFERENCE_LENGTH
    ? trimmed
    : null;
}

/**
 * The single parser for HospitalityResource.attributes when kind=table.
 * Unknown values fail soft so old installs and future writers never break the
 * operating view; all writes still serialize through the closed contract.
 */
export function parseRestaurantTableAttributes(
  value: unknown,
): RestaurantTableAttributes {
  const record = isRecord(value) ? value : {};
  const shape =
    typeof record.shape === "string" && SHAPE_SET.has(record.shape)
      ? (record.shape as RestaurantTableShape)
      : "round";
  const combinationGroup = cleanReference(record.combinationGroup);
  const combinableWith = Array.isArray(record.combinableWith)
    ? [
        ...new Set(
          record.combinableWith
            .map(cleanReference)
            .filter((entry): entry is string => entry !== null),
        ),
      ].slice(0, MAX_COMBINATION_LINKS)
    : [];

  return { shape, combinationGroup, combinableWith };
}

export function serializeRestaurantTableAttributes(
  value: RestaurantTableAttributes,
): Record<string, unknown> {
  const parsed = parseRestaurantTableAttributes(value);
  return {
    shape: parsed.shape,
    ...(parsed.combinationGroup
      ? { combinationGroup: parsed.combinationGroup }
      : {}),
    ...(parsed.combinableWith.length > 0
      ? { combinableWith: parsed.combinableWith }
      : {}),
  };
}

export function validateRestaurantTableAttributesInput(
  value: unknown,
): RestaurantTableAttributesValidation {
  if (!isRecord(value) || !SHAPE_SET.has(String(value.shape))) {
    return { ok: false, error: "Choose a supported table shape." };
  }
  if (
    value.combinationGroup !== null &&
    value.combinationGroup !== undefined &&
    cleanReference(value.combinationGroup) === null
  ) {
    return { ok: false, error: "The table combination group is invalid." };
  }
  if (
    value.combinableWith !== undefined &&
    (!Array.isArray(value.combinableWith) ||
      value.combinableWith.length > MAX_COMBINATION_LINKS ||
      value.combinableWith.some(
        (entry) => cleanReference(entry) === null,
      ))
  ) {
    return { ok: false, error: "Combined-table references are invalid." };
  }
  return { ok: true, value: parseRestaurantTableAttributes(value) };
}
