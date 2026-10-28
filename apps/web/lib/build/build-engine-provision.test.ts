// apps/web/lib/build/build-engine-provision.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  selectRecipe,
  buildInstallCommand,
  PROVISIONED_ENGINE_BIN_DIR,
  PROVISIONED_ENGINE_PREFIX,
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
  it("npm-global installs into the provisioned-engine prefix, not /usr/local", () => {
    expect(buildInstallCommand({ method: "npm-global", package: "@openai/codex" }, "codex")).toBe(
      "npm install -g --prefix /opt/dpf-engines/provisioned @openai/codex",
    );
  });

  it("prestaged-binary copies the staged binary into the provisioned bin dir on PATH", () => {
    expect(buildInstallCommand({ method: "prestaged-binary", stagedPath: "/opt/dpf-engines/grok" }, "grok")).toBe(
      "mkdir -p /opt/dpf-engines/provisioned/bin && install -m 0755 /opt/dpf-engines/grok /opt/dpf-engines/provisioned/bin/grok",
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

// The sandbox root is read-only (agent sandbox containment design, AC-1): no
// registry recipe may write /usr/local, and every explicit command targets the
// provisioned-engine bin dir that Dockerfile.sandbox puts on PATH.
describe("build-engines.json recipes", () => {
  const registry = JSON.parse(
    readFileSync(new URL("../../../../packages/db/data/build-engines.json", import.meta.url), "utf8"),
  ) as Record<string, { binary: string; recipes: EngineRecipe[] }>;

  it("no recipe writes /usr/local", () => {
    for (const [engineId, engine] of Object.entries(registry)) {
      for (const recipe of engine.recipes) {
        const command = buildInstallCommand(recipe, engine.binary) ?? "";
        expect(command, `${engineId} ${recipe.method}`).not.toMatch(/\/usr\/local/);
      }
    }
  });

  it("every explicit installer command lands its binary in the provisioned bin dir", () => {
    expect(PROVISIONED_ENGINE_BIN_DIR).toBe(`${PROVISIONED_ENGINE_PREFIX}/bin`);
    for (const [engineId, engine] of Object.entries(registry)) {
      for (const recipe of engine.recipes.filter((r) => r.command)) {
        expect(recipe.command, engineId).toContain(`${PROVISIONED_ENGINE_BIN_DIR}/${engine.binary}`);
      }
    }
  });
});
