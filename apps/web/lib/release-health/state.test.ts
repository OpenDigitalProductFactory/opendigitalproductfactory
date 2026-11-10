import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  platformConfig: { findUnique: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: db }));

import {
  loadVerifiedReleaseTargetEvidence,
  recordVerifiedReleaseTargetEvidence,
  type ReleaseHealthState,
} from "./state";

const NOW = new Date("2026-08-30T01:20:00.000Z");
const VERIFIED_RELEASE_TARGET_MAX_AGE_MS = 30 * 60 * 1_000;
const CURRENT_CONFIG_DIGEST = `sha256:${"d".repeat(64)}`;
const candidate = {
  tag: "v2026.08.30-owner-release-projection.1",
  sourceSha: "f13fcf1c568425d24e9b6dcbf44e65668a39b420",
  channelDigest: `sha256:${"a".repeat(64)}`,
  platformManifestDigest: `sha256:${"b".repeat(64)}`,
  configDigest: `sha256:${"c".repeat(64)}`,
  platformOs: "linux" as const,
  platformArchitecture: "amd64",
};
const context = {
  installMode: "consumer" as const,
  imageTag: "v2026.08.29-rendered-target-admission.1",
  channelTag: "latest",
  installPath: "D:/DPF",
  composeFiles: ["docker-compose.yml", "docker-compose.release.yml"],
  ghcrOwner: "opendigitalproductfactory",
};

function verifiedState(over: Partial<ReleaseHealthState> = {}): ReleaseHealthState {
  return {
    snapshot: {
      tag: candidate.tag,
      headSha: candidate.sourceSha,
      runId: 33284151548,
      runUrl: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/actions/runs/33284151548",
      status: "verified",
      runConclusion: "success",
      runUpdatedAt: "2026-08-30T01:08:00.000Z",
    },
    checkedAt: "2026-08-30T01:12:00.000Z",
    notifiedRunId: null,
    verifiedTarget: {
      schemaVersion: 1,
      publisherRunId: 33284151548,
      verifiedAt: "2026-08-30T01:17:00.000Z",
      ghcrOwner: context.ghcrOwner,
      channelTag: context.channelTag,
      installMode: context.installMode,
      installedImageTag: context.imageTag,
      currentConfigDigest: CURRENT_CONFIG_DIGEST,
      candidate,
    },
    ...over,
  };
}

describe("verified release target evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
    db.platformConfig.update.mockResolvedValue({});
  });

  it("loads an exact fresh publisher-success-bound candidate", async () => {
    db.platformConfig.findUnique.mockResolvedValue({ value: verifiedState() });

    await expect(
      loadVerifiedReleaseTargetEvidence({
        context,
        currentConfigDigest: CURRENT_CONFIG_DIGEST,
        now: NOW,
        platformArchitecture: "amd64",
      }),
    ).resolves.toEqual(candidate);
  });

  it.each([
    ["stale", { checkedAt: new Date(NOW.getTime() - VERIFIED_RELEASE_TARGET_MAX_AGE_MS - 1).toISOString() }],
    ["failed publisher", { snapshot: { ...verifiedState().snapshot!, status: "publish-failed" as const } }],
    ["unbound publisher", { snapshot: { ...verifiedState().snapshot!, runConclusion: "failure" } }],
    ["ambiguous source", { snapshot: { ...verifiedState().snapshot!, headSha: null } }],
    ["mismatched tag", { snapshot: { ...verifiedState().snapshot!, tag: "v2026.08.30-other.1" } }],
    ["mismatched install", { verifiedTarget: { ...verifiedState().verifiedTarget!, installedImageTag: "v-old" } }],
    ["mismatched owner", { verifiedTarget: { ...verifiedState().verifiedTarget!, ghcrOwner: "untrusted-owner" } }],
    ["mismatched channel", { verifiedTarget: { ...verifiedState().verifiedTarget!, channelTag: "preview" } }],
    ["mismatched digest", { verifiedTarget: { ...verifiedState().verifiedTarget!, currentConfigDigest: `sha256:${"e".repeat(64)}` } }],
    ["wrong architecture", { verifiedTarget: { ...verifiedState().verifiedTarget!, candidate: { ...candidate, platformArchitecture: "arm64" } } }],
    ["malformed candidate", { verifiedTarget: { ...verifiedState().verifiedTarget!, candidate: { ...candidate, channelDigest: "latest" } } }],
  ])("rejects %s persisted evidence", async (_name, over) => {
    db.platformConfig.findUnique.mockResolvedValue({ value: verifiedState(over) });

    await expect(
      loadVerifiedReleaseTargetEvidence({
        context,
        currentConfigDigest: CURRENT_CONFIG_DIGEST,
        now: NOW,
        platformArchitecture: "amd64",
      }),
    ).resolves.toBeNull();
  });

  it("records registry evidence only against the current fresh verified publisher snapshot", async () => {
    db.platformConfig.findUnique.mockResolvedValue({ value: verifiedState({ verifiedTarget: null }) });

    await expect(
      recordVerifiedReleaseTargetEvidence({
        candidate,
        context,
        currentConfigDigest: CURRENT_CONFIG_DIGEST,
        now: NOW,
      }),
    ).resolves.toBe(true);
    expect(db.platformConfig.update).toHaveBeenCalledWith({
      where: { key: "release_health.latest" },
      data: {
        value: expect.objectContaining({
          verifiedTarget: expect.objectContaining({
            publisherRunId: 33284151548,
            candidate,
          }),
        }),
      },
    });
  });

  it("does not persist evidence when the publisher snapshot does not match the candidate", async () => {
    db.platformConfig.findUnique.mockResolvedValue({
      value: verifiedState({
        verifiedTarget: null,
        snapshot: { ...verifiedState().snapshot!, headSha: "0".repeat(40) },
      }),
    });

    await expect(
      recordVerifiedReleaseTargetEvidence({
        candidate,
        context,
        currentConfigDigest: CURRENT_CONFIG_DIGEST,
        now: NOW,
      }),
    ).resolves.toBe(false);
    expect(db.platformConfig.update).not.toHaveBeenCalled();
  });
});
