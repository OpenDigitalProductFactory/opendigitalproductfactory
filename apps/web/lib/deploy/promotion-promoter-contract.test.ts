import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPromoterCommand } from "@/lib/self-upgrade/promoter";
import {
  guardPromotionPromoterContract,
  validatePromotionPromoterContract,
} from "./promotion-promoter-contract";

const db = vi.hoisted(() => ({
  updatePromotion: vi.fn(),
  createActivity: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    changePromotion: { update: db.updatePromotion },
    buildActivity: { create: db.createActivity },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  db.updatePromotion.mockResolvedValue({});
  db.createActivity.mockResolvedValue({});
});

describe("validatePromotionPromoterContract", () => {
  it("rejects the legacy Build Studio invocation with every missing contract field", () => {
    const result = validatePromotionPromoterContract([
      "run",
      "-d",
      "-e",
      "PROMOTION_ID=CP-123",
      "dpf-promoter",
    ]);

    expect(result).toEqual({
      ok: false,
      missing: [
        "--self-upgrade",
        "PROMOTE_SOURCE",
        "PROMOTE_TARGET_SHA",
        "PROMOTE_BACKUP_PATH",
        "PROMOTE_HEALTH_URL",
      ],
      message:
        "Promoter contract mismatch: missing --self-upgrade, PROMOTE_SOURCE, PROMOTE_TARGET_SHA, PROMOTE_BACKUP_PATH, PROMOTE_HEALTH_URL. Deployment was not started.",
    });
  });

  it("accepts the canonical self-upgrade promoter command", () => {
    const command = buildPromoterCommand({
      hostInstallPath: "/opt/dpf",
      targetSha: "abc123",
      backupPath: "/backups/promotions/CP-123",
      healthUrl: "http://localhost:3000/api/health",
    });

    expect(validatePromotionPromoterContract(command.args)).toEqual({
      ok: true,
      missing: [],
      message: null,
    });
  });

  it("persists actionable failure evidence before returning the refusal", async () => {
    const failure = await guardPromotionPromoterContract({
      dockerArgs: ["run", "dpf-promoter"],
      promotionId: "CP-123",
      buildId: "FB-123",
    });

    expect(failure?.error).toBe("Promoter contract mismatch");
    expect(db.updatePromotion).toHaveBeenCalledWith({
      where: { promotionId: "CP-123" },
      data: {
        deploymentLog: expect.stringContaining("[preflight] Promoter contract mismatch"),
        rollbackReason: expect.stringContaining("missing --self-upgrade"),
      },
    });
    expect(db.createActivity).toHaveBeenCalledWith({
      data: {
        buildId: "FB-123",
        tool: "execute_promotion",
        summary: expect.stringContaining("Deployment was not started"),
      },
    });
  });
});
