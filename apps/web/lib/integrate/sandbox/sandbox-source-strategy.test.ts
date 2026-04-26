// apps/web/lib/sandbox-source-strategy.test.ts
// Pure-function tests only — do NOT test Docker commands (those are integration tests)

import { describe, it, expect } from "vitest";
import {
  buildTarExcludeFlags,
  buildSourcePaths,
  buildWorkspaceAppsWebCopyCommand,
  buildWorkspacePackagesCopyCommand,
  buildWorkspaceRootProbeCommand,
  buildWorkspaceScriptsCopyCommand,
  LocalSourceStrategy,
  getSourceStrategy,
} from "./sandbox-source-strategy";

describe("buildTarExcludeFlags", () => {
  it("returns an array", () => {
    expect(Array.isArray(buildTarExcludeFlags())).toBe(true);
  });

  it("returns 7 flags (one per excluded pattern)", () => {
    expect(buildTarExcludeFlags()).toHaveLength(7);
  });

  it("includes --exclude=node_modules", () => {
    expect(buildTarExcludeFlags()).toContain("--exclude=node_modules");
  });

  it("includes --exclude=.next", () => {
    expect(buildTarExcludeFlags()).toContain("--exclude=.next");
  });

  it("includes --exclude=.git", () => {
    expect(buildTarExcludeFlags()).toContain("--exclude=.git");
  });

  it("includes --exclude=.env*", () => {
    expect(buildTarExcludeFlags()).toContain("--exclude=.env*");
  });

  it("includes --exclude=docker-compose*.yml", () => {
    expect(buildTarExcludeFlags()).toContain("--exclude=docker-compose*.yml");
  });

  it("includes --exclude=Dockerfile*", () => {
    expect(buildTarExcludeFlags()).toContain("--exclude=Dockerfile*");
  });

  it("includes --exclude=backups", () => {
    expect(buildTarExcludeFlags()).toContain("--exclude=backups");
  });

  it("all flags start with --exclude=", () => {
    const flags = buildTarExcludeFlags();
    expect(flags.every((f) => f.startsWith("--exclude="))).toBe(true);
  });
});

describe("LocalSourceStrategy", () => {
  it("is a class (typeof is function)", () => {
    expect(typeof LocalSourceStrategy).toBe("function");
  });

  it("implements SandboxSourceStrategy — has initializeWorkspace method", () => {
    const strategy = new LocalSourceStrategy();
    expect(typeof strategy.initializeWorkspace).toBe("function");
  });

  it("initializeWorkspace returns a Promise", () => {
    // We do not actually call Docker here — just verify the shape.
    // Pass a no-op mock via subclass would require extra plumbing,
    // so we verify the method signature is async (returns a thenable).
    const strategy = new LocalSourceStrategy();
    // Calling with obviously bad args — it will reject, but must be a Promise
    const result = strategy.initializeWorkspace("fake-id", "fake-build");
    expect(result).toBeInstanceOf(Promise);
    // Swallow the rejection so vitest doesn't flag an unhandled rejection
    result.catch(() => {});
  });
});

describe("buildSourcePaths", () => {
  it("uses the active workspace when provided", () => {
    expect(buildSourcePaths("/workspace")).toEqual({
      rootConfigDir: "/workspace",
      packagesDir: "/workspace/packages",
      webAppDir: "/workspace/apps/web",
    });
  });

  it("trims the active workspace path", () => {
    expect(buildSourcePaths("  /custom/root  ")).toEqual({
      rootConfigDir: "/custom/root",
      packagesDir: "/custom/root/packages",
      webAppDir: "/custom/root/apps/web",
    });
  });

  it("falls back to image-bundled source when no active workspace is set", () => {
    expect(buildSourcePaths(null)).toEqual({
      rootConfigDir: "/app",
      packagesDir: "/app/packages-src",
      webAppDir: "/app/apps/web-src",
    });
  });
});

describe("buildWorkspaceRootProbeCommand", () => {
  it("keeps PROJECT_ROOT as a shell variable instead of JS interpolation", () => {
    expect(buildWorkspaceRootProbeCommand("dpf-portal-1")).toContain("${PROJECT_ROOT}");
  });

  it("targets the requested portal container", () => {
    expect(buildWorkspaceRootProbeCommand("portal-123")).toContain("docker exec portal-123 sh -lc");
  });
});

describe("workspace copy commands", () => {
  it("copies packages into /workspace/packages", () => {
    const command = buildWorkspacePackagesCopyCommand("portal-1", "sandbox-1", "/workspace/packages");

    expect(command).toContain("docker exec portal-1 tar -cf - -C /workspace/packages .");
    expect(command).toContain("mkdir -p /workspace/packages");
  });

  it("copies apps/web without node_modules or .next artifacts", () => {
    const command = buildWorkspaceAppsWebCopyCommand("portal-1", "sandbox-1", "/workspace/apps/web");

    expect(command).toContain("--exclude='node_modules'");
    expect(command).toContain("--exclude='.next'");
    expect(command).toContain("--exclude='tsconfig.tsbuildinfo'");
    expect(command).toContain("mkdir -p /workspace/apps/web");
  });

  it("copies root scripts from the active source root", () => {
    const command = buildWorkspaceScriptsCopyCommand("portal-1", "sandbox-1", "/workspace");

    expect(command).toContain("tar -cf - -C /workspace scripts");
    expect(command).toContain("docker exec -i sandbox-1 tar -xf - -C /workspace");
  });
});

describe("getSourceStrategy", () => {
  it("returns a LocalSourceStrategy for mode 'local'", () => {
    const strategy = getSourceStrategy("local");
    expect(strategy).toBeInstanceOf(LocalSourceStrategy);
  });

  it("returns a LocalSourceStrategy when called with no argument (defaults to local)", () => {
    const strategy = getSourceStrategy();
    expect(strategy).toBeInstanceOf(LocalSourceStrategy);
  });

  it("throws for an unknown mode", () => {
    expect(() => getSourceStrategy("unknown")).toThrow(
      'Unknown sandbox source mode: unknown. Only "local" is supported.',
    );
  });

  it("thrown error message includes the bad mode value", () => {
    expect(() => getSourceStrategy("s3")).toThrow("s3");
  });
});
