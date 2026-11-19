// Source code is classified by the repository it comes from, not raised to
// confidential because a payload contains code (BI-FC94F754). See
// SourceCodeProvenance in ./types for who may supply the record.
import type { GovernedPayloadHint, InferenceDataClass, SourceCodeProvenance } from "./types";

/**
 * True only for a named repository the caller PROVED public. `private`,
 * `unknown` and an absent provenance all keep code confidential: an unproven
 * visibility is never treated as public.
 */
export function isPublicSourceProvenance(
  provenance: SourceCodeProvenance | null | undefined,
): boolean {
  return provenance?.visibility === "public" && provenance.repository.trim().length > 0;
}

/**
 * Source code is confidential because an organization's own code usually is,
 * not because code is sensitive in itself. Code from a repository proven
 * public is already published, so it no longer raises the payload; every
 * other confidential class still does.
 */
export function sourceCodeExemptFromConfidential(
  dataClass: InferenceDataClass,
  publicSource: boolean,
): boolean {
  return publicSource && dataClass === "source-code";
}

/** Probe path prefix for spans the public forge already serves (BI-3D5AC133). */
const PUBLISHED_PATH_PREFIX = "published[";

/**
 * Carve the caller's published spans out of one message's text (BI-3D5AC133).
 *
 * A span read from a proven-public repository at commits the public forge
 * serves discloses nothing new when sent to a provider, so it is probed under
 * its own path and never counts as data evidence; the matches stay on the
 * record. Spans are matched literally, longest first, every occurrence. A span
 * absent from the text exempts nothing. Without proven-public provenance no
 * span is honoured, so the whole text is returned unchanged.
 */
export function carvePublishedText(
  text: string,
  provenance: SourceCodeProvenance | null | undefined,
  path: string,
  probe: (probePath: string, spanText: string) => void,
): string {
  if (!isPublicSourceProvenance(provenance)) return text;
  const spans = (provenance?.publishedText ?? []).filter((span) => span.trim().length > 0);
  let remainder = text;
  for (const span of [...spans].sort((a, b) => b.length - a.length)) {
    if (!remainder.includes(span)) continue;
    probe(`${PUBLISHED_PATH_PREFIX}${path}]`, span);
    remainder = remainder.split(span).join("\n");
  }
  return remainder;
}

/** True for a match found only inside text the public forge already serves. */
export function isPublishedSourceMatch(match: { path: string }): boolean {
  return match.path.startsWith(PUBLISHED_PATH_PREFIX);
}

/**
 * Public only when the payload's evidence is public code and nothing else.
 * Provenance speaks for the code: a payload with no code in it, or with any
 * caller-declared governed data, keeps the fail-closed `internal`.
 */
export function isPublicSourceOnlyEvidence(input: {
  publicSource: boolean;
  dataClasses: readonly InferenceDataClass[];
  governedData: readonly GovernedPayloadHint[] | undefined;
}): boolean {
  return input.publicSource &&
    !(input.governedData && input.governedData.length > 0) &&
    input.dataClasses.length > 0 &&
    input.dataClasses.every((dataClass) => dataClass === "source-code");
}
