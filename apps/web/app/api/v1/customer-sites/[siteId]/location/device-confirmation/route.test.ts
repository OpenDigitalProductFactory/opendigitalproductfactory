import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  workItem: vi.fn(),
  site: vi.fn(),
  updateMany: vi.fn(),
  activity: vi.fn(),
  sites: vi.fn(),
}));

vi.mock("@/lib/api/auth-middleware", () => ({ authenticateRequest: m.auth }));
vi.mock("@/lib/api/work-item-site-resolution", () => ({ resolveWorkItemSites: m.sites }));
vi.mock("@dpf/db", () => ({
  prisma: {
    workItem: { findUnique: m.workItem },
    customerSite: { findFirst: m.site },
    address: { updateMany: m.updateMany },
    activity: { create: m.activity },
  },
}));

import { POST } from "./route";

const params = { params: Promise.resolve({ siteId: "site-1" }) };
const body = { workItemId: "WI-1", latitude: 30.2671534, longitude: -97.7430612, accuracyMeters: 10 };
const request = (b: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(b) });

describe("POST device-confirmation (AC-ALC-VISIT-2, AC-ALC-VISIT-3, AC-ALC-VISIT-4)", () => {
  beforeEach(() => {
    Object.values(m).forEach((fn) => fn.mockReset());
    m.auth.mockResolvedValue({ user: { id: "user-1" } });
    m.workItem.mockResolvedValue({ assignedToUserId: "user-1", status: "in-progress", sourceType: "booking", sourceId: "B-1" });
    m.sites.mockResolvedValue([{ id: "site-1" }]);
    m.site.mockResolvedValue({
      name: "HQ", accountId: "acct-1", primaryAddressId: "addr-1",
      primaryAddress: { latitude: null, longitude: null, validationSource: null },
    });
    m.updateMany.mockResolvedValue({ count: 1 });
    m.activity.mockResolvedValue({});
  });

  it("stores the rounded point as device-confirmed, guarded, and records who confirmed it", async () => {
    const res = await POST(request(body), params);
    expect(res.status).toBe(200);
    const write = m.updateMany.mock.calls[0][0];
    expect(write.where).toMatchObject({ id: "addr-1", OR: [{ latitude: null }, { validationSource: { in: ["census", "opencage", "self-hosted"] } }] });
    expect(write.data).toMatchObject({ latitude: 30.26715, longitude: -97.74306, validationSource: "device-confirmed" });
    // Only the site point is stored: the audit entry carries who and which job, not the fix or its accuracy.
    const audit = m.activity.mock.calls[0][0].data;
    expect(audit).toMatchObject({ accountId: "acct-1", createdById: "user-1" });
    expect(JSON.stringify(audit)).not.toMatch(/30\.26|97\.74|accuracy/);
  });

  it("refuses someone not assigned the job, without writing", async () => {
    m.workItem.mockResolvedValue({ assignedToUserId: "someone-else", status: "in-progress", sourceType: "booking", sourceId: "B-1" });
    const res = await POST(request(body), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reason: "not-assigned" });
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a site outside the job's account", async () => {
    m.sites.mockResolvedValue([{ id: "other-site" }]);
    const res = await POST(request(body), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reason: "site-not-on-job" });
  });

  it("refuses an inaccurate fix and an already-confirmed site", async () => {
    expect(await (await POST(request({ ...body, accuracyMeters: 80 }), params)).json()).toMatchObject({ reason: "inaccurate" });
    m.site.mockResolvedValue({
      name: "HQ", accountId: "acct-1", primaryAddressId: "addr-1",
      primaryAddress: { latitude: "30.1", longitude: "-97.1", validationSource: "manual-pin" },
    });
    expect(await (await POST(request(body), params)).json()).toMatchObject({ reason: "already-confirmed" });
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it("reports already-confirmed when a person confirmed the site while the request was in flight", async () => {
    m.updateMany.mockResolvedValue({ count: 0 });
    const res = await POST(request(body), params);
    expect(res.status).toBe(409);
    expect(m.activity).not.toHaveBeenCalled();
  });

  it("rejects a malformed body", async () => {
    expect((await POST(request({ workItemId: "WI-1" }), params)).status).toBe(422);
  });
});
