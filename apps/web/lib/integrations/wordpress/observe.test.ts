import { describe, expect, it, vi } from "vitest";

import { observeWordPressProjection } from "./observe";

describe("WordPress drift observation", () => {
  it("marks a binding drifted without importing remote edits into the source", async () => {
    let row = {
      externalChannelProjectionId: "ecp-1", connectorKey: "wordpress-self-hosted", connectionId: "wordpress-self-hosted", credentialId: "cred-1",
      sourceType: "outbound_draft", sourceRef: "draft-1", sourceVersion: "v1", resourceKind: "post", locale: "en-US",
      externalRef: "42", externalUrl: "https://wordpress.example/?p=42", localFingerprint: "sha256:approved", remoteFingerprint: "sha256:approved",
      remoteModifiedAt: null, state: "current", metadata: {}, reservedAt: new Date(), projectedAt: new Date(), observedAt: null, driftedAt: null, detachedAt: null,
      lifecycle: "active", lifecycleAt: null, lifecycleReason: null,
    };
    const findUnique = vi.fn(async () => row);
    const update = vi.fn(async ({ data }) => (row = { ...row, ...data }));
    const db = { externalChannelProjection: { findUnique, update, create: vi.fn(), updateMany: vi.fn() } };
    const result = await observeWordPressProjection({
      db: db as never, projectionId: "ecp-1",
      client: { getContent: vi.fn(async () => ({ record: { title: { raw: "Remote edit" }, content: { raw: "Changed" }, status: "draft" }, modifiedAt: new Date("2026-08-22T06:00:00.000Z") })) },
    });
    expect(result).toMatchObject({ ok: true, data: { projection: { state: "drifted", sourceRef: "draft-1", localFingerprint: "sha256:approved" } } });
  });
});
