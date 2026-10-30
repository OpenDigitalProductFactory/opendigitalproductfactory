// BI-23900D0A: every wiki body write ends here, so a page's stored out-links
// (`WikiPageLink` and the `LINKS_TO` mirror) always equal what its body says.
//
// This replaced two private `syncOutLinks` copies (proposal-commit.ts and
// wiki-edit.ts) that only upserted and only resolved within the exact
// organization. Five other body writers wrote no links at all. The writer
// itself lives in @dpf/db (`replaceWikiPageOutLinks`), shared with the seeders
// and the boot backfill.

import { projectWikiLinksToGraph } from "@dpf/db/graph-sync";
import { replaceWikiPageOutLinks, type WikiLinkClient } from "@dpf/db/wiki-store";

import { getErrorMessage } from "@/lib/shared/get-error-message";

/**
 * Replace a page's out-links after its body was written. A link failure never
 * fails the page write it follows. It is logged and returned, and the boot
 * reconciliation repairs the rows on the next refresh.
 */
export async function syncWikiPageLinks(
  db: WikiLinkClient,
  page: { pageId: string; organizationId: string | null; body: string },
): Promise<{ error: string | null }> {
  try {
    const result = await replaceWikiPageOutLinks(db, page, projectWikiLinksToGraph);
    if (result.projectionError) {
      console.warn(`[wiki-links] LINKS_TO projection for ${page.pageId} failed: ${result.projectionError}`);
    }
    return { error: null };
  } catch (err) {
    const error = getErrorMessage(err);
    console.warn(`[wiki-links] link sync for ${page.pageId} failed: ${error}`);
    return { error };
  }
}
