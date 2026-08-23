import { describe, expect, it, vi } from "vitest";

import { executeProjectedPublication } from "./external-channel-publication";

function store() {
  let row: Record<string, unknown> | null = null;
  return {
    externalChannelProjection: {
      findUnique: vi.fn(async () => row),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => (row = data)),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => (row = { ...row, ...data })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    current: () => row,
  };
}

const intent = {
  connectorKey: "wordpress-self-hosted", connectionId: "wordpress-self-hosted", credentialId: "cred-1",
  sourceType: "outbound_draft" as const, sourceId: "draft-1", sourceVersion: "v1",
  resourceKind: "post" as const, locale: "en-US", localFingerprint: "sha256:local",
  payload: { title: "Hello", content: "World", status: "draft" },
};

describe("projection-aware publication coordinator", () => {
  it("reserves before create, binds after success, and preserves projection evidence for the receipt", async () => {
    const db = store();
    const publish = vi.fn(async () => ({ ok: true as const, externalId: "42", externalUrl: "https://wordpress.example/?p=42", remoteFingerprint: "sha256:local" }));
    const result = await executeProjectedPublication({ db: db as never, intent, publish });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ existingExternalId: null, payload: intent.payload }));
    expect(result).toMatchObject({ ok: true, channelMetadata: { projectionId: expect.stringMatching(/^ecp-/) } });
    expect(db.current()).toMatchObject({ state: "current", externalRef: "42" });
  });

  it("quarantines an unknown create outcome and refuses a blind retry", async () => {
    const db = store();
    const publish = vi.fn(async () => ({ ok: false as const, error: "network_timeout", retryable: false, outcomeCertainty: "ambiguous" as const }));
    await expect(executeProjectedPublication({ db: db as never, intent, publish })).resolves.toMatchObject({ ok: false, error: "ambiguous_remote_outcome" });
    expect(db.current()).toMatchObject({ state: "ambiguous" });
    await expect(executeProjectedPublication({ db: db as never, intent: { ...intent, sourceVersion: "v2" }, publish }))
      .resolves.toMatchObject({ ok: false, error: "projection_reservation_failed" });
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
