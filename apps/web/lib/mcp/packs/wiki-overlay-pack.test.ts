import { beforeEach, describe, expect, it, vi } from "vitest";

const wikiPublish = vi.hoisted(() => ({
  listOverlayDrafts: vi.fn(),
  publishWikiOverlayPages: vi.fn(),
}));
vi.mock("@/lib/actions/wiki-publish", () => wikiPublish);

import { wikiOverlayPack } from "./wiki-overlay-pack";
import { TOOL_TO_GRANTS, isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = ["list_wiki_overlay_drafts", "publish_wiki_overlay_pages"];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("wiki-overlay pack — registration", () => {
  it("exposes exactly the two overlay-draft lifecycle tools with handlers", () => {
    expect(wikiOverlayPack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(wikiOverlayPack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
    for (const name of EXPECTED_TOOLS) {
      expect(wikiOverlayPack.handlers[name]).toBeTypeOf("function");
    }
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of wikiOverlayPack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("preserves gating shape: list is read-only immediate, publish is a side-effecting proposal", () => {
    const byName = Object.fromEntries(wikiOverlayPack.definitions.map((d) => [d.name, d]));
    expect(byName.list_wiki_overlay_drafts.requiredCapability).toBeNull();
    expect(byName.list_wiki_overlay_drafts.executionMode).toBe("immediate");
    expect(byName.list_wiki_overlay_drafts.sideEffect).toBe(false);
    expect(byName.list_wiki_overlay_drafts.annotations?.readOnlyHint).toBe(true);
    expect(byName.publish_wiki_overlay_pages.requiredCapability).toBeNull();
    expect(byName.publish_wiki_overlay_pages.executionMode).toBe("proposal");
    expect(byName.publish_wiki_overlay_pages.sideEffect).toBe(true);
    expect(byName.publish_wiki_overlay_pages.annotations?.readOnlyHint).toBe(false);
  });

  it("mirrors the agent-grant gating source exactly (R3 no-drift)", () => {
    for (const [name, grants] of Object.entries(wikiOverlayPack.grants)) {
      expect(TOOL_TO_GRANTS[name], name).toEqual(grants);
    }
    expect(wikiOverlayPack.grants.list_wiki_overlay_drafts).toEqual(["registry_read"]);
    expect(wikiOverlayPack.grants.publish_wiki_overlay_pages).toEqual(["registry_write"]);
    expect(isToolAllowedByGrants("list_wiki_overlay_drafts", ["registry_read"])).toBe(true);
    expect(isToolAllowedByGrants("list_wiki_overlay_drafts", ["registry_write"])).toBe(false);
    expect(isToolAllowedByGrants("publish_wiki_overlay_pages", ["registry_write"])).toBe(true);
    expect(isToolAllowedByGrants("publish_wiki_overlay_pages", ["registry_read"])).toBe(false);
  });
});

describe("wiki-overlay pack — handler behavior (delegation preserved)", () => {
  it("list_wiki_overlay_drafts reports the empty-overlay case", async () => {
    wikiPublish.listOverlayDrafts.mockResolvedValue([]);
    const res = await wikiOverlayPack.handlers.list_wiki_overlay_drafts({}, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toBe("No pending drafts in this org's overlay.");
    expect((res.data as { drafts: unknown[] }).drafts).toEqual([]);
  });

  it("list_wiki_overlay_drafts summarizes drafts with kernel-override and citation tags", async () => {
    wikiPublish.listOverlayDrafts.mockResolvedValue([
      {
        slug: "stance-a",
        pageKind: "stance",
        bodyLength: 1200,
        kernelPageId: "K-1",
        sourceSlugs: ["src-1", "src-2", "src-3"],
      },
    ]);
    const res = await wikiOverlayPack.handlers.list_wiki_overlay_drafts({}, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toContain("1 draft(s) pending:");
    expect(res.message).toContain("stance-a (stance, 1200 bytes");
    expect(res.message).toContain("overrides kernel");
    expect(res.message).toContain("cites src-1, src-2, +1");
  });

  it("list_wiki_overlay_drafts surfaces service errors in both message and error", async () => {
    wikiPublish.listOverlayDrafts.mockRejectedValue(new Error("boom"));
    const res = await wikiOverlayPack.handlers.list_wiki_overlay_drafts({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("boom");
    expect(res.message).toContain("list_wiki_overlay_drafts failed: boom");
  });

  it("publish_wiki_overlay_pages rejects an empty pageIds array without calling the service", async () => {
    const res = await wikiOverlayPack.handlers.publish_wiki_overlay_pages({ pageIds: [] }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("Empty pageIds");
    expect(wikiPublish.publishWikiOverlayPages).not.toHaveBeenCalled();
  });

  it("publish_wiki_overlay_pages coerces ids, defaults status to published, and forwards changeSummary", async () => {
    wikiPublish.publishWikiOverlayPages.mockResolvedValue({
      ok: true,
      published: [{ slug: "p-1" }, { slug: "p-2" }],
      rejected: [],
    });
    const res = await wikiOverlayPack.handlers.publish_wiki_overlay_pages(
      { pageIds: ["a", 2], changeSummary: "batch review" },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(res.message).toBe("Published 2: p-1, p-2");
    expect(wikiPublish.publishWikiOverlayPages).toHaveBeenCalledWith({
      pageIds: ["a", "2"],
      targetStatus: "published",
      changeSummary: "batch review",
    });
  });

  it("publish_wiki_overlay_pages honors a valid targetStatus and tallies rejected reasons", async () => {
    wikiPublish.publishWikiOverlayPages.mockResolvedValue({
      ok: true,
      published: [{ slug: "p-1" }],
      rejected: [{ reason: "kernel" }, { reason: "kernel" }, { reason: "missing" }],
    });
    const res = await wikiOverlayPack.handlers.publish_wiki_overlay_pages(
      { pageIds: ["a"], targetStatus: "archived" },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(res.message).toContain("Published 1: p-1");
    expect(res.message).toContain("Rejected 3 (kernel=2, missing=1)");
    expect(wikiPublish.publishWikiOverlayPages).toHaveBeenCalledWith(
      expect.objectContaining({ targetStatus: "archived" }),
    );
  });

  it("publish_wiki_overlay_pages returns the service error envelope when the batch is not ok", async () => {
    wikiPublish.publishWikiOverlayPages.mockResolvedValue({ ok: false, error: "no overlay" });
    const res = await wikiOverlayPack.handlers.publish_wiki_overlay_pages({ pageIds: ["a"] }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("no overlay");
    expect(res.message).toBe("no overlay");
  });
});
