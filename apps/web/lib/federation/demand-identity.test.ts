import { describe, expect, it, vi } from "vitest";

import {
  deriveDemandNetworkRefs,
  resolveFederationIdentity,
  type FederationIdentityDb,
} from "./demand-identity";

describe("resolveFederationIdentity", () => {
  it("reuses the persisted installation identity and projection secret", async () => {
    const existing = {
      installationId: `inst_${"c".repeat(32)}`,
      projectionSecret: "a".repeat(64),
    };
    const upsert = vi.fn().mockResolvedValue({ value: existing });

    await expect(resolveFederationIdentity({ platformConfig: { upsert } } as FederationIdentityDb))
      .resolves.toEqual(existing);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: "federation.identity" },
      update: {},
    }));
  });

  it("creates opaque identity material once when the installation has none", async () => {
    const upsert = vi.fn().mockImplementation(async ({ create }: { create: { value: unknown } }) => ({
      value: create.value,
    }));

    const identity = await resolveFederationIdentity({ platformConfig: { upsert } } as FederationIdentityDb);

    expect(identity.installationId).toMatch(/^inst_[a-f0-9]{32}$/);
    expect(identity.projectionSecret).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("deriveDemandNetworkRefs", () => {
  it("is stable and does not expose the local backlog item ID", () => {
    const identity = { installationId: "inst_a", projectionSecret: "b".repeat(64) };

    const first = deriveDemandNetworkRefs(identity, "BI-PRIVATE-123");
    const second = deriveDemandNetworkRefs(identity, "BI-PRIVATE-123");

    expect(first).toEqual(second);
    expect(first.envelopeId).toMatch(/^dem_[a-f0-9]{32}$/);
    expect(first.originRecordRef).toMatch(/^ref_[a-f0-9]{32}$/);
    expect(JSON.stringify(first)).not.toContain("BI-PRIVATE-123");
  });
});
