import { beforeEach, describe, expect, it, vi } from "vitest";

const saveWikiOverlayEdit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/wiki-edit", () => ({ saveWikiOverlayEdit }));

const organizationFindFirst = vi.hoisted(() => vi.fn());
const mediaAssetFindFirst = vi.hoisted(() => vi.fn());
vi.mock("@dpf/db", () => ({
  prisma: {
    organization: { findFirst: organizationFindFirst },
    mediaAsset: { findFirst: mediaAssetFindFirst },
  },
}));

const attachMedia = vi.hoisted(() => vi.fn());
vi.mock("@/lib/media", () => ({ attachMedia }));

import { captureCritiqueEntry } from "./critique-entry";
import { CRITIQUE_ENTRY_METADATA_KIND } from "@/lib/ux-critique/critique-entry";

const GOOD_FINDING = "Lead band carries 240 words before the owner's next action appears.";

beforeEach(() => {
  saveWikiOverlayEdit.mockReset();
  saveWikiOverlayEdit.mockResolvedValue({
    ok: true,
    pageId: "p1",
    slug: "craft/ux-design/workspace-lead-band",
    status: "draft",
  });
  organizationFindFirst.mockReset().mockResolvedValue({ id: "org1" });
  mediaAssetFindFirst.mockReset().mockResolvedValue({ id: "asset1" });
  attachMedia.mockReset().mockResolvedValue("attach1");
});

describe("captureCritiqueEntry", () => {
  it("writes a draft craft-override page with the critique fields in metadata", async () => {
    const result = await captureCritiqueEntry({
      title: "Workspace lead band",
      callerKind: "human",
      route: "/workspace",
      finding: GOOD_FINDING,
      screenshotRef: "capture/workspace.png",
      verdict: "change-needed",
      verdictAuthority: "founder",
    });

    expect(result.ok).toBe(true);
    const arg = saveWikiOverlayEdit.mock.calls[0]![0];
    expect(arg.status).toBe("draft"); // never born published
    expect(arg.slug).toMatch(/^craft\/ux-design\//);
    expect(arg.body).toBe(GOOD_FINDING);
    expect(arg.metadata.metadataKind).toBe(CRITIQUE_ENTRY_METADATA_KIND);
    expect(arg.metadata.route).toBe("/workspace");
    expect(arg.metadata.verdictAuthority).toBe("founder");
  });

  it("forces draft status even when the caller asks for published", async () => {
    // Publishing is the human's separate act; capture never shortcuts it.
    await captureCritiqueEntry({
      title: "Anything",
      callerKind: "human",
      route: "/finance",
      finding: GOOD_FINDING,
      status: "published",
    });
    expect(saveWikiOverlayEdit.mock.calls[0]![0].status).toBe("draft");
  });

  it("lets an agent PROPOSE a verdict", async () => {
    const result = await captureCritiqueEntry({
      title: "Agent draft",
      callerKind: "agent",
      route: "/customer",
      finding: GOOD_FINDING,
      verdict: "change-needed",
      verdictAuthority: "agent-proposed",
    });
    expect(result.ok).toBe(true);
    expect(saveWikiOverlayEdit.mock.calls[0]![0].metadata.verdictAuthority).toBe("agent-proposed");
  });

  it("REFUSES to let an agent attach a founder verdict", async () => {
    // The load-bearing boundary: a judge calibrated on agent-authored verdicts
    // is calibrated against itself.
    const result = await captureCritiqueEntry({
      title: "Agent overreach",
      callerKind: "agent",
      route: "/customer",
      finding: GOOD_FINDING,
      verdict: "change-needed",
      verdictAuthority: "founder",
    });
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/agent may only propose/i),
    });
    expect(saveWikiOverlayEdit).not.toHaveBeenCalled();
  });

  it("refuses an impression instead of an observation", async () => {
    const result = await captureCritiqueEntry({
      title: "Vague",
      callerKind: "human",
      route: "/workspace",
      finding: "feels cluttered",
    });
    expect(result.ok).toBe(false);
    expect(saveWikiOverlayEdit).not.toHaveBeenCalled();
  });

  it("requires a title", async () => {
    const result = await captureCritiqueEntry({
      title: "",
      callerKind: "human",
      route: "/workspace",
      finding: GOOD_FINDING,
    });
    expect(result.ok).toBe(false);
    expect(saveWikiOverlayEdit).not.toHaveBeenCalled();
  });

  it("surfaces a store failure rather than claiming success", async () => {
    saveWikiOverlayEdit.mockResolvedValue({ ok: false, error: "org missing" });
    const result = await captureCritiqueEntry({
      title: "Workspace",
      callerKind: "human",
      route: "/workspace",
      finding: GOOD_FINDING,
    });
    expect(result).toEqual({ ok: false, error: "org missing" });
  });

  describe("uploaded screenshot", () => {
    it("points screenshotRef at the session-gated URL and anchors the asset to the page", async () => {
      const result = await captureCritiqueEntry({
        title: "Admin panel density",
        callerKind: "human",
        route: "/admin",
        finding: GOOD_FINDING,
        screenshotAssetId: "asset1",
      });

      expect(result).toMatchObject({ ok: true, screenshotAttached: true });
      // Never the public /api/media path — a critique of /admin must not be
      // servable by capability URL.
      const arg = saveWikiOverlayEdit.mock.calls[0]![0];
      expect(arg.metadata.screenshotRef).toBe("/api/critique-media/asset1");
      expect(attachMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org1",
          mediaAssetId: "asset1",
          ownerType: "WikiPage",
          ownerId: "p1",
          role: "critique-screenshot",
        }),
      );
    });

    it("rejects a screenshot asset id that is not in the org (no page written)", async () => {
      mediaAssetFindFirst.mockResolvedValue(null);
      const result = await captureCritiqueEntry({
        title: "Forged ref",
        callerKind: "human",
        route: "/admin",
        finding: GOOD_FINDING,
        screenshotAssetId: "not-mine",
      });
      expect(result.ok).toBe(false);
      expect(saveWikiOverlayEdit).not.toHaveBeenCalled();
      expect(attachMedia).not.toHaveBeenCalled();
    });

    it("still captures the entry when the attach fails, flagging it for re-attach", async () => {
      attachMedia.mockRejectedValue(new Error("attach exploded"));
      const result = await captureCritiqueEntry({
        title: "Attach fails",
        callerKind: "human",
        route: "/admin",
        finding: GOOD_FINDING,
        screenshotAssetId: "asset1",
      });
      // The finding is the primary artifact — a failed image anchor does not
      // discard it, but the caller learns the image needs re-attaching.
      expect(result).toMatchObject({ ok: true, screenshotAttached: false });
      expect(saveWikiOverlayEdit).toHaveBeenCalled();
    });
  });
});
