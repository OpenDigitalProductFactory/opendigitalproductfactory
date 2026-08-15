"use server";
// EP-WIKI-001 Phase 6b extension: batch publish helper for overlay drafts.
// Pairs with the `review-wiki-drafts` coworker skill — after the agent walks
// the user through the pending drafts in chat, it calls this action with the
// page-id list to flip status from "draft" to "published" in one round-trip.
//
// Editing rules per spec §4 (Edit Policy) still apply:
//   - Kernel pages (organizationId = NULL, isKernel = true) are PR-only and
//     are silently filtered out — the action reports them in `result.rejected`
//     so the caller surfaces the gap to the user instead of failing the
//     whole batch.
//   - Cross-org writes are refused; only pages belonging to the current
//     session's organization are publishable.
//
// Every flip appends a `WikiPageRevision` with `changeKind = "manual"` and
// `changeSummary = "Publish via /coworker-decisions?status=all batch"` so the revision log
// records who approved each page.

import { prisma } from "@dpf/db";
import {
  appendRevision,
  type WikiPageStatus,
} from "@dpf/db/wiki-store";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/actions/shared/guards";
import { promoteCraftOverrideOnPublish } from "@/lib/wiki/craft-override-promotion";
import { embedPublishedOverlayPage } from "@/lib/wiki/embed-published-overlay";

// ─── Types ──────────────────────────────────────────────────────────────────

export type PublishWikiOverlayPagesInput = {
  pageIds: string[];
  /**
   * Optional target status. Defaults to "published". Useful when the caller
   * wants to mark drafts as "review-needed" instead — same gating logic.
   */
  targetStatus?: WikiPageStatus;
  /** Optional summary written to the revision log for every flipped page. */
  changeSummary?: string;
};

export type PublishedRow = {
  pageId: string;
  slug: string;
  previousStatus: WikiPageStatus;
  newStatus: WikiPageStatus;
};

export type CraftPromotionRow = {
  pageId: string;
  slug: string;
  professionKey: string;
  /** True when the material rows are approved+promoted (gate-visible). */
  gateLive: boolean;
  materialIds: string[];
};

export type RejectedRow = {
  pageId: string;
  reason: "not-found" | "kernel" | "cross-org" | "already-target-status";
};

export type PublishWikiOverlayPagesResult =
  | {
      ok: true;
      published: PublishedRow[];
      rejected: RejectedRow[];
      /**
       * WSID craft overrides that went gate-live with this publish
       * (BI-3B02FF9C): publishing a craft/<professionKey>/ page also promotes
       * owner-confirmed PerspectiveMaterial on the profession's wsid profile.
       */
      craftPromotions: CraftPromotionRow[];
    }
  | { ok: false; error: string };

// ─── Helpers ────────────────────────────────────────────────────────────────


async function requireOrganization(): Promise<{ id: string }> {
  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) {
    throw new Error(
      "publishWikiOverlayPages: no Organization row — wiki edits need an org context.",
    );
  }
  return { id: org.id };
}

// ─── Main action ────────────────────────────────────────────────────────────

/**
 * Flip status on a batch of org-overlay wiki pages. Kernel pages and
 * cross-org pages are filtered out and reported; the rest are updated
 * with a revision row per page.
 *
 * Returns a structured result rather than throwing on partial failure
 * so the calling coworker skill can show the user precisely which
 * drafts moved and which need a different path (e.g. kernel pages →
 * `draft-kernel-edit-pr`).
 */
