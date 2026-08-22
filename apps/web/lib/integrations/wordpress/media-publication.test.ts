import { describe, expect, it, vi } from "vitest";

import { WordPressClientError } from "./client";
import { projectWordPressMedia } from "./media-publication";

function db() {
  let row: Record<string, unknown> | null = null;
  return { externalChannelProjection: {
    findUnique: vi.fn(async () => row),
    create: vi.fn(async ({ data }) => (row = data)),
    update: vi.fn(async ({ data }) => (row = { ...row, ...data })),
    updateMany: vi.fn(async () => ({ count: 1 })),
  }, current: () => row };
}

describe("WordPress media publication", () => {
  it("fingerprints, reserves, and uploads approved bounded media with alt/caption evidence", async () => {
    const upsertContent = vi.fn(async () => ({ id: "71", url: "https://wordpress.example/wp-content/uploads/photo.jpg", record: { id: 71, modified_gmt: "2026-08-22T04:00:00" } }));
    const result = await projectWordPressMedia({
      db: db() as never,
      connectionId: "wordpress-self-hosted", credentialId: "cred-1",
      sourceType: "outbound_draft", sourceId: "draft-1", sourceVersion: "v1", locale: "en-US",
      fileName: "photo.jpg", mimeType: "image/jpeg", bytes: new Uint8Array([1, 2, 3]), altText: "Team volunteering", caption: "Community day",
      client: { upsertContent },
    });
    expect(result).toMatchObject({ ok: true, externalId: "71", channelMetadata: { projectionId: expect.stringMatching(/^ecp-/) } });
    expect(upsertContent).toHaveBeenNthCalledWith(1, expect.objectContaining({ resourceKind: "media", externalId: null, fileName: "photo.jpg", contentType: "image/jpeg" }));
    expect(upsertContent).toHaveBeenNthCalledWith(2, expect.objectContaining({ resourceKind: "media", externalId: "71", payload: { alt_text: "Team volunteering", caption: "Community day" } }));
  });

  it("refuses unsupported or oversized media before any remote call", async () => {
    const upsertContent = vi.fn();
    await expect(projectWordPressMedia({
      db: db() as never, connectionId: "wordpress-self-hosted", credentialId: "cred-1",
      sourceType: "outbound_draft", sourceId: "draft-1", sourceVersion: "v1", locale: "en-US",
      fileName: "payload.exe", mimeType: "application/x-msdownload", bytes: new Uint8Array([1]), altText: "", caption: "", client: { upsertContent },
    })).resolves.toMatchObject({ ok: false, error: "unsupported_media_type" });
    await expect(projectWordPressMedia({
      db: db() as never, connectionId: "wordpress-self-hosted", credentialId: "cred-1",
      sourceType: "outbound_draft", sourceId: "draft-1", sourceVersion: "v1", locale: "en-US",
      fileName: `${"x".repeat(256)}.jpg`, mimeType: "image/jpeg", bytes: new Uint8Array([1]), altText: "", caption: "", client: { upsertContent },
    })).resolves.toMatchObject({ ok: false, error: "media_metadata_out_of_bounds" });
    expect(upsertContent).not.toHaveBeenCalled();
  });

  it("binds the attachment before alt/caption update so a partial failure resumes without another upload", async () => {
    const store = db();
    const upsertContent = vi.fn()
      .mockResolvedValueOnce({ id: "71", url: "https://wordpress.example/media/71", record: { id: 71 } })
      .mockRejectedValueOnce(new WordPressClientError("permission_denied", "metadata rejected"))
      .mockResolvedValueOnce({ id: "71", url: "https://wordpress.example/media/71", record: { id: 71 } });
    const input = {
      db: store as never, connectionId: "wordpress-self-hosted", credentialId: "cred-1",
      sourceType: "outbound_draft" as const, sourceId: "draft-1", sourceVersion: "v1", locale: "en-US",
      fileName: "photo.jpg", mimeType: "image/jpeg", bytes: new Uint8Array([1, 2, 3]), altText: "Alt", caption: "Caption", client: { upsertContent },
    };
    await expect(projectWordPressMedia(input)).resolves.toMatchObject({ ok: false, error: "permission_denied" });
    expect(store.current()).toMatchObject({ state: "current", externalRef: "71" });
    await expect(projectWordPressMedia(input)).resolves.toMatchObject({ ok: true, externalId: "71" });
    expect(upsertContent).toHaveBeenCalledTimes(3);
    expect(upsertContent.mock.calls[2]![0]).toMatchObject({ externalId: "71", payload: { alt_text: "Alt", caption: "Caption" } });
  });
});
