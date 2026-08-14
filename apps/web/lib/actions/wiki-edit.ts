"use server";
// EP-WIKI-001 Phase 6b: server actions for editing wiki overlay pages.
// Spec: docs/superpowers/specs/2026-05-09-platform-kernel-wiki-design.md §4
// Plan: docs/superpowers/plans/2026-05-09-platform-kernel-wiki.md (Phase 6b)
//
// Editing rules per spec §4 (Edit Policy):
//   - Kernel pages (organizationId = NULL, isKernel = true) are PR-only.
//     Runtime can NEVER write to them. saveWikiOverlayEdit refuses.
//   - Org overlay pages can be edited at runtime. The edit either updates
//     an existing overlay row (when one exists at this slug) OR creates a
//     new overlay row that overrides a kernel page (kernelPageId set,
//     derivedFromKernelVersion stamped from current kernel manifest).
//
// Each save appends a `WikiPageRevision` with changeKind = "manual" so the
// revision history records authorship. Wikilinks in the new body are
// resolved to other pages in the same scope (overlay first, kernel
// fallback) and upserted as `WikiPageLink` edges.

import { prisma } from "@dpf/db";
import {
  appendRevision,
  getWikiPage,
  linkPages,
  upsertWikiPage,
  type UpsertWikiPageInput,
  type WikiPageKind,
  type WikiPageStatus,
} from "@dpf/db/wiki-store";
import { extractWikilinks } from "@dpf/db/wiki-frontmatter";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/actions/shared/guards";
import { promoteCraftOverrideOnPublish } from "@/lib/wiki/craft-override-promotion";

// ─── Types ──────────────────────────────────────────────────────────────────

export type SaveWikiOverlayEditInput = {
  /** Target slug, e.g. "principles/do-the-work-dont-task-the-operator". */
  slug: string;
  /** Page kind. Required when creating a new overlay row; ignored on update. */
  pageKind: WikiPageKind;
  title: string;
  body: string;
  status?: WikiPageStatus;
  abstract?: string | null;
  /**
   * When editing an existing overlay, pass the page id. The action will
   * verify (organizationId, id) match before writing. When creating a new
   * overlay (e.g. overriding a kernel page), leave undefined.
   */
  pageId?: string;
  /**
   * When creating a NEW overlay that overrides a kernel page, pass the
   * kernel page id. The new row will set kernelPageId + derivedFromKernelVersion
   * so kernel-drift lint can track the relationship.
   */
  overridesKernelPageId?: string;
  /** Optional short description of the change for the revision log. */
  changeSummary?: string;
  /**
   * Free-form frontmatter merged into the WikiPage.metadata Json column — the
   * same bag the WSID variant axes and the UX critique-entry fields use. Passed
   * straight through to the store, which does not validate shape (callers own
   * that). Omitted = column left untouched on update.
   */
  metadata?: Record<string, unknown> | null;
  /** Closed-axis projection for stance pages; carries evidence, never authority. */
  principleDimensionVector?: Record<string, number>;
  principleDimensions?: string[];
};

export type SaveWikiOverlayEditResult =
  | { ok: true; pageId: string; slug: string; status: WikiPageStatus }
  | { ok: false; error: string };

// ─── Helpers ────────────────────────────────────────────────────────────────

async function requireOrganization(): Promise<{ id: string }> {
  // DPF runs single-org installs today — see (shell)/layout.tsx for the
  // same pattern used by the viewer route. When multi-org lands, the
  // caller will pass an explicit organizationId from the route context.
  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) {
    throw new Error(
      "saveWikiOverlayEdit: no Organization row present — wiki edits need an org context.",
    );
  }
  return { id: org.id };
}

/**
 * Sync the wikilink graph for a freshly-saved page. Each `[[slug]]` token
 * that resolves to a real page in the same scope (overlay first, kernel
 * fallback) becomes a WikiPageLink edge. Dangling references are not
 * upserted — the lint detector flags them on the published path.
 *
 * Source citations (`[[raw-sources/...]]`) are skipped: they live on the
 * `WikiPageSource` join table and are managed by the proposal/commit step
 * (Phase 2.3), not by manual edits. Manual edits to source citations
 * happen via the page's `sources:` frontmatter — out of scope for v1 edit.
 */
async function syncOutLinks(
  fromPageId: string,
  body: string,
  organizationId: string,
): Promise<void> {
  const slugs = extractWikilinks(body).filter(
    (s) => !s.startsWith("raw-sources/"),
  );
  if (slugs.length === 0) return;
  for (const slug of slugs) {
    const target = (await getWikiPage(prisma, {
      organizationId,
      slug,
    })) as { id: string } | null;
    if (target && target.id !== fromPageId) {
      await linkPages(prisma, { fromPageId, toPageId: target.id });
    }
  }
}

function readKernelVersionFromManifest(): string | null {
  // The seed-wiki-kernel module already reads the manifest at __dirname-
  // relative path during seeding; we re-read at edit time so the
  // derivedFromKernelVersion stamp tracks the running install rather than
  // a build-time constant. Best-effort: a missing manifest produces null
  // and the override row carries no version stamp (lint still works on
  // paragraph-hash diff alone, just with weaker confidence).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require("node:path");
    const path = join(
      process.cwd(),
      "docs",
      "founder-kernel",
      "manifest.json",
    );
    const raw = readFileSync(path, "utf8") as string;
    const parsed = JSON.parse(raw) as { kernelVersion?: string };
    return parsed.kernelVersion ?? null;
  } catch {
    return null;
  }
}

// ─── Main action ────────────────────────────────────────────────────────────

