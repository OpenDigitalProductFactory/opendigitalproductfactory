import { describe, expect, it, vi } from "vitest";

import { checkWordPressConnection, disconnectWordPress, setWordPressPublicationPolicy } from "./connection-operations";

const envelope = { schemaVersion: 1, reconnectFields: { siteUrl: "https://wordpress.example", username: "publisher" }, secretFields: { applicationPassword: "secret" }, safeProjection: { siteName: "Acme" } };

describe("WordPress connection operations", () => {
  it("checks health with the stored credential and records only safe evidence", async () => {
    const recordHealthProbe = vi.fn(async () => undefined);
    const db = { integrationCredential: { findUnique: vi.fn(async () => ({ status: "connected", fieldsEnc: "encrypted" })) } };
    const result = await checkWordPressConnection({
      db: db as never, decrypt: () => envelope, store: { recordHealthProbe } as never,
      createClient: () => ({ probe: vi.fn(async () => ({ siteName: "Acme", origin: "https://wordpress.example", authenticatedUser: { id: 7, name: "Publisher" }, supportedResourceKinds: ["post", "page"] as Array<"post" | "page" | "media">, supportedTaxonomies: ["category"], unsupportedResourceTypes: ["event"], canCreateDrafts: true, canPublishLive: false, canUploadMedia: false })) }),
      now: () => new Date("2026-08-22T06:00:00.000Z"),
    });
    expect(result).toMatchObject({ ok: true, siteName: "Acme", canPublishLive: false });
    expect(recordHealthProbe).toHaveBeenCalledWith("wordpress-self-hosted", {
      succeeded: true,
      safeProjectionPatch: {
        siteName: "Acme",
        origin: "https://wordpress.example",
        authenticatedUserName: "Publisher",
        supportedResourceKinds: "post,page",
        supportedTaxonomies: "category",
        unsupportedResourceTypes: "event",
        canCreateDrafts: true,
        canPublishLive: false,
        canUploadMedia: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("records a failed recheck without changing the capability projection", async () => {
    const recordHealthProbe = vi.fn(async () => undefined);
    const updateSafeProjection = vi.fn();
    const db = { integrationCredential: { findUnique: vi.fn(async () => ({ status: "connected", fieldsEnc: "encrypted" })) } };

    const result = await checkWordPressConnection({
      db: db as never,
      decrypt: () => envelope,
      store: { recordHealthProbe, updateSafeProjection } as never,
      createClient: () => ({
        probe: vi.fn(async () => {
          throw Object.assign(new Error("provider detail"), { code: "upstream_unavailable" });
        }),
      }),
    });

    expect(result).toEqual({ ok: false, error: "WordPress could not be reached safely." });
    expect(recordHealthProbe).toHaveBeenCalledWith("wordpress-self-hosted", {
      succeeded: false,
      error: { kind: "network", safeMessage: "WordPress could not be reached safely." },
    });
    expect(updateSafeProjection).not.toHaveBeenCalled();
  });

  it("disconnects without deleting projection identity and tells the operator to revoke remotely", async () => {
    const disconnect = vi.fn(async () => undefined);
    const db = { integrationCredential: { findUnique: vi.fn(async () => ({ status: "connected", fieldsEnc: "encrypted" })) } };
    const result = await disconnectWordPress({ db: db as never, store: { disconnect } as never });
    expect(disconnect).toHaveBeenCalledWith("wordpress-self-hosted");
    expect(result.revocationInstructions).toMatch(/WordPress.*Application Password/i);
  });

  it("requires consequence confirmation before enabling live publication", async () => {
    const updateSafeProjection = vi.fn(async (_id: string, transform: (value: Record<string, unknown>) => Record<string, unknown>) => transform({ siteName: "Acme" }));
    const db = { integrationCredential: { findUnique: vi.fn(async () => ({ status: "connected", fieldsEnc: "encrypted" })) } };
    await expect(setWordPressPublicationPolicy({ db: db as never, store: { updateSafeProjection } as never, enabled: true, consequenceConfirmed: false }))
      .rejects.toThrow(/confirm/i);
    await setWordPressPublicationPolicy({ db: db as never, store: { updateSafeProjection } as never, enabled: true, consequenceConfirmed: true });
    expect(updateSafeProjection).toHaveBeenCalledWith("wordpress-self-hosted", expect.any(Function));
    expect(await updateSafeProjection.mock.results[0]?.value).toMatchObject({ publicPublicationEnabled: true });
  });
});
