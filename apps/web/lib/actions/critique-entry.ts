"use server";
// EP-UX-SYSTEM L6 (BI-3880DA1D): the capture door for the UX critique corpus.
//
// The corpus module (lib/ux-critique/critique-entry.ts) defines the entry shape
// and the calibration-eligibility contract; this action is how an entry
// actually gets into the store. It is deliberately thin and rides the existing
// craft-override path: a critique entry is a craft-override WikiPage under
// `craft/ux-design/<slug>` whose structured fields live in WikiPage.metadata,
// exactly as the WSID variant axes do. It creates NO new store.
//
// The authority contract is preserved here, not just described:
//   - Every captured entry lands as a DRAFT. Publishing (the human's act) is a
//     separate step through the existing wiki-overlay path, and the calibration
//     set derives eligibility from published + founder-verdict anyway.
//   - An agent caller may NOT attach a founder/designer verdict. It may propose
//     one (verdictAuthority "agent-proposed"), which is never calibration-
//     eligible. A judge calibrated on agent-authored verdicts is calibrated
//     against itself.

import { prisma } from "@dpf/db";
import { saveWikiOverlayEdit } from "@/lib/actions/wiki-edit";
import { buildCraftOverrideSlug } from "@/lib/wiki/craft-override";
import { attachMedia } from "@/lib/media";
import {
  critiqueEntryToMetadata,
  critiqueScreenshotUrl,
  validateCritiqueEntry,
  CRITIQUE_SCREENSHOT_ROLE,
  type CritiqueEntry,
} from "@/lib/ux-critique/critique-entry";

/** The profession corpus critique entries belong to. */
const CRITIQUE_PROFESSION_KEY = "ux-design";

export type CaptureCritiqueEntryInput = {
  /** A short title for the entry — becomes the page title and its slug. */
  title: string;
  /**
   * Who is capturing this. An agent caller is confined to proposing a verdict;
   * only a human caller may pass a founder/designer verdict. The route layer
   * sets this from the authenticated principal, never the client.
   */
  callerKind: "human" | "agent";
  /**
   * A MediaAsset id for an already-uploaded screenshot (from POST /api/media).
   * When present it takes precedence over any raw `screenshotRef`: the asset is
   * attached to this entry's WikiPage and `screenshotRef` is set to the
   * session-gated retrieval URL. This is how the founder-facing form supplies a
   * real, durable image rather than a hand-typed string.
   */
  screenshotAssetId?: string | null;
} & Partial<CritiqueEntry>;

export type CaptureCritiqueEntryResult =
  | {
      ok: true;
      slug: string;
      status: string;
      /**
       * Present only when a screenshot was supplied. `false` means the entry
       * was captured but the image could not be anchored to its page and needs
       * re-attaching; the finding itself is safely stored either way.
       */
      screenshotAttached?: boolean;
    }
  | { ok: false; error: string };

export async function captureCritiqueEntry(
  input: CaptureCritiqueEntryInput,
): Promise<CaptureCritiqueEntryResult> {
  const title = input.title?.trim() ?? "";
  if (title.length < 3) {
    return { ok: false, error: "Give the entry a short title (at least 3 characters)." };
  }

  // Enforce the authority boundary BEFORE validation so the rejection names the
  // real reason rather than a downstream shape error.
  if (
    input.callerKind === "agent" &&
    input.verdict &&
    input.verdictAuthority !== "agent-proposed"
  ) {
    return {
      ok: false,
      error:
        "An agent may only propose a verdict (verdictAuthority 'agent-proposed'); attaching a founder or designer verdict is a human act.",
    };
  }

  // An uploaded screenshot (a MediaAsset id from POST /api/media) becomes the
  // entry's durable image. Verify it belongs to this org before trusting the
  // client-supplied id, then repoint screenshotRef at the session-gated URL so
  // the raw string can never leak the public /api/media path.
  let screenshotAssetId: string | null = null;
  let orgId: string | null = null;
  let effectiveInput: CaptureCritiqueEntryInput = input;
  if (input.screenshotAssetId) {
    const org = await prisma.organization.findFirst({ select: { id: true } });
    const asset = org
      ? await prisma.mediaAsset.findFirst({
          where: { id: input.screenshotAssetId, organizationId: org.id, kind: "image" },
          select: { id: true },
        })
      : null;
    if (!org || !asset) {
      return {
        ok: false,
        error: "That screenshot upload was not found — re-attach the image and try again.",
      };
    }
    orgId = org.id;
    screenshotAssetId = asset.id;
    effectiveInput = { ...input, screenshotRef: critiqueScreenshotUrl(asset.id) };
  }

  const validated = validateCritiqueEntry(effectiveInput);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  // Every captured entry is a draft. Publishing is the human's separate act, and
  // eligibility is derived from published + founder-verdict downstream — so even
  // a human-verdicted capture does not become calibration data until published.
  const entry: CritiqueEntry = { ...validated.entry, status: "draft" };

  const result = await saveWikiOverlayEdit({
    slug: buildCraftOverrideSlug(CRITIQUE_PROFESSION_KEY, title),
    pageKind: "heuristic",
    title,
    body: entry.finding,
    status: "draft",
    abstract: `UX critique of ${entry.route}`,
    metadata: critiqueEntryToMetadata(entry),
    changeSummary: `UX critique entry captured for ${entry.route}`,
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  // Anchor the screenshot to the freshly-created page. screenshotRef already
  // points here; this attachment is the durability anchor AND the scope the
  // serve route checks, so it must exist for the image to be released. Do it
  // after we have the pageId. The finding is the primary artifact, so an attach
  // failure is surfaced rather than fatal — the entry is still captured.
  if (screenshotAssetId && orgId) {
    try {
      await attachMedia({
        organizationId: orgId,
        mediaAssetId: screenshotAssetId,
        ownerType: "WikiPage",
        ownerId: result.pageId,
        role: CRITIQUE_SCREENSHOT_ROLE,
      });
    } catch {
      return {
        ok: true,
        slug: result.slug,
        status: result.status,
        screenshotAttached: false,
      };
    }
  }

  return {
    ok: true,
    slug: result.slug,
    status: result.status,
    ...(screenshotAssetId ? { screenshotAttached: true } : {}),
  };
}
