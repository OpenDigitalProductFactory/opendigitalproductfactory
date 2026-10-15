// Text direction is a property of a language's SCRIPT, so it is derived from
// CLDR likely-subtags (Intl.Locale#maximize) rather than kept in a list of
// languages. Covers Arabic, Hebrew, Thaana, Syriac, N'Ko, Adlam and Hanifi
// Rohingya scripts.

export type TextDirection = "ltr" | "rtl";

const RTL_SCRIPTS = new Set(["Arab", "Hebr", "Thaa", "Syrc", "Nkoo", "Adlm", "Rohg"]);

export function direction(tag: string | null | undefined): TextDirection {
  if (!tag) return "ltr";
  try {
    const script = new Intl.Locale(tag.trim()).maximize().script;
    return script && RTL_SCRIPTS.has(script) ? "rtl" : "ltr";
  } catch {
    // Not a well-formed BCP-47 tag.
    return "ltr";
  }
}

export function isRtl(tag: string | null | undefined): boolean {
  return direction(tag) === "rtl";
}
