import { describe, expect, it, vi } from "vitest";

import { compareWordPressCursor, stageWordPressDiscovery, syncWordPressReadModels } from "./sync";

describe("WordPress incremental read sync", () => {
  it("stages discovered core and custom types/taxonomies as read-only evidence", () => {
    const records = stageWordPressDiscovery({
      siteName: "Acme", origin: "https://wordpress.example", authenticatedUser: { id: 7, name: "Publisher" },
      supportedResourceKinds: ["post", "page", "media"], supportedTaxonomies: ["category", "post_tag"], unsupportedResourceTypes: ["book"],
      canCreateDrafts: true, canPublishLive: false, canUploadMedia: true,
    });
    expect(records.map((record) => `${record.entityFamily}:${record.externalId}`)).toEqual([
      "wordpress-type:post", "wordpress-type:page", "wordpress-type:media", "wordpress-type:book", "wordpress-taxonomy:category", "wordpress-taxonomy:post_tag",
    ]);
    expect(records.every((record) => record.readOnly && record.ownerSide === "external")).toBe(true);
  });

  it("orders equal timestamps by id and resumes without loss or duplication", async () => {
    expect(compareWordPressCursor({ modifiedGmt: "2026-08-22T00:00:00", id: 11 }, { modifiedGmt: "2026-08-22T00:00:00", id: 10 })).toBeGreaterThan(0);
    const list = vi.fn()
      .mockResolvedValueOnce({ records: [
        { id: 10, modified_gmt: "2026-08-22T00:00:00", slug: "a", status: "publish", title: { rendered: "A" } },
        { id: 11, modified_gmt: "2026-08-22T00:00:00", slug: "b", status: "draft", title: { rendered: "B" } },
      ], totalPages: 2 })
      .mockResolvedValueOnce({ records: [
        { id: 11, modified_gmt: "2026-08-22T00:00:00", slug: "b", status: "draft", title: { rendered: "B" } },
        { id: 12, modified_gmt: "2026-08-22T00:00:01", slug: "c", status: "publish", title: { rendered: "C" } },
      ], totalPages: 2 });
    const result = await syncWordPressReadModels({ list, kinds: ["post"], pageSize: 2, maxPages: 3 });
    expect(result.records.map((record) => record.externalId)).toEqual(["10", "11", "12"]);
    expect(result.checkpoints.post).toEqual({ modifiedGmt: "2026-08-22T00:00:01", id: 12 });
    expect(result.records.every((record) => record.readOnly && record.ownerSide === "external")).toBe(true);
  });

  it("does not advance past an interrupted page and reports truncation honestly", async () => {
    const list = vi.fn(async () => ({ records: [{ id: 20, modified_gmt: "2026-08-22T01:00:00", slug: "x", status: "publish", title: { rendered: "X" } }], totalPages: 5 }));
    const result = await syncWordPressReadModels({ list, kinds: ["page"], pageSize: 1, maxPages: 1 });
    expect(result.truncated).toBe(true);
    expect(result.checkpoints.page).toEqual({ modifiedGmt: "2026-08-22T01:00:00", id: 20 });
  });

  it("keeps independent cursors per resource family and overlaps reads before filtering", async () => {
    const list = vi.fn(async (kind: "post" | "page" | "media", _input: { page: number; pageSize: number; modifiedAfter?: string | null }) => ({
      records: kind === "post"
        ? [{ id: 101, modified_gmt: "2026-08-22T03:00:01", title: { rendered: "New post" } }]
        : [{ id: 51, modified_gmt: "2026-08-22T02:00:01", title: { rendered: "New page" } }],
      totalPages: 1,
    }));
    const result = await syncWordPressReadModels({
      list,
      kinds: ["post", "page"],
      checkpoints: {
        post: { modifiedGmt: "2026-08-22T03:00:00", id: 100 },
        page: { modifiedGmt: "2026-08-22T02:00:00", id: 50 },
      },
    });
    expect(result.records.map((record) => record.externalId)).toEqual(["51", "101"]);
    expect(list.mock.calls[0]![1].modifiedAfter).toBe("2026-08-22T02:55:00");
    expect(list.mock.calls[1]![1].modifiedAfter).toBe("2026-08-22T01:55:00");
  });
});
