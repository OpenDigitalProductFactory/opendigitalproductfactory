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
