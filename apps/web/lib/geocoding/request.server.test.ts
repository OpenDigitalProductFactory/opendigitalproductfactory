import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, send } = vi.hoisted(() => ({ findUnique: vi.fn(), send: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@dpf/db", () => ({ prisma: { platformConfig: { findUnique } } }));
vi.mock("@/lib/jobs", () => ({ jobs: { send } }));

import { requestAddressGeocode, requestOrganizationGeocode } from "./request.server";

describe("geocode-on-save requests", () => {
  beforeEach(() => {
    findUnique.mockReset();
    send.mockReset();
  });

  it("sends nothing under the default provider none (AC-ALC-SAVE-3)", async () => {
    findUnique.mockResolvedValue(null);
    expect(await requestAddressGeocode("addr-1")).toBe(false);
    findUnique.mockResolvedValue({ value: { provider: "none" } });
    expect(await requestOrganizationGeocode("org-1")).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("queues exactly one job when a provider is chosen", async () => {
    findUnique.mockResolvedValue({ value: { provider: "census" } });
    send.mockResolvedValue({ ids: ["e1"] });
    expect(await requestAddressGeocode("addr-1")).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ name: "geocode/address.requested", data: { addressId: "addr-1" } });
  });

  it("never throws when queueing fails", async () => {
    findUnique.mockResolvedValue({ value: { provider: "census" } });
    send.mockRejectedValue(new Error("engine down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await requestOrganizationGeocode("org-1")).toBe(false);
    warn.mockRestore();
  });
});
