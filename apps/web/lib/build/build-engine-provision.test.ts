// apps/web/lib/build/build-engine-provision.test.ts
import { describe, expect, it } from "vitest";
import {
  selectRecipe,
  buildInstallCommand,
  type EngineRecipe,
} from "./build-engine-provision";

describe("selectRecipe", () => {
  const npm: EngineRecipe = { method: "npm-global", package: "p", muslSafe: true, requiresEgress: true, priority: 10 };
  const prestaged: EngineRecipe = { method: "prestaged-binary", stagedPath: "/opt/x", muslSafe: true, requiresEgress: false, priority: 20 };
  const native: EngineRecipe = { method: "curl-installer", command: "c", muslSafe: false, requiresEgress: true, priority: 5 };

  it("picks the lowest-priority musl-safe recipe online", () => {
    expect(selectRecipe([prestaged, npm], { offline: false })?.method).toBe("npm-global");
  });

  it("never picks a non-musl-safe recipe even if it has the lowest priority", () => {
    expect(selectRecipe([native, npm], { offline: false })?.method).toBe("npm-global");
  });

  it("offline drops egress recipes and falls back to the prestaged one", () => {
    expect(selectRecipe([npm, prestaged], { offline: true })?.method).toBe("prestaged-binary");
  });

  it("returns null when nothing is eligible", () => {
    expect(selectRecipe([npm], { offline: true })).toBeNull(); // npm needs egress
    expect(selectRecipe([native], { offline: false })).toBeNull(); // native not musl-safe
    expect(selectRecipe([], { offline: false })).toBeNull();
  });
});

describe("buildInstallCommand", () => {
  it("npm-global builds the global install command", () => {
    expect(buildInstallCommand({ method: "npm-global", package: "@openai/codex" }, "codex")).toBe(
      "npm install -g @openai/codex",
    );
  });

  it("prestaged-binary copies the staged binary into PATH", () => {
    expect(buildInstallCommand({ method: "prestaged-binary", stagedPath: "/opt/dpf-engines/grok" }, "grok")).toBe(
      "install -m 0755 /opt/dpf-engines/grok /usr/local/bin/grok",
    );
  });

  it("curl-installer requires an explicit command (never blind curl|sh)", () => {
    expect(buildInstallCommand({ method: "curl-installer" }, "grok")).toBeNull();
    expect(buildInstallCommand({ method: "curl-installer", command: "curl x | bash" }, "grok")).toBe("curl x | bash");
  });

  it("returns null when a method is missing its required field", () => {
    expect(buildInstallCommand({ method: "npm-global" }, "x")).toBeNull();
    expect(buildInstallCommand({ method: "prestaged-binary" }, "x")).toBeNull();
  });

  it("an explicit command overrides the npm-global default", () => {
    expect(buildInstallCommand({ method: "npm-global", package: "p", command: "custom" }, "x")).toBe("custom");
  });
});
