import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    organizationCapabilityActivation: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    businessContext: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import {
  getEffectiveCapabilityActivations,
  getOrgCapabilityChoices,
  setCapabilityChoice,
} from "./capability-activation";

const findMany = prisma.organizationCapabilityActivation.findMany as ReturnType<typeof vi.fn>;
const upsert = prisma.organizationCapabilityActivation.upsert as ReturnType<typeof vi.fn>;
const bcFindUnique = prisma.businessContext.findUnique as ReturnType<typeof vi.fn>;

beforeEach(() => {
  findMany.mockReset();
  upsert.mockReset();
  // Default: no posture stored → resolveOrgRiskEnvelope fails open to balanced
  // (capabilityAutoActivate=false), i.e. today's behavior.
  bcFindUnique.mockReset();
  bcFindUnique.mockResolvedValue(null);
});

describe("getOrgCapabilityChoices", () => {
  it("maps stored rows to a key→choice record and ignores malformed choices", async () => {
    findMany.mockResolvedValue([
      { capabilityKey: "partner-program", choice: "enabled" },
      { capabilityKey: "point-of-sale", choice: "disabled" },
      { capabilityKey: "garbage", choice: "maybe" },
    ]);
    const choices = await getOrgCapabilityChoices("org_1");
    expect(choices).toEqual({ "partner-program": "enabled", "point-of-sale": "disabled" });
  });
});

describe("getEffectiveCapabilityActivations", () => {
  it("folds stored choices over derived applicabilities", async () => {
    findMany.mockResolvedValue([{ capabilityKey: "partner-program", choice: "enabled" }]);
    const effective = await getEffectiveCapabilityActivations("org_1", [
      { capabilityKey: "partner-program", applicability: "recommended" },
      { capabilityKey: "customer-accounts", applicability: "required" },
    ]);
    const byKey = Object.fromEntries(effective.map((e) => [e.capabilityKey, e]));
    expect(byKey["partner-program"]).toMatchObject({ active: true, source: "org-choice" });
    expect(byKey["customer-accounts"]).toMatchObject({ active: true, source: "required" });
  });

  it("auto-activates un-decided recommended capabilities under a progressive posture", async () => {
    findMany.mockResolvedValue([{ capabilityKey: "point-of-sale", choice: "disabled" }]);
    bcFindUnique.mockResolvedValue({ riskPosture: "progressive" });
    const effective = await getEffectiveCapabilityActivations("org_1", [
      { capabilityKey: "partner-program", applicability: "recommended" }, // no choice → auto-on
      { capabilityKey: "point-of-sale", applicability: "recommended" }, // explicit disable wins
      { capabilityKey: "customer-accounts", applicability: "required" },
    ]);
    const byKey = Object.fromEntries(effective.map((e) => [e.capabilityKey, e]));
    expect(byKey["partner-program"]).toMatchObject({ active: true, source: "posture-default" });
    expect(byKey["point-of-sale"]).toMatchObject({ active: false, source: "org-choice" });
    expect(byKey["customer-accounts"]).toMatchObject({ active: true });
  });

  it("leaves recommended off under the default balanced posture (no-change baseline)", async () => {
    findMany.mockResolvedValue([]);
    bcFindUnique.mockResolvedValue({ riskPosture: "balanced" });
    const effective = await getEffectiveCapabilityActivations("org_1", [
      { capabilityKey: "partner-program", applicability: "recommended" },
    ]);
    expect(effective[0]).toMatchObject({ active: false, source: "default-off" });
  });
});

describe("setCapabilityChoice", () => {
  it("upserts the decision keyed by (organizationId, capabilityKey)", async () => {
    upsert.mockResolvedValue({});
    await setCapabilityChoice({
      organizationId: "org_1",
      capabilityKey: "partner-program",
      choice: "enabled",
      decidedVia: "setup-wizard",
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId_capabilityKey: { organizationId: "org_1", capabilityKey: "partner-program" } },
        create: expect.objectContaining({ choice: "enabled", decidedVia: "setup-wizard" }),
        update: { choice: "enabled", decidedVia: "setup-wizard" },
      }),
    );
  });

  it("rejects unknown capability keys before writing", async () => {
    await expect(
      setCapabilityChoice({
        organizationId: "org_1",
        capabilityKey: "not-a-capability",
        choice: "enabled",
        decidedVia: "admin",
      }),
    ).rejects.toThrow(/Unknown capability key/);
    expect(upsert).not.toHaveBeenCalled();
  });
});
