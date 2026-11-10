import { beforeEach, describe, expect, it, vi } from "vitest";

const featureBuild = vi.hoisted(() => ({ findUnique: vi.fn() }));
const workroom = vi.hoisted(() => ({ findFirst: vi.fn() }));
const attach = vi.hoisted(() => vi.fn());
const bind = vi.hoisted(() => vi.fn());
vi.mock("@dpf/db", () => ({ prisma: { featureBuild, workroom } }));
vi.mock("@/lib/work-capsules/build-studio-attachment", () => ({
  attachBuildStudioWorkCapsule: attach,
  bindBuildStudioDeliveryShape: bind,
}));

import { healBuildWorkroomShape } from "./heal-build-workroom-shape";

const BUILD = {
  id: "row-1", buildId: "FB-600E0A08", title: "Required evidence parts", description: null, phase: "plan", createdById: "user-1",
  originator: { id: "bi-row", itemId: "BI-68E14C0B", title: "Required evidence parts", body: "## Acceptance\n- x", epicId: null, taxonomyNodeId: null, effortSize: "small", workType: "feature" },
};

describe("healBuildWorkroomShape (BI-C60EB507)", () => {
  beforeEach(() => {
    featureBuild.findUnique.mockReset();
    workroom.findFirst.mockReset();
    attach.mockReset();
    bind.mockReset();
  });

  it("attaches a room (which binds the shape) when the build has none", async () => {
    featureBuild.findUnique.mockResolvedValue(BUILD);
    workroom.findFirst.mockResolvedValue(null);
    attach.mockResolvedValue({ capsuleId: "WC-NEW" });
    const r = await healBuildWorkroomShape({ buildId: "FB-600E0A08", userId: "fallback" });
    expect(r.healed).toBe(true);
    expect(attach).toHaveBeenCalledTimes(1);
    const args = attach.mock.calls[0]![0] as { backlogItem: { effortSize: string }; actor: { userId: string } };
    expect(args.backlogItem.effortSize).toBe("small");
    expect(args.actor.userId).toBe("user-1");
  });

  it("binds the shape on an existing room that carries no workShape claim", async () => {
    featureBuild.findUnique.mockResolvedValue(BUILD);
    workroom.findFirst.mockResolvedValue({ capsuleId: "WC-B7844866", scopeClaims: [] });
    bind.mockResolvedValue({ bound: "delivery-small@1.0.0", reason: "derived" });
    const r = await healBuildWorkroomShape({ buildId: "FB-600E0A08", userId: "u" });
    expect(r.healed).toBe(true);
    expect(attach).not.toHaveBeenCalled();
    expect(bind).toHaveBeenCalledWith(expect.objectContaining({ capsuleId: "WC-B7844866" }));
  });

  it("is idempotent once a shape is bound, and refuses to invent a subject", async () => {
    featureBuild.findUnique.mockResolvedValue(BUILD);
    workroom.findFirst.mockResolvedValue({
      capsuleId: "WC-1",
      scopeClaims: [{ workShape: "delivery-small@1.0.0", recordedAt: "2026-09-23T00:00:00.000Z" }],
    });
    const r = await healBuildWorkroomShape({ buildId: "FB-600E0A08", userId: "u" });
    expect(r.healed).toBe(false);
    expect(bind).not.toHaveBeenCalled();
    featureBuild.findUnique.mockResolvedValue({ ...BUILD, originator: null });
    expect((await healBuildWorkroomShape({ buildId: "FB-600E0A08", userId: "u" })).healed).toBe(false);
  });
});
