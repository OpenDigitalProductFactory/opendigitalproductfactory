import { describe, expect, it, vi } from "vitest";
import { classifyInstallHost, readInstallHostProfile } from "./host-profile";

describe("classifyInstallHost", () => {
  it.each([
    ["consumer", false, "latest"],
    ["customer", false, "2026.08"],
    [null, false, "sha-abc"],
  ] as const)("classifies release evidence %s as consumer", (installMode, hasGitSource, imageTag) => {
    expect(classifyInstallHost({ installMode, hasGitSource, imageTag })).toMatchObject({
      kind: "consumer",
      sourceCapable: false,
      releaseImage: true,
    });
  });

  it.each(["customizer", "contributor", null] as const)(
    "classifies a Git-backed %s host as source-capable",
    (installMode) => {
      expect(classifyInstallHost({ installMode, hasGitSource: true, imageTag: null })).toMatchObject({
        kind: "source",
        sourceCapable: true,
      });
    },
  );

  it("fails closed when a consumer marker contradicts Git evidence", () => {
    expect(classifyInstallHost({ installMode: "consumer", hasGitSource: true, imageTag: "latest" })).toMatchObject({
      kind: "unknown",
      sourceCapable: false,
      reason: "contradictory-install-evidence",
    });
  });

  it("fails closed when no source or release evidence exists", () => {
    expect(classifyInstallHost({ installMode: null, hasGitSource: false, imageTag: null })).toMatchObject({
      kind: "unknown",
      sourceCapable: false,
      reason: "insufficient-install-evidence",
    });
  });
});

describe("readInstallHostProfile", () => {
  it("reads the in-container host mount instead of a host-only Windows path", async () => {
    const readText = vi.fn(async (path: string) => {
      expect(path).toBe("/host-dpf/.install-mode");
      return "consumer\n";
    });
    const pathExists = vi.fn(async (path: string) => {
      expect(path).toBe("/host-dpf/.git");
      return false;
    });

    await expect(readInstallHostProfile({
      hostRoot: "/host-dpf",
      env: { DPF_HOST_INSTALL_PATH: "D:\\DPF", DPF_IMAGE_TAG: "latest" },
      readText,
      pathExists,
    })).resolves.toMatchObject({ kind: "consumer", sourceCapable: false });
  });

  it("treats a missing marker as bounded evidence, not an exception", async () => {
    await expect(readInstallHostProfile({
      hostRoot: "/host-dpf",
      env: { DPF_IMAGE_TAG: "latest" },
      readText: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
      pathExists: async () => false,
    })).resolves.toMatchObject({ kind: "consumer", installMode: null });
  });
});