/**
 * Save an edit to a wiki overlay page. Refuses kernel writes — kernel
 * pages are PR-only per spec §4.
 *
 * Three paths:
 *   1. Update existing overlay (pageId supplied + row exists, isKernel=false,
 *      organizationId matches the session's org).
 *   2. Create new overlay row (pageId not supplied, no existing row at
 *      (organizationId, slug); body lands as a fresh org-original).
 *   3. Create overlay that overrides a kernel page (pageId not supplied,
 *      overridesKernelPageId supplied; new row stamps kernelPageId +
 *      derivedFromKernelVersion).
 */
export async function saveWikiOverlayEdit(
  input: SaveWikiOverlayEditInput,
): Promise<SaveWikiOverlayEditResult> {
  try {
    const user = await requireUser();
    const org = await requireOrganization();

    // Reject empty body / missing title at the action boundary so the form
    // gets a typed error rather than relying on a Prisma null-constraint
    // throw.
    if (!input.title?.trim()) {
      return { ok: false, error: "Title is required." };
    }
    if (!input.body?.trim()) {
      return { ok: false, error: "Body is required." };
    }

    // Status this page held BEFORE this save, so a draft -> published
    // transition can be detected below (BI-8AC24F3D). Null when creating a new
    // row, which counts as "was not published".
    let previousStatus: WikiPageStatus | null = null;

    // If pageId supplied: load + verify scope.
    if (input.pageId) {
      const existing = (await prisma.wikiPage.findFirst({
        where: { id: input.pageId },
        select: {
          id: true,
          slug: true,
          isKernel: true,
          organizationId: true,
          pageKind: true,
          status: true,
        },
      })) as
        | {
            id: string;
            slug: string;
            isKernel: boolean;
            organizationId: string | null;
            pageKind: string;
            status: WikiPageStatus;
          }
        | null;
      if (!existing) {
        return { ok: false, error: `Page ${input.pageId} not found.` };
      }
      if (existing.isKernel || existing.organizationId === null) {
        return {
          ok: false,
          error:
            "Kernel pages are PR-only — open a PR against docs/founder-kernel/ to change a kernel page, or create an org override.",
        };
      }
      if (existing.organizationId !== org.id) {
        return {
          ok: false,
          error: "Page belongs to a different organization.",
        };
      }
      if (existing.slug !== input.slug) {
        // Slug changes require migration logic (moving inbound links).
        // V1: refuse — the editor UI hides the slug field.
        return {
          ok: false,
          error:
            "Slug changes are not supported in the v1 editor — delete and recreate, or open a PR.",
        };
      }
      previousStatus = existing.status;
    } else if (input.overridesKernelPageId) {
      // Creating a new overlay that overrides a kernel page.
      const kernel = (await prisma.wikiPage.findFirst({
        where: { id: input.overridesKernelPageId, isKernel: true },
        select: { id: true, slug: true },
      })) as { id: string; slug: string } | null;
      if (!kernel) {
        return {
          ok: false,
          error: "Kernel page to override not found.",
        };
      }
      if (kernel.slug !== input.slug) {
        return {
          ok: false,
          error: "Override slug must match the kernel page slug.",
        };
      }
    }

    const upsertInput: UpsertWikiPageInput = {
      organizationId: org.id,
      slug: input.slug,
      title: input.title.trim(),
      body: input.body,
      pageKind: input.pageKind,
      status: input.status ?? "draft",
      isKernel: false,
      abstract: input.abstract ?? null,
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      ...(input.principleDimensionVector !== undefined
        ? { principleDimensionVector: input.principleDimensionVector }
        : {}),
      ...(input.principleDimensions !== undefined
        ? { principleDimensions: input.principleDimensions }
        : {}),
      kernelPageId: input.overridesKernelPageId ?? null,
      derivedFromKernelVersion: input.overridesKernelPageId
        ? readKernelVersionFromManifest()
        : null,
    };

    const saved = (await upsertWikiPage(prisma, upsertInput)) as {
      id: string;
      slug: string;
      status: WikiPageStatus;
    };

    await appendRevision(prisma, {
      pageId: saved.id,
      title: input.title.trim(),
      body: input.body,
      changeKind: "manual",
      changeSummary: input.changeSummary ?? "Manual edit via /coworker-decisions/<slug>/edit",
      createdById: user.id,
    });

    await syncOutLinks(saved.id, input.body, org.id);

    // BI-8AC24F3D: this action is what the portal Edit page calls, so flipping
    // Status to `published` here IS how an operator publishes a craft override.
    // Until this hook existed the flip wrote status and nothing else — the page
    // went live, no PerspectiveMaterial was written, and the profession gate
    // kept deferring while the UI claimed the doctrine now counted. Same shared
    // helper as publishWikiOverlayPages so the two paths cannot diverge.
    // Guarded on the TRANSITION, not on the target status, so re-saving an
    // already-published page does not re-promote on every keystroke-level edit.
    if (saved.status === "published" && previousStatus !== "published") {
      await promoteCraftOverrideOnPublish({
        db: prisma,
        page: {
          id: saved.id,
          slug: saved.slug,
          title: input.title.trim(),
          pageKind: input.pageKind,
          abstract: input.abstract ?? null,
        },
        origin: "wiki-edit",
      });
    }

    revalidatePath(`/coworker-decisions/${input.slug}`);
    revalidatePath("/coworker-decisions");

    return {
      ok: true,
      pageId: saved.id,
      slug: saved.slug,
      status: saved.status,
    };
  } catch (err) {
    return {
      ok: false,
      error: (err as Error).message ?? "Unknown error saving page.",
    };
  }
}
