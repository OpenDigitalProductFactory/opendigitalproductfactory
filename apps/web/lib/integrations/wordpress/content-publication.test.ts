import { describe, expect, it, vi } from "vitest";

import { buildWordPressProjectionDocument } from "./projection";
import { projectApprovedWordPressContent } from "./content-publication";

describe("structured WordPress content publication", () => {
  it("publishes an immutable versioned product projection through the same binding coordinator", async () => {
    let row: Record<string, unknown> | null = null;
    const db = { externalChannelProjection: {
      findUnique: vi.fn(async () => row), create: vi.fn(async ({ data }) => (row = data)),
      update: vi.fn(async ({ data }) => (row = { ...row, ...data })), updateMany: vi.fn(async () => ({ count: 1 })),
    } };
    const upsertContent = vi.fn(async () => ({ id: "52", url: "https://wordpress.example/products/service", record: { modified_gmt: "2026-08-22T07:00:00" } }));
    const document = buildWordPressProjectionDocument({
      sourceType: "product", sourceId: "PROD-1", sourceVersion: "revision-7", resourceKind: "page", locale: "en-US",
      title: "Managed service", body: "Approved product description", bodyFormat: "plain", metadata: { slug: "managed-service" }, publicPublicationAuthorized: false,
    });
    const result = await projectApprovedWordPressContent({ db: db as never, connectionId: "wordpress-self-hosted", credentialId: "cred-1", document, client: { upsertContent } });
    expect(result).toMatchObject({ ok: true, externalId: "52" });
    expect(upsertContent).toHaveBeenCalledWith(expect.objectContaining({ resourceKind: "page", externalId: null, payload: expect.objectContaining({ status: "draft" }) }));
  });
});
