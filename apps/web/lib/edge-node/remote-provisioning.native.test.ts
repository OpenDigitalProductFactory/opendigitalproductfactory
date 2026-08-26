// BI-BB919901 — the native edge-node install path.
//
// The defect this closes: the module gated the native download on a hardcoded
// "not published for download yet" comment. publish-release.yml began attaching
// dpf-edge-node-darwin-arm64, dpf-edge-node-windows-amd64.exe and a SHA-256
// manifest to every release, and the portal went on withholding them — offering
// Windows and macOS operators only the Docker Desktop path, which cannot see the
// host's real LAN.
//
// So the first test here is the regression: given a release that carries the
// asset, the native command IS offered.

import { describe, expect, it } from "vitest";

import {
  NATIVE_ASSET_BY_TARGET,
  NATIVE_CHECKSUMS_ASSET,
  buildRemoteProvisioningPlan,
  hasChecksumManifest,
  renderEdgeInstallCommands,
  resolveNativeTarget,
} from "./remote-provisioning";

/** What the live releases actually publish today, verified 2026-08-25. */
const PUBLISHED_TODAY = [
  "dpf-edge-node-darwin-arm64",
  "dpf-edge-node-windows-amd64.exe",
  NATIVE_CHECKSUMS_ASSET,
];

const release = (assetNames: readonly string[] = PUBLISHED_TODAY) => ({
  tag: "v2026.08.25-consumer-self-upgrade.2",
  assetNames,
});

const base = {
  authorityUrl: "https://portal.example.internal:3000",
  bootstrapToken: "edgeboot_testtoken",
};

describe("resolveNativeTarget", () => {
  it("finds the published target for each OS", () => {
    expect(resolveNativeTarget("macos", PUBLISHED_TODAY)).toBe("darwin-arm64");
    expect(resolveNativeTarget("windows", PUBLISHED_TODAY)).toBe("windows-amd64");
  });

  it("returns null for an OS this release publishes nothing for", () => {
    // No linux asset is attached today; Linux containers already see the real
    // LAN via host networking, so this is a gap rather than a blocker.
    expect(resolveNativeTarget("linux", PUBLISHED_TODAY)).toBeNull();
  });

  it("returns null when the release carries no assets at all", () => {
    for (const os of ["linux", "macos", "windows"] as const) {
      expect(resolveNativeTarget(os, [])).toBeNull();
    }
  });

  it("prefers the first target in the OS preference order", () => {
    const both = [
      NATIVE_ASSET_BY_TARGET["darwin-amd64"],
      NATIVE_ASSET_BY_TARGET["darwin-arm64"],
    ];
    expect(resolveNativeTarget("macos", both)).toBe("darwin-arm64");
  });

  it("falls back to the second target when only that one is published", () => {
    expect(resolveNativeTarget("macos", [NATIVE_ASSET_BY_TARGET["darwin-amd64"]])).toBe(
      "darwin-amd64",
    );
  });
});

describe("the regression: a published asset must be offered", () => {
  it("offers the native command on macOS when the release carries it", () => {
    const commands = renderEdgeInstallCommands({
      ...base,
      os: "macos",
      nativeRelease: release(),
    });
    const native = commands.find((command) => command.kind === "native");
    expect(native).toBeDefined();
    expect(native?.worksToday).toBe(true);
    expect(native?.command).toContain("dpf-edge-node-darwin-arm64");
  });

  it("offers the native command on Windows when the release carries it", () => {
    const commands = renderEdgeInstallCommands({
      ...base,
      os: "windows",
      nativeRelease: release(),
    });
    const native = commands.find((command) => command.kind === "native");
    expect(native?.shell).toBe("powershell");
    expect(native?.command).toContain("dpf-edge-node-windows-amd64.exe");
  });

  it("leads with the native command, because it is the only path that sees the LAN", () => {
    for (const os of ["macos", "windows"] as const) {
      const commands = renderEdgeInstallCommands({ ...base, os, nativeRelease: release() });
      expect(commands[0]?.kind).toBe("native");
    }
  });

  it("still offers the container path as the fallback", () => {
    const commands = renderEdgeInstallCommands({
      ...base,
      os: "macos",
      nativeRelease: release(),
    });
    expect(commands.some((command) => command.kind === "container")).toBe(true);
  });
});

