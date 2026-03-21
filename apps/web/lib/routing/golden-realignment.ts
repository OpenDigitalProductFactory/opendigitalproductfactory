/**
 * EP-INF-006: Golden test realignment policy.
 * Determines whether golden tests should be re-run based on
 * metadata confidence level.
 *
 * See: docs/superpowers/specs/2026-03-18-ai-routing-and-profiling-design.md
 */

/**
 * Returns true when golden tests should be re-run for a model.
 * Currently triggered only when metadata confidence is "low".
 */
export function shouldRunGoldenTests(metadataConfidence: string): boolean {
  return metadataConfidence === "low";
}
