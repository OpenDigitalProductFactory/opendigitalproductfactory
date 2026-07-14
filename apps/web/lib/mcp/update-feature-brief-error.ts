/**
 * Plain-English tool error for update_feature_brief failures (BI-PIR-309fb74b /
 * BI-PIR-f8c1640b). Only claims "past ideate" when the underlying error is the
 * phase gate — validation / forbidden / missing-org used to be misreported as
 * "past ideate", which made agents abandon real ideate builds.
 */
export function formatUpdateFeatureBriefError(err: unknown): { error: string; message: string } {
  const msg = err instanceof Error ? err.message : "Update failed";
  const isPastIdeate = /Ideate phase/i.test(msg) || /only be updated during Ideate/i.test(msg);
  if (isPastIdeate) {
    return {
      error: msg,
      message:
        `Could not update brief: ${msg}. The brief can only be updated during the Ideate phase. You are past that phase — proceed with your current phase instead.`,
    };
  }
  return {
    error: msg,
    message: `Could not update brief: ${msg}`,
  };
}
