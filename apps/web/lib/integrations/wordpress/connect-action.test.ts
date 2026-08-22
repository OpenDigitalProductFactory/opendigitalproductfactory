import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), auditCreate: vi.fn(), transaction: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: {
  integrationCredential: { findUnique: mocks.findUnique, upsert: mocks.upsert, update: mocks.update },
  $transaction: mocks.transaction,
} }));

import { connectWordPress } from "./connect-action";

describe("connectWordPress", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.findUnique.mockResolvedValue(null);
    mocks.upsert.mockResolvedValue({});
    mocks.auditCreate.mockResolvedValue({});
    mocks.transaction.mockImplementation((operation) => operation({
      integrationCredential: { findUnique: mocks.findUnique, upsert: mocks.upsert, update: mocks.update },
      integrationToolCallLog: { create: mocks.auditCreate },
    }));
  });

  it("persists a successful probe through encrypted kernel credential custody", async () => {
    const result = await connectWordPress({ siteUrl: "https://wordpress.example", username: "publisher", applicationPassword: "secret" }, {
      probe: vi.fn(async () => ({ siteName: "Acme", origin: "https://wordpress.example", authenticatedUser: { id: 7, name: "Publisher" }, supportedResourceKinds: ["post", "page", "media"] as Array<"post" | "page" | "media">, canCreateDrafts: true, canPublishLive: false, canUploadMedia: true })),
      now: () => new Date("2026-08-22T02:00:00.000Z"),
    });
    expect(result).toMatchObject({ ok: true, status: "connected", siteName: "Acme", canPublishLive: false });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { integrationId: "wordpress-self-hosted" },
      create: expect.objectContaining({ provider: "wordpress", status: "connected" }),
    }));
    const stored = JSON.parse(mocks.upsert.mock.calls[0]![0].create.fieldsEnc);
    expect(stored.secretFields).toEqual({ applicationPassword: "secret" });
    expect(JSON.stringify(stored.safeProjection)).not.toContain("secret");
    expect(JSON.stringify(mocks.auditCreate.mock.calls)).not.toContain("secret");
  });

  it("returns a redacted failure and never persists a failed application password", async () => {
    const result = await connectWordPress({ siteUrl: "https://wordpress.example", username: "publisher", applicationPassword: "do-not-leak" }, {
      probe: vi.fn(async () => { throw Object.assign(new Error("bad do-not-leak"), { code: "authentication_failed" }); }),
    });
    expect(result).toMatchObject({ ok: false, status: "error" });
    expect(JSON.stringify(result)).not.toContain("do-not-leak");
    expect(JSON.stringify(mocks.upsert.mock.calls)).not.toContain("do-not-leak");
  });
});
