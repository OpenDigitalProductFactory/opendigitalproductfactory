// Which saved versions get renditions (BI-9D43CBEF). Kept apart from
// renditions.ts so the document store can decide without loading the job.
import { officeSourceExtension, textOnlySourceExtension } from "./conversion/formats";

/**
 * Does a saved version carry a file the engine should render or read: an
 * office file, or a PDF whose text only the engine can extract (BI-26CD1D1E)?
 */
export function needsRenditions(version: { contentFormat: string; contentBlobId: string | null }): boolean {
  if (!version.contentBlobId) return false;
  return officeSourceExtension(version.contentFormat) !== null || textOnlySourceExtension(version.contentFormat) !== null;
}
