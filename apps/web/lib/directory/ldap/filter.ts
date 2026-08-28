// LDAP search filters (RFC 4511 §4.5.1) — EP-24741BBF · BI-F7317D65.
//
// Supports the subset a real client actually sends against a read-only
// directory: and / or / not / equalityMatch / present / substrings. Anything
// else decodes to `unsupported`, which evaluates to NO MATCH rather than
// throwing or, worse, matching. A filter this server cannot reason about must
// never widen a result set.

import { BerReader } from "./ber";

export const FILTER_TAG = {
  AND: 0xa0,
  OR: 0xa1,
  NOT: 0xa2,
  EQUALITY: 0xa3,
  SUBSTRINGS: 0xa4,
  GREATER_OR_EQUAL: 0xa5,
  LESS_OR_EQUAL: 0xa6,
  PRESENT: 0x87,
  APPROX: 0xa8,
} as const;

const SUBSTRING_TAG = { INITIAL: 0x80, ANY: 0x81, FINAL: 0x82 } as const;

export type LdapFilter =
  | { type: "and"; filters: LdapFilter[] }
  | { type: "or"; filters: LdapFilter[] }
  | { type: "not"; filter: LdapFilter }
  | { type: "equality"; attribute: string; value: string }
  | { type: "present"; attribute: string }
  | { type: "substrings"; attribute: string; initial?: string; any: string[]; final?: string }
  | { type: "unsupported"; tag: number };

export function decodeFilter(reader: BerReader): LdapFilter {
  const tag = reader.peekTag();
  if (tag === null) throw new Error("LDAP filter: unexpected end of input");

  switch (tag) {
    case FILTER_TAG.AND:
    case FILTER_TAG.OR: {
      const inner = reader.readConstructed(tag);
      const filters: LdapFilter[] = [];
      while (inner.remaining > 0) filters.push(decodeFilter(inner));
      return tag === FILTER_TAG.AND ? { type: "and", filters } : { type: "or", filters };
    }
    case FILTER_TAG.NOT: {
      const inner = reader.readConstructed(tag);
      return { type: "not", filter: decodeFilter(inner) };
    }
    case FILTER_TAG.EQUALITY: {
      const inner = reader.readConstructed(tag);
      return { type: "equality", attribute: inner.readString(), value: inner.readString() };
    }
    case FILTER_TAG.PRESENT: {
      // Primitive: the value IS the attribute description.
      return { type: "present", attribute: reader.readElement(tag).value.toString("utf8") };
    }
    case FILTER_TAG.SUBSTRINGS: {
      const inner = reader.readConstructed(tag);
      const attribute = inner.readString();
      const parts = inner.readConstructed();
      let initial: string | undefined;
      let final: string | undefined;
      const any: string[] = [];
      while (parts.remaining > 0) {
        const { tag: partTag, value } = parts.readElement();
        const text = value.toString("utf8");
        if (partTag === SUBSTRING_TAG.INITIAL) initial = text;
        else if (partTag === SUBSTRING_TAG.FINAL) final = text;
        else if (partTag === SUBSTRING_TAG.ANY) any.push(text);
      }
      return { type: "substrings", attribute, initial, any, final };
    }
    default: {
      // Consume the element so framing stays intact, then report it unsupported.
      reader.readElement(tag);
      return { type: "unsupported", tag };
    }
  }
}

const fold = (value: string) => value.trim().toLowerCase();

function valuesFor(
  attributes: Record<string, string[]>,
  attribute: string,
): string[] {
  const wanted = fold(attribute);
  for (const [name, values] of Object.entries(attributes)) {
    if (fold(name) === wanted) return values;
  }
  return [];
}

/**
 * Evaluate a filter against one entry's PUBLISHED attributes.
 *
 * Matching is case-insensitive, which is the default for the string attributes
 * this directory publishes. Evaluation runs against the post-allowlist view, so
 * a client can never use a filter to confirm the value of a withheld attribute
 * — `(passwordHash=*)` is false because the attribute is not there to match.
 */
export function matchesFilter(filter: LdapFilter, attributes: Record<string, string[]>): boolean {
  switch (filter.type) {
    case "and":
      return filter.filters.every((child) => matchesFilter(child, attributes));
    case "or":
      return filter.filters.some((child) => matchesFilter(child, attributes));
    case "not":
      return !matchesFilter(filter.filter, attributes);
    case "present":
      return valuesFor(attributes, filter.attribute).length > 0;
    case "equality": {
      const wanted = fold(filter.value);
      return valuesFor(attributes, filter.attribute).some((value) => fold(value) === wanted);
    }
    case "substrings": {
      return valuesFor(attributes, filter.attribute).some((raw) => {
        let cursor = fold(raw);
        if (filter.initial !== undefined) {
          const initial = fold(filter.initial);
          if (!cursor.startsWith(initial)) return false;
          cursor = cursor.slice(initial.length);
        }
        for (const fragment of filter.any) {
          const index = cursor.indexOf(fold(fragment));
          if (index === -1) return false;
          cursor = cursor.slice(index + fragment.length);
        }
        if (filter.final !== undefined) {
          return cursor.endsWith(fold(filter.final));
        }
        return true;
      });
    }
    case "unsupported":
      // A filter we cannot reason about must not widen the result set.
      return false;
  }
}
