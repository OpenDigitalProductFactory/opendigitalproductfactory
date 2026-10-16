import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../config", () => ({ getSelfUpgradeConfig: vi.fn(async () => ({ enabled: true, hostSourceMountPath: "/host-dpf" })) }));
vi.mock("../support", () => ({ readSelfUpgradeSupport: vi.fn() }));
vi.mock("../status-target", () => ({ resolveSelfUpgradeStatusTarget: vi.fn(async () => ({ targetSha: "b".repeat(40), unavailableReason: null })) }));
vi.mock("../runtime-image-identity", () => ({ readCurrentContainerConfigDigest: vi.fn(async () => "sha256:current") }));
vi.mock("./change-set", () => ({ collectChangeSet: vi.fn(async () => []) }));
vi.mock("./release-change-set", () => ({ collectReleaseChangeSet: vi.fn(async () => []) }));
import { readSelfUpgradeSupport } from "../support";
import { resolveSelfUpgradeStatusTarget } from "../status-target";
import { readCurrentContainerConfigDigest } from "../runtime-image-identity";
import { collectChangeSet } from "./change-set";
import { collectReleaseChangeSet } from "./release-change-set";
import { loadImpactSource } from "./source";
beforeEach(() => vi.clearAllMocks());
const range = { currentLineageSha: "a".repeat(40), targetSha: "b".repeat(40) };
describe("impact source routing", () => {
  it("uses the canonical release target and provider changes with no host Git", async () => {
    vi.mocked(readSelfUpgradeSupport).mockResolvedValue({ supported: true, targetKind: "release-artifact" } as never);
    const source = await loadImpactSource();
    expect(source.targetSha).toBe(range.targetSha);
    await source.collect(range);
    expect(resolveSelfUpgradeStatusTarget).toHaveBeenCalledWith(expect.objectContaining({ currentConfigDigest: "sha256:current" }));
    expect(collectReleaseChangeSet).toHaveBeenCalledWith(range);
    expect(collectChangeSet).not.toHaveBeenCalled();
  });
  it("retains configured clone reads for source-backed installs", async () => {
    vi.mocked(readSelfUpgradeSupport).mockResolvedValue({ supported: true, targetKind: "git-source" } as never);
    const source = await loadImpactSource();
    await source.collect(range);
    expect(collectChangeSet).toHaveBeenCalledWith({ ...range, config: { hostSourcePath: "/host-dpf" } });
    expect(collectReleaseChangeSet).not.toHaveBeenCalled();
    expect(readCurrentContainerConfigDigest).not.toHaveBeenCalled();
  });
});
