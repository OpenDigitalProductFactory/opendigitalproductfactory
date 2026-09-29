// The message catalog (EP-6B33A840 L0.2). en-US is the source of truth; other
// locales are overlays under messages/<locale>/ and fall back PER KEY:
// regional -> macro-language -> en-US (e.g. es-MX -> es-419 -> es -> en-US).
// Pseudo-locales (en-XA, ar-XB) are generated from en-US at format time.
//
// Keys are typed from the en-US JSON (no generator): an unknown key is a
// compile error (AC-TYPED-KEYS).

import admin from "./messages/en-US/admin.json";
import errors from "./messages/en-US/errors.json";
import footprint from "./messages/en-US/footprint.json";
import approvals from "./messages/en-US/approvals.json";
import portfolio from "./messages/en-US/portfolio.json";
import setup from "./messages/en-US/setup.json";
import shell from "./messages/en-US/shell.json";
import { DEFAULT_LOCALE } from "./locales";
import type { MessageArgs } from "./mf2/format";
import { isPseudoLocale } from "./pseudo";
import { formatSource } from "./runtime";

/** The en-US source catalog, one entry per namespace. Add a namespace here and in messages/en-US/. */
export const SOURCE_CATALOG = { admin, approvals, errors, footprint, portfolio, setup, shell } as const;

export type Namespace = keyof typeof SOURCE_CATALOG;

/** Dotted paths to string leaves of a nested message object. */
export type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : T[K] extends object ? `${K}.${Paths<T[K]>}` : never;
}[keyof T & string];

export type MessageKey<N extends Namespace> = Paths<(typeof SOURCE_CATALOG)[N]>;

type NestedMessages = { [key: string]: string | NestedMessages };

/** Translated overlays by locale, then namespace. Empty until a locale is translated (L3.x). */
const OVERLAYS: Record<string, Partial<Record<Namespace, NestedMessages>>> = {};

function lookupPath(tree: NestedMessages | undefined, key: string): string | undefined {
  let node: string | NestedMessages | undefined = tree;
  for (const part of key.split(".")) {
    if (!node || typeof node === "string") return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** The locales to try for a key, most specific first, always ending at en-US. */
export function catalogFallbackChain(locale: string): string[] {
  const chain: string[] = [];
  try {
    const parsed = new Intl.Locale(locale);
    chain.push(parsed.toString());
    if (parsed.language === "es" && parsed.region && !["ES", "419"].includes(parsed.region)) chain.push("es-419");
    if (parsed.region || parsed.script) chain.push(parsed.language);
  } catch {
    // Malformed tag: fall straight through to the source.
  }
  // The source locale ends every chain; anything after it is never consulted.
  const sourceAt = chain.indexOf(DEFAULT_LOCALE);
  if (sourceAt >= 0) chain.length = sourceAt + 1;
  else chain.push(DEFAULT_LOCALE);
  return chain;
}

/** The raw MF2 source for a key in the best available locale, or undefined if the key does not exist. */
export function messageSource(locale: string, namespace: Namespace, key: string): string | undefined {
  for (const candidate of catalogFallbackChain(isPseudoLocale(locale) ? DEFAULT_LOCALE : locale)) {
    const tree = candidate === DEFAULT_LOCALE ? (SOURCE_CATALOG[namespace] as NestedMessages) : OVERLAYS[candidate]?.[namespace];
    const found = lookupPath(tree, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Every key of a namespace mapped to its best source for `locale`: what a client subtree needs. */
export function namespaceMessages(locale: string, namespace: Namespace): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (tree: NestedMessages, prefix: string) => {
    for (const [k, v] of Object.entries(tree)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof v === "string") out[key] = messageSource(locale, namespace, key) ?? v;
      else walk(v, key);
    }
  };
  walk(SOURCE_CATALOG[namespace] as NestedMessages, "");
  return out;
}

/** Resolve and format a catalog key. A key missing everywhere renders as the key itself, never empty. */
export function translate<N extends Namespace>(locale: string, namespace: N, key: MessageKey<N>, args?: MessageArgs): string {
  const source = messageSource(locale, namespace, key);
  if (source === undefined) return `${namespace}.${key}`;
  return formatSource(locale, source, args);
}
