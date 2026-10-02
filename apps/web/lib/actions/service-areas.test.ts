import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  require: vi.fn(),
  findOrg: vi.fn(),
  crewCount: vi.fn(),
  employeeCount: vi.fn(),
  save: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability: m.require }));
vi.mock("@dpf/db", () => ({
  prisma: {
    organization: { findFirst: m.findOrg },
    staffingCrew: { count: m.crewCount },
    employeeProfile: { count: m.employeeCount },
  },
}));
vi.mock("@/lib/twin/service-area-layout", () => ({ saveServiceAreas: m.save }));

import { saveServiceAreasAction } from "./service-areas";

const crewZone = { id: "z", label: "North", coveredBy: { kind: "staffing-crew", id: "CREW-1" }, geometry: {} };

beforeEach(() => {
  vi.resetAllMocks();
  m.require.mockResolvedValue({ userId: "u1" });
  m.findOrg.mockResolvedValue({ id: "org-row", orgId: "ORG-1" });
  m.crewCount.mockResolvedValue(1);
  m.employeeCount.mockResolvedValue(0);
  m.save.mockResolvedValue({ ok: true, version: 2 });
});

describe("saveServiceAreasAction", () => {
  it("saves with operate_customer and returns the new version (AC-COV-DRAW-1)", async () => {
    expect(await saveServiceAreasAction(1, [crewZone])).toEqual({ ok: true, data: { version: 2 } });
    expect(m.require).toHaveBeenCalledWith("operate_customer");
    expect(m.crewCount).toHaveBeenCalledWith({ where: { crewId: { in: ["CREW-1"] }, organizationId: "org-row" } });
    expect(m.save).toHaveBeenCalledWith(expect.anything(), { orgId: "ORG-1", expectedVersion: 1, zones: [crewZone] });
  });

  it("refuses without the capability and writes nothing (AC-COV-DRAW-3)", async () => {
    m.require.mockRejectedValue(new Error("Unauthorized"));
    expect(await saveServiceAreasAction(1, [crewZone])).toEqual({ ok: false, error: "forbidden" });
    expect(m.save).not.toHaveBeenCalled();
  });

  it("refuses an assignee that is not in this organization", async () => {
    m.crewCount.mockResolvedValue(0);
    expect(await saveServiceAreasAction(1, [crewZone])).toEqual({ ok: false, error: "unknown-assignee" });
    expect(m.save).not.toHaveBeenCalled();
  });

  it("passes a stale save through as stale (AC-COV-DRAW-2)", async () => {
    m.save.mockResolvedValue({ ok: false, code: "stale", error: "stale" });
    expect(await saveServiceAreasAction(1, [])).toEqual({ ok: false, error: "stale" });
  });
});
