import { describe, expect, it, vi } from "vitest";

import {
  peerRuntimeTargetId,
  peerRuntimeTargetStatus,
  reflectPeerRuntimeTargets,
} from "./operational-posture-peer-targets";
import type { PostureInstallView } from "./operational-posture-read-model";

const now = new Date("2026-09-06T12:00:00.000Z");

function peer(overrides: Partial<PostureInstallView> = {}): PostureInstallView {
  return {
    key: "peer:link_dev",
    label: "Example DEV",
    basis: "mirrored-report",
    installationId: `inst_${"d".repeat(32)}`,
    linkId: "link_dev",
    servedVersion: "5.11.0",
    servedSha: "def456",
    patchPosture: { critical: 0, high: 0, medium: 0, low: 0 },
    health: { status: "healthy", estateItemCount: 3 },
    runtime: { targetCount: 2, healthyCount: 2 },
    resourceFootprint: null,
    capturedAt: now.toISOString(),
    receivedAt: now.toISOString(),
    ageMs: 0,
    freshness: "fresh",
    basisLine: "Reported by Example DEV · captured just now",
    ...overrides,
  };
}

describe("peerRuntimeTargetId / peerRuntimeTargetStatus", () => {
  it("derives a stable id from the link and a status from the report's freshness", () => {
    expect(peerRuntimeTargetId("link_0123456789abcdef")).toBe("RT-PEER-0123456789ABCDEF");
    expect(peerRuntimeTargetStatus("fresh")).toBe("running");
    expect(peerRuntimeTargetStatus("stale")).toBe("blocked");
    expect(peerRuntimeTargetStatus("silent")).toBe("expired");
  });
});

describe("reflectPeerRuntimeTargets", () => {
  it("registers one external-preview target per reported peer, never a root-portal", async () => {
    const register = vi.fn().mockResolvedValue({});
    const db = {} as never;

    const result = await reflectPeerRuntimeTargets(db, {
      peers: [peer(), peer({ key: "peer:link_other", linkId: "link_other", label: "Other", freshness: "silent" })],
      links: [
        { linkId: "link_dev", peerAuthorityUrl: "http://10.0.0.5:3000" },
        { linkId: "link_other", peerAuthorityUrl: "http://10.0.0.9:3000" },
      ],
      now,
    }, { register });

    expect(result).toEqual({ reflected: 2 });
    expect(register).toHaveBeenCalledTimes(2);
    expect(register.mock.calls[0][0].input).toMatchObject({
      targetId: "RT-PEER-DEV",
      kind: "external-preview",
      status: "running",
      hostUrl: "http://10.0.0.5:3000",
      serviceVersion: "5.11.0+def456",
      metadata: expect.objectContaining({
        federated: true,
        federationLinkId: "link_dev",
        originInstallationId: `inst_${"d".repeat(32)}`,
        freshness: "fresh",
      }),
    });
    expect(register.mock.calls[1][0].input).toMatchObject({ targetId: "RT-PEER-OTHER", status: "expired" });
    for (const call of register.mock.calls) expect(call[0].input.kind).not.toBe("root-portal");
  });

  it("skips a view without a link (the local capture)", async () => {
    const register = vi.fn();
    const result = await reflectPeerRuntimeTargets({} as never, {
      peers: [peer({ key: "local", basis: "local-capture", linkId: null })],
      links: [],
    }, { register });
    expect(result).toEqual({ reflected: 0 });
    expect(register).not.toHaveBeenCalled();
  });
});
