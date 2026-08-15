import { afterEach, describe, expect, it, vi } from "vitest";

// BI-D4C1E05E — proof the shared embed seam embeds published overlay pages and,
// crucially, that a failed embed is a LOUD, non-silent, non-throwing result (the
// silent try/catch swallow is the bug this closes).

const storeWikiPage = vi.fn();
const isEmbeddingAvailable = vi.fn();

vi.mock("@/lib/wiki/embeddings", () => ({
  storeWikiPage: (...args: unknown[]) => storeWikiPage(...args),
}));
vi.mock("@/lib/inference/embedding", () => ({
  isEmbeddingAvailable: (...args: unknown[]) => isEmbeddingAvailable(...args),
}));

import { embedPublishedOverlayPage } from "./embed-published-overlay";

const PAGE = {
  id: "p1",
  slug: "stances/how-do-we-manage-the-business",
  title: "How we manage the business",
  body: "Continued, recurring use is the goal.",
  abstract: "recurring use",
  pageKind: "stance",
};

afterEach(() => vi.clearAllMocks());

describe("embedPublishedOverlayPage (BI-D4C1E05E)", () => {
  it("embeds a published page with the right payload when the provider is warm", async () => {
    storeWikiPage.mockResolvedValue(true);
    const out = await embedPublishedOverlayPage({
      page: PAGE,
      organizationId: "org1",
      origin: "wiki-edit",
    });
    expect(out).toEqual({ embedded: true, slug: PAGE.slug });
    expect(storeWikiPage).toHaveBeenCalledTimes(1);
    expect(storeWikiPage).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: "p1",
        slug: PAGE.slug,
        status: "published",
        isKernel: false,
        organizationId: "org1",
        kernelPageId: null,
      }),
    );
    expect(isEmbeddingAvailable).not.toHaveBeenCalled(); // no warm probe needed on success
  });

  it("warms then retries once when the first embed returns false and the provider comes up", async () => {
    storeWikiPage.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    isEmbeddingAvailable.mockResolvedValue(true);
    const out = await embedPublishedOverlayPage({
      page: PAGE,
      organizationId: "org1",
      origin: "wiki-edit",
    });
    expect(out).toEqual({ embedded: true, slug: PAGE.slug });
    expect(storeWikiPage).toHaveBeenCalledTimes(2); // idle-evict warm-then-retry
    expect(isEmbeddingAvailable).toHaveBeenCalledTimes(1);
  });

  it("returns a LOUD, non-silent skip (never throws) when the provider stays down", async () => {
    storeWikiPage.mockResolvedValue(false);
    isEmbeddingAvailable.mockResolvedValue(false);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await embedPublishedOverlayPage({
      page: PAGE,
      organizationId: "org1",
      origin: "wiki-edit",
    });
    expect(out).toEqual({ embedded: false, slug: PAGE.slug, reason: "provider-unavailable" });
    expect(storeWikiPage).toHaveBeenCalledTimes(1); // no retry when the probe says still down
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("EMBED-SKIPPED"));
    errSpy.mockRestore();
  });

  it("turns a storeWikiPage throw into a loud error result, never rethrows", async () => {
    storeWikiPage.mockRejectedValue(new Error("vector store down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await embedPublishedOverlayPage({
      page: PAGE,
      organizationId: "org1",
      origin: "wiki-publish",
    });
    expect(out).toEqual({ embedded: false, slug: PAGE.slug, reason: "error" });
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("EMBED-FAILED"));
    errSpy.mockRestore();
  });
});
