import { describe, expect, it } from "vitest";
import type { ImageVersion } from "@/lib/platform/image-version";
import {
  resolveLiveInstallReadiness,
  type ReadinessDeps,
} from "./preflight-service";

const FEATURE = "a".repeat(40);
const SERVED = "b".repeat(40);

function deps(over: Partial<ReadinessDeps>): ReadinessDeps {
  return {
    readImage: async (): Promise<ImageVersion | null> => ({ raw: SERVED, source: "git-sha" }),
    readInstallHostProfile: async () => ({
      kind: "unknown",
      installMode: null,
      sourceCapable: false,
      releaseImage: false,
      reason: "insufficient-install-evidence",
    }),
    isAncestor: async () => null,
    ...over,
  };
}

describe("resolveLiveInstallReadiness", () => {
  it("CAN-TESTs exact identity without consulting Git ancestry", async () => {
    let ancestryCalled = false;
    const r = await resolveLiveInstallReadiness(
      { featureSha: FEATURE },
      deps({
        readImage: async () => ({ raw: FEATURE, source: "git-sha" }),
        isAncestor: async () => {
          ancestryCalled = true;
          return null;
        },
      }),
    );
    expect(r.verdict).toBe("CAN-TEST");
    expect(ancestryCalled).toBe(false);
  });

  it("CAN-TEST when the served git-sha image contains the feature commit", async () => {
    const r = await resolveLiveInstallReadiness(
      { featureSha: FEATURE },
      deps({ isAncestor: async () => true }),
    );
    expect(r.verdict).toBe("CAN-TEST");
    expect(r.nextAction.kind).toBe("drive-happy-path");
  });

  it("MUST-ADVANCE when the served git-sha image does not contain the feature commit", async () => {
    const r = await resolveLiveInstallReadiness(
      { featureSha: FEATURE },
      deps({ isAncestor: async () => false }),
    );
    expect(r.verdict).toBe("MUST-ADVANCE");
  });

  it("BLOCKED when ancestry is uncomputable (git unavailable in-portal)", async () => {
    const r = await resolveLiveInstallReadiness(
      { featureSha: FEATURE },
      deps({ isAncestor: async () => null }),
    );
    expect(r.verdict).toBe("BLOCKED");
  });

  it("MUST-ADVANCEs uncomputable ancestry only for a server-derived consumer host", async () => {
    const r = await resolveLiveInstallReadiness(
      { featureSha: FEATURE },
      deps({
        isAncestor: async () => null,
        readInstallHostProfile: async () => ({
          kind: "consumer",
          installMode: "consumer",
          sourceCapable: false,
          releaseImage: true,
          reason: "consumer-release-install",
        }),
      }),
    );
    expect(r.verdict).toBe("MUST-ADVANCE");
    expect(r.nextAction.kind).toBe("trigger-self-upgrade");
    expect(`${r.reason} ${r.nextAction.detail}`).not.toMatch(/DPF_REPO_ROOT|git fetch/i);
  });

  it.each(["source", "unknown"] as const)(
    "keeps uncomputable ancestry BLOCKED for a server-derived %s host",
    async (kind) => {
      const r = await resolveLiveInstallReadiness(
        { featureSha: FEATURE },
        deps({
          isAncestor: async () => null,
          readInstallHostProfile: async () => ({
            kind,
            installMode: kind === "source" ? "contributor" : null,
            sourceCapable: kind === "source",
            releaseImage: false,
            reason:
              kind === "source"
                ? "git-source-present"
                : "insufficient-install-evidence",
          }),
        }),
      );
      expect(r.verdict).toBe("BLOCKED");
    },
  );

  it("surfaces actionable nextAction detail when ancestry fails with a classified kind (BI-08BE758C)", async () => {
    const r = await resolveLiveInstallReadiness(
      { featureSha: FEATURE },
      deps({
        isAncestor: async () => ({ contained: null, failureKind: "no-repo" }),
      }),
    );
    expect(r.verdict).toBe("BLOCKED");
    expect(r.nextAction.detail).toMatch(/DPF_REPO_ROOT/);
  });

  it("MUST-ADVANCE when the served identity is a content-hash (not comparable)", async () => {
    const r = await resolveLiveInstallReadiness(
      { featureSha: FEATURE },
      deps({ readImage: async () => ({ raw: "c".repeat(64), source: "content-hash" }) }),
    );
    expect(r.verdict).toBe("MUST-ADVANCE");
  });

  it("BLOCKED when there is no image marker (not a built image)", async () => {
    const r = await resolveLiveInstallReadiness(
      { featureSha: FEATURE },
      deps({ readImage: async () => null }),
    );
    expect(r.verdict).toBe("BLOCKED");
    expect(r.nextAction.kind).toBe("file-blocker-bi");
  });

  it("does not call ancestry when the image is not a git-sha", async () => {
    let called = false;
    await resolveLiveInstallReadiness(
      { featureSha: FEATURE },
      deps({
        readImage: async () => ({ raw: "c".repeat(64), source: "content-hash" }),
        isAncestor: async () => {
          called = true;
          return null;
        },
      }),
    );
    expect(called).toBe(false);
  });
});
