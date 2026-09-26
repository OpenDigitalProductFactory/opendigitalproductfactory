// Pseudo-locales, GENERATED from the en-US source, never authored:
//   en-XA  accented, ~35% longer, bracketed: catches unexternalized strings
//          (they stay plain ASCII) and truncation (they grow).
//   ar-XB  wrapped in RIGHT-TO-LEFT OVERRIDE ... POP DIRECTIONAL FORMATTING, so
//          Latin text renders mirrored and the page runs rtl, without any
//          translation spend.
// Only TEXT parts change; placeholders and selector keys are untouched, so a
// pseudo message formats with the same arguments as its source.

import type { Message, Pattern } from "./mf2/ast";

export const PSEUDO_LOCALES = ["en-XA", "ar-XB"] as const;
export type PseudoLocale = (typeof PSEUDO_LOCALES)[number];

export function isPseudoLocale(tag: string): tag is PseudoLocale {
  return (PSEUDO_LOCALES as readonly string[]).includes(tag);
}

const ACCENTS: Record<string, string> = {
  a: "á", b: "ƀ", c: "ç", d: "ð", e: "é", f: "ƒ", g: "ĝ", h: "ĥ", i: "í", j: "ĵ", k: "ķ", l: "ļ", m: "ɱ",
  n: "ñ", o: "ó", p: "þ", q: "ǫ", r: "ŕ", s: "š", t: "ţ", u: "ú", v: "ṽ", w: "ŵ", x: "ẋ", y: "ý", z: "ž",
  A: "Á", B: "Ɓ", C: "Ç", D: "Ð", E: "É", F: "Ƒ", G: "Ĝ", H: "Ĥ", I: "Í", J: "Ĵ", K: "Ķ", L: "Ļ", M: "Ṁ",
  N: "Ñ", O: "Ó", P: "Þ", Q: "Ǫ", R: "Ŕ", S: "Š", T: "Ţ", U: "Ú", V: "Ṽ", W: "Ŵ", X: "Ẋ", Y: "Ý", Z: "Ž",
};

const RLO = "‮";
const PDF = "‬";

function accentText(text: string): string {
  return [...text].map((ch) => ACCENTS[ch] ?? ch).join("");
}

function transformPattern(pattern: Pattern, locale: PseudoLocale): Pattern {
  return pattern.map((part) => {
    if (part.kind !== "text") return part;
    return { kind: "text", value: locale === "en-XA" ? accentText(part.value) : part.value };
  });
}

function sourceLength(pattern: Pattern): number {
  return pattern.reduce((n, part) => n + (part.kind === "text" ? part.value.length : 4), 0);
}

function wrap(pattern: Pattern, locale: PseudoLocale): Pattern {
  if (locale === "ar-XB") return [{ kind: "text", value: RLO }, ...pattern, { kind: "text", value: PDF }];
  const padding = "·".repeat(Math.max(1, Math.ceil(sourceLength(pattern) * 0.35)));
  return [{ kind: "text", value: "⟦" }, ...pattern, { kind: "text", value: `${padding}⟧` }];
}

/** A pseudo-localized copy of a parsed source message. */
export function pseudoLocalize(message: Message, locale: PseudoLocale): Message {
  if (message.kind === "pattern") return { kind: "pattern", pattern: wrap(transformPattern(message.pattern, locale), locale) };
  return {
    ...message,
    variants: message.variants.map((v) => ({ keys: v.keys, pattern: wrap(transformPattern(v.pattern, locale), locale) })),
  };
}
