import { describe, expect, it } from "vitest";

import {
  buildWordPressProjectionDocument,
  fingerprintWordPressProjection,
  fingerprintObservedWordPressResource,
  normalizeObservedWordPressResource,
  serializeWordPressProjection,
} from "./projection";

describe("WordPress projection documents", () => {
  it("serializes an immutable approved outbound draft to a WordPress draft by default", () => {
    const document = buildWordPressProjectionDocument({
      sourceType: "outbound_draft",
      sourceId: "draft-1",
      sourceVersion: "2026-08-22T00:00:00.000Z",
      resourceKind: "post",
      locale: "en-US",
      title: "A governed update",
      body: "<strong>Approved</strong> content",
      bodyFormat: "html",
      metadata: { excerpt: "Short", slug: "governed-update", requestedStatus: "publish" },
      publicPublicationAuthorized: false,
    });
    expect(serializeWordPressProjection(document)).toEqual(expect.objectContaining({
      title: "A governed update",
      content: "<strong>Approved</strong> content",
      excerpt: "Short",
      slug: "governed-update",
      status: "draft",
    }));
  });

  it("has a stable fingerprint and refuses unsupported fields and unsafe live publication", () => {
    const base = {
      sourceType: "outbound_draft" as const,
      sourceId: "draft-1",
      sourceVersion: "v1",
      resourceKind: "page" as const,
      locale: "en-US",
      title: "About",
      body: "Body",
      bodyFormat: "html" as const,
      metadata: {},
      publicPublicationAuthorized: false,
    };
    expect(fingerprintWordPressProjection(buildWordPressProjectionDocument(base)))
      .toBe(fingerprintWordPressProjection(buildWordPressProjectionDocument({ ...base, metadata: {} })));
    expect(() => buildWordPressProjectionDocument({ ...base, metadata: { customFields: { secret: true } } })).toThrow(/unsupported/i);
    expect(() => buildWordPressProjectionDocument({ ...base, bodyFormat: "markdown" })).toThrow(/approved HTML/i);
    expect(() => buildWordPressProjectionDocument({ ...base, metadata: { requestedStatus: "public" } })).toThrow(/requestedStatus/i);
    expect(() => buildWordPressProjectionDocument({ ...base, metadata: { termIds: [3, "9"] } })).toThrow(/termIds/i);
    expect(() => buildWordPressProjectionDocument({ ...base, metadata: { featuredMediaId: -1 } })).toThrow(/featuredMediaId/i);
    expect(() => buildWordPressProjectionDocument({ ...base, publicPublicationAuthorized: true, metadata: { requestedStatus: "publish" } })).not.toThrow();
    expect(() => buildWordPressProjectionDocument({ ...base, publicPublicationAuthorized: true, metadata: { requestedStatus: "future" } })).toThrow(/scheduled/i);
    expect(serializeWordPressProjection(buildWordPressProjectionDocument({ ...base, publicPublicationAuthorized: true, metadata: { requestedStatus: "future", scheduledAt: "2026-08-23T12:00:00.000Z" } })))
      .toMatchObject({ status: "future", date_gmt: "2026-08-23T12:00:00.000Z" });
  });

  it.each(["outbound_draft", "document", "knowledge_article", "product", "product_offering", "catalog_item", "storefront_section", "storefront_item", "marketing_asset"] as const)(
    "uses the same immutable projection contract for %s",
    (sourceType) => {
      const document = buildWordPressProjectionDocument({
        sourceType,
        sourceId: `${sourceType}-1`,
        sourceVersion: "v7",
        resourceKind: "page",
        locale: "en-US",
        title: "Canonical source",
        body: "Approved snapshot",
        bodyFormat: "plain",
        metadata: {},
        publicPublicationAuthorized: false,
      });
      expect(document).toMatchObject({ sourceType, sourceVersion: "v7", status: "draft" });
    },
  );

  it("normalizes WordPress edit-context fields so title/body/slug/term/media/status changes produce drift", () => {
    const remote = {
      title: { raw: "Canonical source", rendered: "Canonical source" },
      content: { raw: "Approved snapshot", rendered: "<p>Approved snapshot</p>" },
      excerpt: { raw: "Short" }, slug: "canonical-source", status: "draft",
      categories: [9, 3], featured_media: 17,
    };
    expect(normalizeObservedWordPressResource(remote)).toEqual({
      title: "Canonical source", content: "Approved snapshot", excerpt: "Short",
      slug: "canonical-source", status: "draft", categories: [3, 9], featured_media: 17,
    });
    const baseline = fingerprintObservedWordPressResource(remote);
    for (const changed of [
      { ...remote, title: { raw: "Changed" } },
      { ...remote, content: { raw: "Changed" } },
      { ...remote, slug: "changed" },
      { ...remote, categories: [3, 10] },
      { ...remote, featured_media: 18 },
      { ...remote, status: "publish" },
    ]) expect(fingerprintObservedWordPressResource(changed)).not.toBe(baseline);
  });
});
