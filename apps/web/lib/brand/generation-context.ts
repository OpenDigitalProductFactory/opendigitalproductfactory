// Brand as generation context (BI-7E7E8635).
//
// THE GAP THIS CLOSES. BrandDesignSystem is a considered model — logo lockups,
// voice and tone, palette with semantic roles, typography, plus confidence
// scoring and a self-declared `gaps` list. Its only consumer was
// designSystemToThemeTokens(), which projects it into portal CSS. Nothing fed
// it to the coworker when it wrote or generated anything, so marketing output
// was produced against a seeded default theme belonging to no organization.
//
// On this install Organization.designSystem is NULL and the single
// BrandingConfig row carries an empty organizationId, meaning it was never
// produced by the apply path — a generic default was standing in for a brand.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It does not invent. Where the record is
// silent the context says so, so the coworker asks or declines rather than
// filling the hole with plausible brand-sounding copy. `confidence.perField`
// and `gaps` exist precisely so the model can know what it does not know, and
// low-confidence fields are marked rather than asserted.

import type { BrandDesignSystem } from "./types";

export type BrandGenerationContext = {
  /** Prompt-ready standing context, or null when there is no brand to speak of. */
  text: string | null;
  /** Fields the record does not carry, so a caller can elicit them. */
  unknowns: string[];
  /** True when a brand record exists and carries at least an identity. */
  usable: boolean;
};

/** Below this, a field is reported as uncertain rather than stated as fact. */
const LOW_CONFIDENCE = 0.5;

function confidenceOf(system: BrandDesignSystem, field: string): number | null {
  const per = system.confidence?.perField;
  if (!per || typeof per !== "object") return null;
  const value = (per as Record<string, unknown>)[field];
  return typeof value === "number" ? value : null;
}

function mark(system: BrandDesignSystem, field: string, rendered: string): string {
  const c = confidenceOf(system, field);
  return c !== null && c < LOW_CONFIDENCE ? `${rendered} (low confidence — confirm before relying on it)` : rendered;
}

/**
 * Render a brand record into standing context for a generation prompt.
 *
 * Returns null text for an absent record rather than a cheerful empty brand:
 * "no brand on file" is actionable, an empty section reads as "nothing to
 * honour here" and produces exactly the generic output this closes.
 */
export function buildBrandGenerationContext(
  system: BrandDesignSystem | null | undefined,
): BrandGenerationContext {
  if (!system || !system.identity) {
    return {
      text: null,
      unknowns: ["identity", "voice", "imagery", "palette"],
      usable: false,
      };
  }

  const id = system.identity;
  const lines: string[] = [];
  const unknowns: string[] = [];

  lines.push(`Brand: ${id.name}`);
  if (id.tagline) lines.push(`Tagline: ${id.tagline}`);
  if (id.description) lines.push(`What it is: ${id.description}`);

  if (id.voice?.tone) {
    lines.push(mark(system, "voice.tone", `Voice: ${id.voice.tone}`));
  } else {
    unknowns.push("voice.tone");
  }

  const samples = id.voice?.sampleCopy ?? [];
  if (samples.length > 0) {
    lines.push(`Copy that sounds right: ${samples.map((s) => `"${s}"`).join("; ")}`);
  }

  if (id.imagery?.direction) {
    lines.push(mark(system, "imagery.direction", `Imagery: ${id.imagery.direction}`));
  } else {
    unknowns.push("imagery.direction");
  }

  const palette = system.palette;
  if (palette?.primary) {
    const accents = Array.isArray(palette.accents) ? palette.accents : [];
    const swatches = [palette.primary, palette.secondary, ...accents].filter(Boolean);
    lines.push(`Colours: ${swatches.join(", ")}`);
  } else {
    unknowns.push("palette.primary");
  }

  const families = system.typography?.families;
  if (families?.sans || families?.display) {
    lines.push(`Type: ${[families.display, families.sans].filter(Boolean).join(", ")}`);
  }

  const logos = [
    id.logo?.lightBg ? "light background" : null,
    id.logo?.darkBg ? "dark background" : null,
    id.logo?.mark ? "mark" : null,
  ].filter(Boolean);
  if (logos.length > 0) {
    lines.push(`Logo lockups available: ${logos.join(", ")}. Use a supplied lockup; never redraw or re-letter the logo.`);
  } else {
    unknowns.push("logo");
  }

  if (id.avoid && id.avoid.length > 0) {
    lines.push(`Never: ${id.avoid.join("; ")}`);
  } else {
    unknowns.push("avoid");
  }

  // The record's own declared gaps outrank anything inferred here.
  const declared = Array.isArray(system.gaps) ? system.gaps : [];
  for (const gap of declared) {
    if (typeof gap === "string" && !unknowns.includes(gap)) unknowns.push(gap);
  }

  if (unknowns.length > 0) {
    lines.push(
      `Not established: ${unknowns.join(", ")}. Ask rather than inventing these — a plausible guess about a brand is worse than an admitted gap.`,
    );
  }

  return { text: lines.join("\n"), unknowns, usable: true };
}
