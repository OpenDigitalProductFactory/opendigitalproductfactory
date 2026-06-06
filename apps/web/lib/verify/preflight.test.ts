import { describe, expect, it } from "vitest";
import type { ImageVersion } from "@/lib/platform/image-version";
import {
  computePreflightVerdict,
  type PreflightInput,
  type PreflightResult,
} from "./preflight";

const FEATURE = "a".repeat(40);
const SERVED = "b".repeat(40);

function gitSha(raw: string): ImageVersion {
  return { raw, source: "git-sha" };
}

function run(partial: Partial<PreflightInput>): PreflightResult {
  return computePreflightVerdict({
    portalReachable: true,
    servedImage: gitSha(SERVED),
    featureSha: FEATURE,
    featureContainedInServed: null,
    ...partial,
  });
}

describe("computePreflightVerdict", () => {
  it("BLOCKED when the portal is unreachable", () => {
    const r = run({ portalReachable: false, servedImage: null });
    expect(r.verdict).toBe("BLOCKED");
    expect(r.nextAction.kind).toBe("file-blocker-bi");
    expect(r.served.source).toBe("unreachable");
  });

  it("BLOCKED when reachable but there is no image-version marker", () => {
    const r = run({ servedImage: null });
    expect(r.verdict).toBe("BLOCKED");
    expect(r.nextAction.kind).toBe("file-blocker-bi");
    expect(r.served.sha).toBeNull();
  });

  it("MUST-ADVANCE when the served identity is a content-hash, not a git SHA", () => {
    const r = run({ servedImage: { raw: "c".repeat(64), source: "content-hash" } });
    expect(r.verdict).toBe("MUST-ADVANCE");
    expect(r.nextAction.kind).toBe("trigger-self-upgrade");
    expect(r.nextAction.detail).toContain("/ops/self-upgrade");
  });

  it("MUST-ADVANCE when the served identity is an unknown shape", () => {
    const r = run({ servedImage: { raw: "v5.6.0", source: "unknown" } });
    expect(r.verdict).toBe("MUST-ADVANCE");
    expect(r.nextAction.kind).toBe("trigger-self-upgrade");
  });

  it("CAN-TEST when a git-sha served image contains the feature commit", () => {
    const r = run({ featureContainedInServed: true });
    expect(r.verdict).toBe("CAN-TEST");
    expect(r.nextAction.kind).toBe("drive-happy-path");
    expect(r.served.source).toBe("git-sha");
  });

  it("MUST-ADVANCE when a git-sha served image does NOT contain the feature commit", () => {
    const r = run({ featureContainedInServed: false });
    expect(r.verdict).toBe("MUST-ADVANCE");
    expect(r.nextAction.kind).toBe("trigger-self-upgrade");
  });

  it("BLOCKED when ancestry against a git-sha served image is uncomputable", () => {
    const r = run({ featureContainedInServed: null });
    expect(r.verdict).toBe("BLOCKED");
    expect(r.nextAction.kind).toBe("file-blocker-bi");
  });

  it("never points at the forbidden redeploy-portal path on any advance", () => {
    // Guards the BI-6B31D9FF reconciliation at the contract level: the governed
    // advance is /ops/self-upgrade, never redeploy-portal.
    for (const input of [
      { featureContainedInServed: false } as Partial<PreflightInput>,
      { servedImage: { raw: "c".repeat(64), source: "content-hash" } as ImageVersion },
    ]) {
      const r = run(input);
      expect(r.nextAction.detail).not.toMatch(/redeploy-portal/i);
      expect(r.nextAction.detail).toContain("/ops/self-upgrade");
    }
  });

  it("always returns a populated reason and the feature sha echoed back", () => {
    for (const input of [
      { portalReachable: false, servedImage: null } as Partial<PreflightInput>,
      { servedImage: null },
      { featureContainedInServed: true },
      { featureContainedInServed: false },
      { featureContainedInServed: null },
    ]) {
      const r = run(input);
      expect(r.reason.length).toBeGreaterThan(0);
      expect(r.feature.sha).toBe(FEATURE);
    }
  });
});
