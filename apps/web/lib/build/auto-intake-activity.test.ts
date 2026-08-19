import { describe, expect, it, vi } from "vitest";
import { prisma } from "@dpf/db";
import { recordAutoIntakeFailure } from "@/lib/mcp/build-tool-helpers";

vi.mock("@dpf/db", () => ({
  prisma: {
    buildActivity: {
      create: vi.fn(async () => ({})),
    },
  },
}));

describe("recordAutoIntakeFailure", () => {
  it("surfaces auto-intake failures as BuildActivity rows instead of console-only warnings", () => {
    const warn = vi.fn();

    recordAutoIntakeFailure(
      "FB-REVIEW",
      "epic",
      new Error("requireCapability(view_platform) has no request session"),
      { warn },
    );

    expect(prisma.buildActivity.create).toHaveBeenCalledWith({
      data: {
        buildId: "FB-REVIEW",
        tool: "auto-intake:epic:failed",
        summary: expect.stringContaining(
          "Auto-intake epic failed: requireCapability(view_platform) has no request session",
        ),
      },
    });
    expect(warn).toHaveBeenCalled();
  });
});
