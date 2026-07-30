// BI-8AC24F3D: the ONE place a published craft override becomes gate-live
// material.
//
// THE DEFECT THIS CLOSES
// Two code paths flip an org-overlay page to `published`, and only one of them
// promoted craft doctrine into `PerspectiveMaterial`:
//
//   publishWikiOverlayPages (actions/wiki-publish.ts) — promoted. Its only
//     caller is the MCP tool `publish_wiki_overlay_pages` (registry_write).
//     NO UI calls it.
//   saveWikiOverlayEdit (actions/wiki-edit.ts) — the action the portal Edit
//     page actually calls. It wrote `status` and promoted nothing.
//
// So the reachable operator flow — /coworker-decisions/craft/<key> → Edit →
// Status → published → Save — published the page and created ZERO material.
// The profession gate went on deferring while the UI said the opposite
// ("Publish it to make it part of this role's craft"; the WWWD sibling
// BusinessStanceForm promises "Your AI now weighs this stance when it
// decides"). A publish that structurally succeeds and functionally does
// nothing is exactly the structural-verification-is-not-functional trap.
//
// The fix is one implementation with two callers, not a second authority:
// both publish paths call `promoteCraftOverrideOnPublish`. Keeping the
// promotion in a plain module (not a "use server" file) is deliberate — every
// export of a "use server" module becomes a callable server action, and this
// helper must not be reachable as its own endpoint.

import {
  parseProfessionPageSlug,
  promoteProfessionPageMaterial,
  type ProfessionMaterialPromotionClient,
} from "@dpf/db/profession-material-promotion";
import { PROFESSION_REGISTRY } from "@/lib/decision-perspective/resolve-profession-profile";

/** The page fields promotion needs. Satisfied by the rows both callers already select. */
export type CraftOverridePage = {
  id: string;
  slug: string;
  title: string;
  pageKind: string;
  abstract: string | null;
};

export type CraftPromotionOutcome = {
  pageId: string;
  slug: string;
  professionKey: string;
  gateLive: boolean;
  materialIds: string[];
};

/**
 * Promote a just-published `craft/<professionKey>/` override to
 * `confirmed`-tier material. Publishing an override IS the owner's approval —
 * the profession sibling of `publishBusinessStance`'s `promoteStanceMaterial`
 * call (WSID Phase 6, BI-3B02FF9C).
 *
 * Returns null when the page is not an org-override craft page, when the
 * profession has no profile, when the page kind is not decision-bearing, or
 * when promotion throws.
 *
 * NEVER THROWS, and callers must never roll back the publish on a null: the
 * status flip has already happened and the seed backfill converges any missed
 * material on its next run. A failed promotion is a warning, not a lost page.
 */
export async function promoteCraftOverrideOnPublish(input: {
  db: ProfessionMaterialPromotionClient;
  page: CraftOverridePage;
  /** Where the call came from, for the warning line only. */
  origin: string;
}): Promise<CraftPromotionOutcome | null> {
  const slugInfo = parseProfessionPageSlug(input.page.slug);
  if (slugInfo?.corpus !== "org-override") return null;

  try {
    const family = PROFESSION_REGISTRY.families.find(
      (f) => f.professionKey === slugInfo.professionKey,
    );
    const promoted = await promoteProfessionPageMaterial({
      db: input.db,
      professionKey: slugInfo.professionKey,
      contextSlugs: family?.contextSlugs ?? [],
      page: {
        id: input.page.id,
        slug: input.page.slug,
        title: input.page.title,
        pageKind: input.page.pageKind,
        abstract: input.page.abstract,
      },
      tier: "confirmed",
    });

    if (!promoted.ok) {
      console.warn(
        `[${input.origin}] craft promotion skipped for ${input.page.slug}: ${promoted.error}`,
      );
      return null;
    }

    return {
      pageId: input.page.id,
      slug: input.page.slug,
      professionKey: slugInfo.professionKey,
      gateLive: promoted.gateLive,
      materialIds: promoted.materialIds,
    };
  } catch (promotionError) {
    console.warn(
      `[${input.origin}] craft promotion failed for ${input.page.slug}: ${(promotionError as Error).message}`,
    );
    return null;
  }
}
