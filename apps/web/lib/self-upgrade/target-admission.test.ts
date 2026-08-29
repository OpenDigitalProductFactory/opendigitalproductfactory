import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./target-binding", () => ({
  verifySelfUpgradeTargetBinding: vi.fn(),
}));

import { verifySelfUpgradeTargetBinding } from "./target-binding";
import { selectSelfUpgradeAdmissionTarget } from "./target-admission";

const RELEASE_TARGET = {
  targetKind: "release-artifact" as const,
  targetSha: "f".repeat(40),
  targetTag: "v2026.08.29-consumer-restart-identity.1",
};

describe("self-upgrade admission target selection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses an authenticated rendered release target when discovery is unavailable", () => {
    vi.mocked(verifySelfUpgradeTargetBinding).mockReturnValue({
      ok: true,
      data: RELEASE_TARGET,
    });

    expect(selectSelfUpgradeAdmissionTarget({
      targetBinding: "server-signed-target",
      supportTargetKind: "release-artifact",
      resolvedTarget: null,
    })).toEqual({ ok: true, data: RELEASE_TARGET });
  });

  it("refuses a forged or expired target binding", () => {
    vi.mocked(verifySelfUpgradeTargetBinding).mockReturnValue({
      ok: false,
      error: "signature-mismatch",
    });

    expect(selectSelfUpgradeAdmissionTarget({
      targetBinding: "forged",
      supportTargetKind: "release-artifact",
      resolvedTarget: null,
    })).toEqual({ ok: false, error: "target-binding-invalid" });
  });

  it("refuses a rendered target when fresh discovery resolves differently", () => {
    vi.mocked(verifySelfUpgradeTargetBinding).mockReturnValue({
      ok: true,
      data: RELEASE_TARGET,
    });

    expect(selectSelfUpgradeAdmissionTarget({
      targetBinding: "server-signed-stale-target",
      supportTargetKind: "release-artifact",
      resolvedTarget: { ...RELEASE_TARGET, targetSha: "e".repeat(40) },
    })).toEqual({ ok: false, error: "target-changed" });
  });

  it("does not let a release binding bridge unresolved Git-source discovery", () => {
    vi.mocked(verifySelfUpgradeTargetBinding).mockReturnValue({
      ok: true,
      data: RELEASE_TARGET,
    });

    expect(selectSelfUpgradeAdmissionTarget({
      targetBinding: "server-signed-target",
      supportTargetKind: "git-source",
      resolvedTarget: null,
    })).toEqual({ ok: false, error: "target-unavailable" });
  });

  it("uses a freshly resolved target without requiring a rendered binding", () => {
    vi.mocked(verifySelfUpgradeTargetBinding).mockReturnValue({
      ok: false,
      error: "malformed",
    });

    expect(selectSelfUpgradeAdmissionTarget({
      supportTargetKind: "git-source",
      resolvedTarget: {
        targetKind: "git-source",
        targetSha: "a".repeat(40),
        targetTag: null,
      },
    })).toEqual({
      ok: true,
      data: {
        targetKind: "git-source",
        targetSha: "a".repeat(40),
        targetTag: null,
      },
    });
    expect(verifySelfUpgradeTargetBinding).toHaveBeenCalledOnce();
    expect(verifySelfUpgradeTargetBinding).toHaveBeenCalledWith("");
  });
});