export async function publishWikiOverlayPages(
  input: PublishWikiOverlayPagesInput,
): Promise<PublishWikiOverlayPagesResult> {
  try {
    const user = await requireUser();
    const org = await requireOrganization();

    if (!Array.isArray(input.pageIds) || input.pageIds.length === 0) {
      return { ok: false, error: "pageIds is required and must be non-empty." };
    }

    const targetStatus: WikiPageStatus = input.targetStatus ?? "published";
    const summary =
      input.changeSummary ?? `Status flipped to ${targetStatus} via batch review.`;

    const rows = (await prisma.wikiPage.findMany({
      where: { id: { in: input.pageIds } },
      select: {
        id: true,
        slug: true,
        title: true,
        body: true,
        status: true,
        isKernel: true,
        organizationId: true,
        pageKind: true,
        abstract: true,
      },
    })) as Array<{
      id: string;
      slug: string;
      title: string;
      body: string;
      status: WikiPageStatus;
      isKernel: boolean;
      organizationId: string | null;
      pageKind: string;
      abstract: string | null;
    }>;

    const foundIds = new Set(rows.map((r) => r.id));
    const published: PublishedRow[] = [];
    const rejected: RejectedRow[] = [];
    const craftPromotions: CraftPromotionRow[] = [];

    for (const id of input.pageIds) {
      if (!foundIds.has(id)) {
        rejected.push({ pageId: id, reason: "not-found" });
      }
    }

    for (const row of rows) {
      if (row.isKernel || row.organizationId === null) {
        rejected.push({ pageId: row.id, reason: "kernel" });
        continue;
      }
      if (row.organizationId !== org.id) {
        rejected.push({ pageId: row.id, reason: "cross-org" });
        continue;
      }
      if (row.status === targetStatus) {
        rejected.push({ pageId: row.id, reason: "already-target-status" });
        continue;
      }
      const previousStatus = row.status;
      await prisma.wikiPage.update({
        where: { id: row.id },
        data: { status: targetStatus, lastReviewedAt: new Date() },
      });
      await appendRevision(prisma, {
        pageId: row.id,
        title: row.title,
        body: row.body,
        changeKind: "manual",
        changeSummary: summary,
        createdById: user.id,
      });
      published.push({
        pageId: row.id,
        slug: row.slug,
        previousStatus,
        newStatus: targetStatus,
      });

      // WSID Phase 6 (BI-3B02FF9C): publishing a craft override is the owner's
      // approval, so it becomes gate-live doctrine — the profession sibling of
      // publishBusinessStance's promoteStanceMaterial call. Promotion failure
      // never rolls back the page publish: the page flip already happened and
      // the seed backfill converges any missed material on its next run.
      //
      // BI-8AC24F3D: the promotion body moved to the shared helper so this path
      // and saveWikiOverlayEdit (the action the portal Edit page calls) cannot
      // diverge again — publishing here and publishing there must mean the
      // same thing.
      if (targetStatus === "published") {
        const promotion = await promoteCraftOverrideOnPublish({
          db: prisma,
          page: {
            id: row.id,
            slug: row.slug,
            title: row.title,
            pageKind: row.pageKind,
            abstract: row.abstract,
          },
          origin: "wiki-publish",
        });
        if (promotion) craftPromotions.push(promotion);

        // BI-D4C1E05E: embed the newly-published page so it is retrievable by
        // the decision engine — the same embed seam every publish path shares.
        await embedPublishedOverlayPage({
          page: {
            id: row.id,
            slug: row.slug,
            title: row.title,
            body: row.body,
            abstract: row.abstract,
            pageKind: row.pageKind,
          },
          organizationId: org.id,
          origin: "wiki-publish",
        });
      }
      revalidatePath(`/coworker-decisions/${row.slug}`);
    }
    revalidatePath("/coworker-decisions");

    return { ok: true, published, rejected, craftPromotions };
  } catch (err) {
    return {
      ok: false,
      error: (err as Error).message ?? "Unknown error during publish.",
    };
  }
}

// ─── Read helper used by the review skill ──────────────────────────────────

export type DraftWikiPageSummary = {
  pageId: string;
  slug: string;
  title: string;
  pageKind: string;
  abstract: string | null;
  /** Length in chars — lets the coworker decide how much body to render inline. */
  bodyLength: number;
  /** First 800 chars of the body, for chat-friendly preview. */
  bodyPreview: string;
  kernelPageId: string | null;
  derivedFromKernelVersion: string | null;
  /** Slug of the linked raw sources, if any — surfaces ingest provenance. */
  sourceSlugs: string[];
};

/**
 * Read every draft page in the current org's overlay, with enough detail
 * for a coworker to walk the user through them in chat. Used by the
 * `review-wiki-drafts` skill; safe to call from any authenticated
 * session because it's read-only.
 */
export async function listOverlayDrafts(): Promise<DraftWikiPageSummary[]> {
  await requireUser();
  const org = await requireOrganization();

  const rows = (await prisma.wikiPage.findMany({
    where: {
      organizationId: org.id,
      status: "draft",
    },
    select: {
      id: true,
      slug: true,
      title: true,
      pageKind: true,
      abstract: true,
      body: true,
      kernelPageId: true,
      derivedFromKernelVersion: true,
      sources: {
        select: { source: { select: { sourceKey: true } } },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { slug: "asc" }],
  })) as Array<{
    id: string;
    slug: string;
    title: string;
    pageKind: string;
    abstract: string | null;
    body: string;
    kernelPageId: string | null;
    derivedFromKernelVersion: string | null;
    sources: Array<{ source: { sourceKey: string } }>;
  }>;

  return rows.map((row) => ({
    pageId: row.id,
    slug: row.slug,
    title: row.title,
    pageKind: row.pageKind,
    abstract: row.abstract,
    bodyLength: row.body.length,
    bodyPreview: row.body.slice(0, 800),
    kernelPageId: row.kernelPageId,
    derivedFromKernelVersion: row.derivedFromKernelVersion,
    sourceSlugs: row.sources.map((s) => s.source.sourceKey),
  }));
}
