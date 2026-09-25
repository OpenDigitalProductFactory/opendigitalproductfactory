// Which saved versions get renditions (BI-9D43CBEF). Kept apart from
// renditions.ts so the document store can decide without loading the job.
import { officeSourceExtension } from "./conversion/formats";

/** Does a saved version carry an office file the engine should render? */
export function needsRenditions(version: { contentFormat: string; contentBlobId: string | null }): boolean {
  return Boolean(version.contentBlobId) && officeSourceExtension(version.contentFormat) !== null;
}
