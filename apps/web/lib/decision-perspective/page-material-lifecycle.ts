// Page-sourced decision material follows its page's published status
// (BI-BD9DEC45).
//
// A stance is gate-live through its PerspectiveMaterial row, not its WikiPage
// (stance-promotion.ts: "a WikiPage alone is a policy document"). The gate
// loads material by reviewStatus=approved + promotionState=promoted and never
// reads the backing page. So archiving a page through the editor or through
// publish_wiki_overlay_pages hid the stance from the list and from retrieval
// while its material went on deciding. Measured on the customer 0 install:
// six mis-homed field-service rulings, archived on 2026-09-16, were still
// grade A / weight 1.0, promoted, with cross-domain reach two months later.
//
// THE RULE. Material sourced from a wiki page (sourceRef.wikiPageId) is
// promoted while that page is published and revoked otherwise. "revoked" is
// the existing audit-preserving exclusion: scorePerspectiveMaterial drops it
// to weight 0 and the row stays for the record. Grade, weight and summary are
// never touched, so republishing restores exactly the authority that was there
// — it re-states an existing ruling rather than minting a new one.
//
// WHO MAY MOVE IT WHICH WAY. A human status transition moves it both ways
// (syncPageMaterialToStatus). The background reconcile only ever revokes:
// code running without a person may remove authority, never grant it.
//
// CANDIDATE IS NEVER TOUCHED. Candidate material has not been released by its
// own review lane; a page transition must not promote it, and revoking it
// would hide it from that lane.
//
// Nothing else in the codebase writes promotionState "revoked" for material
// today. If a second revoking reason is ever added, it must record its cause
// so a republish here cannot undo it.

export type PageMaterialPromotion = "promoted" | "revoked";

export type PageMaterialLifecycleClient = {
  perspectiveMaterial: {
    findMany(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<unknown>;
  };
  wikiPage: {
    findMany(args: unknown): Promise<unknown>;
  };
};

/** The promotion state page-sourced material must hold for a page in this status. */
export function promotionForPageStatus(status: string): PageMaterialPromotion {
  return status === "published" ? "promoted" : "revoked";
}

/**
 * Bring a page's material into line with the status a person just gave it.
 * Call after any status transition of an org overlay page.
 */
export async function syncPageMaterialToStatus(input: {
  db: Pick<PageMaterialLifecycleClient, "perspectiveMaterial">;
  pageId: string;
  pageStatus: string;
}): Promise<{ promotionState: PageMaterialPromotion; changed: number }> {
  const target = promotionForPageStatus(input.pageStatus);
  const from: PageMaterialPromotion = target === "promoted" ? "revoked" : "promoted";
  const result = (await input.db.perspectiveMaterial.updateMany({
    where: {
      sourceRef: { path: ["wikiPageId"], equals: input.pageId },
      promotionState: from,
    },
    data: { promotionState: target },
  })) as { count: number };
  return { promotionState: target, changed: result.count };
}

/**
 * The entry point the status-transition paths call. The page's status change
 * has already committed when this runs, so a failure is logged and never turns
 * a completed save into a reported failure — the same contract as craft
 * promotion and embedding. That is safe in both directions: a missed
 * revocation is repaired by the boot reconcile, and a missed restoration
 * leaves the stance revoked until the page is saved again, which fails closed.
 */
export async function syncPageMaterialAfterTransition(input: {
  db: Pick<PageMaterialLifecycleClient, "perspectiveMaterial">;
  pageId: string;
  pageStatus: string;
  origin: string;
  logger?: Pick<Console, "warn">;
}): Promise<{ promotionState: PageMaterialPromotion; changed: number } | null> {
  try {
    return await syncPageMaterialToStatus(input);
  } catch (err) {
    (input.logger ?? console).warn(
      `[${input.origin}] decision-material sync failed for page ${input.pageId} -> ${input.pageStatus} (a missed revocation is repaired on next boot): ${(err as Error).message}`,
    );
    return null;
  }
}

export type PageSourcedMaterial = { materialId: string; wikiPageId: string };

/**
 * Promoted material to revoke because its page exists and is not published.
 *
 * A page that cannot be found is left alone. Absence is ambiguous — a kernel
 * re-seed mid-flight, a partial load — and revoking on a failed lookup would be
 * BI-9E1E1939's error again, here able to strip every principle at once.
 */
export function planPageMaterialRevocations(
  material: readonly PageSourcedMaterial[],
  pageStatusById: ReadonlyMap<string, string>,
): string[] {
  return material
    .filter((row) => {
      const status = pageStatusById.get(row.wikiPageId);
      return status !== undefined && promotionForPageStatus(status) === "revoked";
    })
    .map((row) => row.materialId);
}

function wikiPageIdOf(sourceRef: unknown): string | null {
  if (!sourceRef || typeof sourceRef !== "object") return null;
  const value = (sourceRef as Record<string, unknown>)["wikiPageId"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Revoke promoted material whose page was unpublished before this rule
 * existed (or whose sync failed after the page moved). Revoke-only.
 */
export async function reconcilePageMaterialToStatus(input: {
  db: PageMaterialLifecycleClient;
  dryRun?: boolean;
}): Promise<{ examined: number; revoked: string[]; dryRun: boolean }> {
  const dryRun = input.dryRun === true;
  const promoted = (await input.db.perspectiveMaterial.findMany({
    where: { promotionState: "promoted" },
    select: { materialId: true, sourceRef: true },
  })) as Array<{ materialId: string; sourceRef: unknown }>;

  const pageSourced: PageSourcedMaterial[] = promoted.flatMap((row) => {
    const wikiPageId = wikiPageIdOf(row.sourceRef);
    return wikiPageId ? [{ materialId: row.materialId, wikiPageId }] : [];
  });
  if (pageSourced.length === 0) return { examined: 0, revoked: [], dryRun };

  const pages = (await input.db.wikiPage.findMany({
    where: { id: { in: [...new Set(pageSourced.map((row) => row.wikiPageId))] } },
    select: { id: true, status: true },
  })) as Array<{ id: string; status: string }>;

  const revoked = planPageMaterialRevocations(
    pageSourced,
    new Map(pages.map((page) => [page.id, page.status])),
  );
  if (!dryRun && revoked.length > 0) {
    // The promotionState guard keeps a row a person restored since the read
    // from being revoked by this pass.
    await input.db.perspectiveMaterial.updateMany({
      where: { materialId: { in: revoked }, promotionState: "promoted" },
      data: { promotionState: "revoked" },
    });
  }
  return { examined: pageSourced.length, revoked, dryRun };
}

/** Boot entry point: non-fatal by contract, logs its own outcome. */
export async function reconcilePageMaterialOnBoot(
  logger: Pick<Console, "log" | "warn"> = console,
): Promise<{ examined: number; revoked: string[]; dryRun: boolean } | null> {
  try {
    const { prisma } = await import("@dpf/db");
    const result = await reconcilePageMaterialToStatus({ db: prisma });
    if (result.revoked.length > 0) {
      logger.log(
        `[page-material] revoked ${result.revoked.length} of ${result.examined} page-sourced material row(s) whose page is not published: ${result.revoked.join(", ")}`,
      );
    }
    return result;
  } catch (err) {
    logger.warn("[page-material] reconcile failed (non-fatal):", err);
    return null;
  }
}
