import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  prisma: {
    modelProvider: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    featureBuild: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));
vi.mock("@dpf/db", () => db);

const phaseResolution = vi.hoisted(() => ({ resolveModelSelectionByPhase: vi.fn() }));
vi.mock("@/lib/inference/phase-model-resolution", () => phaseResolution);

const schemaValidator = vi.hoisted(() => ({
  describeModel: vi.fn(),
  formatModelDescription: vi.fn(),
}));
vi.mock("@/lib/build/schema-validator", () => schemaValidator);

const sandbox = vi.hoisted(() => ({ execInSandbox: vi.fn() }));
vi.mock("@/lib/sandbox", () => sandbox);

const lazyNode = vi.hoisted(() => ({
  lazyPath: vi.fn(() => ({ resolve: (...parts: string[]) => parts.join("/") })),
  lazyFsPromises: vi.fn(() => ({ readFile: vi.fn(), readdir: vi.fn() })),
  getCwd: vi.fn(() => "/cwd"),
}));
vi.mock("@/lib/shared/lazy-node", () => lazyNode);

import { modelProviderPack } from "./model-provider-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "resolve_model_selection",
  "describe_model",
  "describe_committed_model",
  "add_provider",
  "update_provider_category",
];

const EXPECTED_GRANTS: Record<string, string[]> = {
  resolve_model_selection: ["work_capsule_read"],
  describe_committed_model: ["file_read"],
  describe_model: ["sandbox_execute"],
  add_provider: ["agent_control_read"],
  update_provider_category: ["agent_control_read"],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("model-provider pack — registration", () => {
  it("exposes exactly the five model & provider tools", () => {
    expect(modelProviderPack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(modelProviderPack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(modelProviderPack.packId).toBe("model-provider");
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of modelProviderPack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("preserves requiredCapability, sideEffect, and buildPhases metadata verbatim", () => {
    const byName = Object.fromEntries(modelProviderPack.definitions.map((d) => [d.name, d]));

    expect(byName.resolve_model_selection.requiredCapability).toBe("view_platform");
    expect(byName.resolve_model_selection.executionMode).toBe("immediate");
    expect(byName.resolve_model_selection.sideEffect).toBe(false);
    expect(byName.resolve_model_selection.buildPhases).toEqual(["ideate", "plan", "build", "review"]);
    expect(byName.resolve_model_selection.annotations).toEqual({ readOnlyHint: true, idempotentHint: true });

    expect(byName.describe_model.requiredCapability).toBe("view_platform");
    expect(byName.describe_model.executionMode).toBe("immediate");
    expect(byName.describe_model.sideEffect).toBe(false);
    expect(byName.describe_model.buildPhases).toEqual(["ideate", "plan", "build", "review"]);

    expect(byName.add_provider.requiredCapability).toBe("manage_provider_connections");
    expect(byName.add_provider.sideEffect).toBe(true);
    expect(byName.add_provider.executionMode).toBeUndefined();
    expect(byName.add_provider.buildPhases).toBeUndefined();

    expect(byName.update_provider_category.requiredCapability).toBe("manage_provider_connections");
    expect(byName.update_provider_category.sideEffect).toBe(true);
    expect(byName.update_provider_category.executionMode).toBeUndefined();
  });

  it("grants mirror agent-grants for every tool", () => {
    for (const t of EXPECTED_TOOLS) {
      expect(modelProviderPack.grants[t]).toEqual(EXPECTED_GRANTS[t]);
      expect(isToolAllowedByGrants(t, EXPECTED_GRANTS[t])).toBe(true);
    }
  });
});

describe("model-provider pack — handler behavior (delegation preserved)", () => {
  it("resolve_model_selection delegates and formats the verdict + summary", async () => {
    phaseResolution.resolveModelSelectionByPhase.mockResolvedValue({ verdict: "all-local", summary: "all phases local" });
    const res = await modelProviderPack.handlers.resolve_model_selection({}, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toBe("Model selection (all-local): all phases local");
    expect(phaseResolution.resolveModelSelectionByPhase).toHaveBeenCalled();
  });

  it("describe_model returns 'No active build' when the caller has none", async () => {
    db.prisma.featureBuild.findFirst.mockResolvedValue(null);
    const res = await modelProviderPack.handlers.describe_model({ model_name: "User" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("No active build.");
  });

  it("describe_model requires model_name", async () => {
    db.prisma.featureBuild.findFirst.mockResolvedValue({ buildId: "FB-1" });
    const res = await modelProviderPack.handlers.describe_model({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("model_name is required.");
  });

  it("describe_model reads the project schema directly and formats the description", async () => {
    db.prisma.featureBuild.findFirst.mockResolvedValue({ buildId: "FB-1" });
    lazyNode.lazyFsPromises.mockReturnValue({
      readdir: vi.fn().mockResolvedValue(["core-identity.prisma"]),
      readFile: vi.fn().mockResolvedValue("model User {}"),
    });
    schemaValidator.describeModel.mockReturnValue({ name: "User", fields: [] });
    schemaValidator.formatModelDescription.mockReturnValue("User: no fields");
    const res = await modelProviderPack.handlers.describe_model({ model_name: "User" }, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toBe("User: no fields");
    expect(schemaValidator.describeModel).toHaveBeenCalledWith("model User {}", "User");
  });

  it("add_provider creates an unconfigured provider and returns its id", async () => {
    db.prisma.modelProvider.findUnique.mockResolvedValue(null);
    db.prisma.modelProvider.create.mockResolvedValue({ providerId: "mantis", name: "Mantis" });
    const res = await modelProviderPack.handlers.add_provider(
      { providerId: "Mantis", name: "Mantis", category: "local" },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("mantis");
    expect(db.prisma.modelProvider.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ providerId: "mantis", category: "local", status: "unconfigured" }) }),
    );
  });

  it("add_provider rejects a duplicate provider id", async () => {
    db.prisma.modelProvider.findUnique.mockResolvedValue({ providerId: "mantis" });
    const res = await modelProviderPack.handlers.add_provider(
      { providerId: "mantis", name: "Mantis", category: "local" },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("Already exists");
    expect(db.prisma.modelProvider.create).not.toHaveBeenCalled();
  });

  it("update_provider_category updates an existing provider", async () => {
    db.prisma.modelProvider.findUnique.mockResolvedValue({ providerId: "mantis", name: "Mantis" });
    db.prisma.modelProvider.update.mockResolvedValue({});
    const res = await modelProviderPack.handlers.update_provider_category(
      { providerId: "mantis", category: "local" },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("mantis");
    expect(db.prisma.modelProvider.update).toHaveBeenCalledWith({
      where: { providerId: "mantis" },
      data: { category: "local" },
    });
  });

  it("update_provider_category reports a missing provider", async () => {
    db.prisma.modelProvider.findUnique.mockResolvedValue(null);
    const res = await modelProviderPack.handlers.update_provider_category(
      { providerId: "ghost", category: "local" },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("Not found");
    expect(db.prisma.modelProvider.update).not.toHaveBeenCalled();
  });
});