describe("never hand out a command that 404s", () => {
  it("offers no native command when the release publishes none for this OS", () => {
    const commands = renderEdgeInstallCommands({
      ...base,
      os: "linux",
      nativeRelease: release(),
    });
    expect(commands.every((command) => command.kind === "container")).toBe(true);
  });

  it("offers no native command when no release is supplied at all (air-gapped)", () => {
    const commands = renderEdgeInstallCommands({ ...base, os: "macos" });
    expect(commands.every((command) => command.kind === "container")).toBe(true);
  });

  it("offers no native command when the release has an empty asset list", () => {
    const commands = renderEdgeInstallCommands({
      ...base,
      os: "windows",
      nativeRelease: release([]),
    });
    expect(commands.every((command) => command.kind === "container")).toBe(true);
  });
});

describe("supply chain", () => {
  it("verifies the download against the published checksum manifest", () => {
    const [native] = renderEdgeInstallCommands({
      ...base,
      os: "macos",
      nativeRelease: release(),
    });
    expect(native?.command).toContain(NATIVE_CHECKSUMS_ASSET);
    expect(native?.command).toContain("shasum -a 256");
  });

  it("uses sha256sum on Linux and shasum on macOS", () => {
    const linux = renderEdgeInstallCommands({
      ...base,
      os: "linux",
      nativeRelease: release([NATIVE_ASSET_BY_TARGET["linux-amd64"], NATIVE_CHECKSUMS_ASSET]),
    })[0];
    expect(linux?.command).toContain("sha256sum");
    expect(linux?.command).not.toContain("shasum");
  });

  it("keeps the published filename, because the manifest is keyed on it", () => {
    const [native] = renderEdgeInstallCommands({
      ...base,
      os: "macos",
      nativeRelease: release(),
    });
    // A rename to a friendlier name would silently break `-c` verification.
    expect(native?.command).not.toMatch(/-o ['"]?dpf-edge-node['"]?\s/);
  });

  it("says plainly when a release ships no manifest, rather than pretending", () => {
    const [native] = renderEdgeInstallCommands({
      ...base,
      os: "macos",
      nativeRelease: release(["dpf-edge-node-darwin-arm64"]),
    });
    expect(native?.command).not.toContain(NATIVE_CHECKSUMS_ASSET);
    expect(native?.note).toContain("NOT verified");
  });

  it("reports manifest presence", () => {
    expect(hasChecksumManifest(PUBLISHED_TODAY)).toBe(true);
    expect(hasChecksumManifest(["dpf-edge-node-darwin-arm64"])).toBe(false);
  });
});

describe("credential handling", () => {
  // Tailscale's auth-key guidance: a key passed as an argv flag is visible to
  // every other process on the host while the command runs. Ours is single-use,
  // so the exposure is bounded, but the env form costs nothing.
  it("passes the bootstrap token as an environment variable, never an argv flag", () => {
    for (const os of ["macos", "windows"] as const) {
      const [native] = renderEdgeInstallCommands({ ...base, os, nativeRelease: release() });
      expect(native?.command).toContain("DPF_BOOTSTRAP_TOKEN");
      expect(native?.command).not.toMatch(/--(token|bootstrap-token|authkey)[= ]/);
    }
  });

  it("runs --preflight before enrolling, so a bad connection names itself", () => {
    const [native] = renderEdgeInstallCommands({
      ...base,
      os: "macos",
      nativeRelease: release(),
    });
    expect(native?.command).toContain("--preflight");
  });
});

describe("buildRemoteProvisioningPlan", () => {
  it("tells the operator the native path is available when it is", () => {
    const plan = buildRemoteProvisioningPlan({
      resolvedAuthorityUrl: base.authorityUrl,
      bootstrapToken: base.bootstrapToken,
      os: "macos",
      nativeRelease: release(),
    });
    expect(plan.commands[0]?.kind).toBe("native");
    expect(plan.nativeBinaryNote).toContain("sees the real network");
    expect(plan.nativeBinaryNote).not.toContain("not published");
  });

  it("explains the absence honestly when no asset exists for the host", () => {
    const plan = buildRemoteProvisioningPlan({
      resolvedAuthorityUrl: base.authorityUrl,
      bootstrapToken: base.bootstrapToken,
      os: "linux",
      nativeRelease: release(),
    });
    expect(plan.nativeBinaryNote).toContain("No native agent is published");
    expect(plan.commands.every((command) => command.kind === "container")).toBe(true);
  });

  it("still flags an unreachable Authority URL alongside the native command", () => {
    const plan = buildRemoteProvisioningPlan({
      resolvedAuthorityUrl: "http://localhost:3000",
      bootstrapToken: base.bootstrapToken,
      os: "windows",
      nativeRelease: release(),
    });
    expect(plan.authorityUrlIssues).toContain("loopback");
    expect(plan.commands[0]?.kind).toBe("native");
  });
});
