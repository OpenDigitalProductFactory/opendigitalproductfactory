import { beforeEach, describe, expect, it, vi } from "vitest";

import { federationAdvertisementSchema } from "@dpf/validators";

const { mockResolveIdentity, mockEstate } = vi.hoisted(() => ({
  mockResolveIdentity: vi.fn(),
  mockEstate: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: { platformConfig: { findUnique: vi.fn(async () => null) } },
}));
vi.mock("@/lib/federation/demand-identity", () => ({
  resolveFederationIdentity: mockResolveIdentity,
}));
vi.mock("@/lib/install/estate-identity", () => ({
  loadEstateNameResolution: mockEstate,
  // BI-CA54ACC8: the route composes its store through this builder.
  prismaEstateIdentityStore: vi.fn(() => ({ readConfig: async () => null, readOrganizationName: async () => null })),
}));

import { GET } from "./route";

const PROJECTION_SECRET = "f".repeat(64);

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  mockResolveIdentity.mockResolvedValue({
    installationId: "inst_00000000000000000000000000000000",
    projectionSecret: PROJECTION_SECRET,
  });
  mockEstate.mockResolvedValue({ estateName: "North Wind", tier: "portal-declaration" });
});

describe("GET /.well-known/dpf-federation.json", () => {
  it("serves a descriptor the shared contract accepts, and nothing else", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const payload = await response.json();
    expect(federationAdvertisementSchema.safeParse(payload).success).toBe(true);
    // The closed allow-list, verbatim. A new field here is a privacy decision,
    // and it should have to break this test to happen.
    expect(Object.keys(payload).sort()).toEqual([
      "caps",
      "install",
      "organization",
      "pair",
      "protocol",
    ]);
    expect(payload.organization).toBe("North Wind");
    // Nothing that identifies the host, the device, or the tenant.
    expect(JSON.stringify(payload)).not.toContain(PROJECTION_SECRET);
    expect(JSON.stringify(payload)).not.toContain("inst_");
  });

  it("omits the organization when the install has never been named", async () => {
    mockEstate.mockResolvedValue({ estateName: null, tier: "unset" });
    const payload = await (await GET()).json();
    expect(payload.organization).toBeUndefined();
    expect(federationAdvertisementSchema.safeParse(payload).success).toBe(true);
  });

  it("is absent, not an error, when an operator turned advertising off", async () => {
    vi.stubEnv("DPF_FEDERATION_ADVERTISE", "0");
    const response = await GET();
    expect(response.status).toBe(404);
    expect(mockResolveIdentity).not.toHaveBeenCalled();
  });

  it("is absent when the install has no federation identity to advertise", async () => {
    mockResolveIdentity.mockRejectedValue(new Error("no identity"));
    expect((await GET()).status).toBe(404);
  });
});
