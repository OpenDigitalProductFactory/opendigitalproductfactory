import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  prisma: {
    modelProvider: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    aiProviderConnection: { findUnique: vi.fn() },
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

const accounts = vi.hoisted(() => ({ addProviderAccount: vi.fn(), configureProviderAccount: vi.fn(), setProviderAccountEnabled: vi.fn() }));
const pauseRestore = vi.hoisted(() => ({ restoreOperatorProviderPause: vi.fn() }));
vi.mock("@/lib/inference/provider-operator-pause", () => pauseRestore);
const accountRead = vi.hoisted(() => ({ getProviderAccounts: vi.fn() }));
const accountAuth = vi.hoisted(() => ({ testProviderAuthInternal: vi.fn() }));
vi.mock("@/lib/inference/provider-account-management", () => accounts);
vi.mock("@/lib/inference/ai-provider-data", () => accountRead);
vi.mock("@/lib/actions/provider-auth-test", () => accountAuth);

import { modelProviderPack } from "./model-provider-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "resolve_model_selection",
  "describe_model",
  "describe_committed_model",
  "add_provider",
  "update_provider_category",
  "get_provider_accounts",
  "manage_provider_account",
];

const EXPECTED_GRANTS: Record<string, string[]> = {
  resolve_model_selection: ["work_capsule_read"],
  describe_committed_model: ["file_read"],
  describe_model: ["sandbox_execute"],
  add_provider: ["agent_control_read"],
  update_provider_category: ["agent_control_read"],
  get_provider_accounts: ["agent_control_read"],
  manage_provider_account: ["agent_control_read"],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("model-provider pack — registration", () => {
  it("exposes all model and provider controls", () => {
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
  it("lists a bounded page and returns the last visible account as its continuation", async () => {
    accountRead.getProviderAccounts.mockResolvedValue([{ connectionId: "a" }, { connectionId: "b" }, { connectionId: "c" }]);
    const out = await modelProviderPack.handlers.get_provider_accounts({ providerId: "openai", limit: 2, cursor: "previous" }, "u1");
    expect(accountRead.getProviderAccounts).toHaveBeenCalledWith("openai", { limit: 3, cursor: "previous" });
    expect(out.data).toEqual({ accounts: [{ connectionId: "a" }, { connectionId: "b" }], nextCursor: "b" });
  });

  it("requires an account identity and refuses cross-provider operations before changing credentials", async () => {
    expect(await modelProviderPack.handlers.manage_provider_account({ operation: "configure", providerId: "openai" }, "u1")).toMatchObject({ success: false });
    db.prisma.aiProviderConnection.findUnique.mockResolvedValue({ providerId: "anthropic", connectionId: "b" });
    expect(await modelProviderPack.handlers.manage_provider_account({ operation: "configure", providerId: "openai", connectionId: "b", secretRef: "new" }, "u1")).toMatchObject({ success: false });
    expect(accounts.configureProviderAccount).not.toHaveBeenCalled();
  });

  it("configures and tests the selected account without a provider-wide authentication probe", async () => {
    db.prisma.aiProviderConnection.findUnique.mockResolvedValue({ providerId: "openai", connectionId: "b" });
    accounts.configureProviderAccount.mockResolvedValue({ ok: true });
    accountAuth.testProviderAuthInternal.mockResolvedValue({ ok: true, message: "Connected" });
    expect(await modelProviderPack.handlers.manage_provider_account({ operation: "configure", connectionId: "b", secretRef: "new" }, "u1")).toMatchObject({ success: true });
    expect(accounts.configureProviderAccount).toHaveBeenCalledWith({ connectionId: "b", secretRef: "new" });
    expect(await modelProviderPack.handlers.manage_provider_account({ operation: "test", connectionId: "b" }, "u1")).toMatchObject({ success: true });
    expect(accountAuth.testProviderAuthInternal).toHaveBeenCalledWith("openai", false, "b");
  });

  it("marks account secrets for audit redaction and retains the provider-management capability", () => {
    const definition = modelProviderPack.definitions.find((entry) => entry.name === "manage_provider_account")!;
    const fields = definition.inputSchema.properties as Record<string, { writeOnly?: boolean }>;
    expect(fields.secretRef.writeOnly).toBe(true);
    expect(fields.clientSecret.writeOnly).toBe(true);
    expect(definition.requiredCapability).toBe("manage_provider_connections");
  });

  it.each(["codex", "chatgpt"])("uses verification-only execution for the canonical %s subscription", async providerId => {
    const connectionId = `provider-default-${providerId}`;
    db.prisma.aiProviderConnection.findUnique.mockResolvedValue({ providerId, connectionId });
    accountAuth.testProviderAuthInternal.mockResolvedValue({ ok: true, message: "Verified" });
    expect(await modelProviderPack.handlers.manage_provider_account({ operation: "test", connectionId }, "u1")).toMatchObject({ success: true });
    expect(accountAuth.testProviderAuthInternal).toHaveBeenCalledWith(providerId, false, connectionId, { verificationOnly: true });
  });

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


describe("native exact pause restoration", () => {
  const request = { operation: "restore-pause", connectionId: "provider-default-local", providerId: "local", expectedOperationId: "original-pause" };
  beforeEach(() => {
    db.prisma.aiProviderConnection.findUnique.mockResolvedValue({ connectionId: request.connectionId, providerId: "local" });
    pauseRestore.restoreOperatorProviderPause.mockResolvedValue({ outcome: "restored", operationId: "new-pause", resumeAt: "2026-11-22T03:37:14.209Z", deliveryPending: false });
  });
  it("forwards only the governed server caller and persisted source generation", async () => {
    const result = await modelProviderPack.handlers.manage_provider_account(request, "trusted-caller");
    expect(result).toMatchObject({ success: true, data: { outcome: "restored", operationId: "new-pause", resumeAt: "2026-11-22T03:37:14.209Z" } });
    expect(pauseRestore.restoreOperatorProviderPause).toHaveBeenCalledExactlyOnceWith({ providerId: "local", connectionId: "provider-default-local", expectedOperationId: "original-pause", actorId: "trusted-caller" });
    expect(accounts.setProviderAccountEnabled).not.toHaveBeenCalled();
  });
  it.each([{ actorId: "spoofed" }, { resumeAt: "2030-01-01" }, { duration: { value: 1, unit: "days" } }, { force: true }, { expectedOperationId: "" }])("rejects arbitrary input before restoring: %j", async extra => {
    expect(await modelProviderPack.handlers.manage_provider_account({ ...request, ...extra }, "trusted-caller")).toMatchObject({ success: false });
    expect(pauseRestore.restoreOperatorProviderPause).not.toHaveBeenCalled();
  });
  it("refuses a nondefault selected account rather than acting on its provider default", async () => {
    db.prisma.aiProviderConnection.findUnique.mockResolvedValue({ connectionId: "additional-local-account", providerId: "local" });
    expect(await modelProviderPack.handlers.manage_provider_account({ ...request, connectionId: "additional-local-account" }, "trusted-caller")).toMatchObject({ success: false });
    expect(pauseRestore.restoreOperatorProviderPause).not.toHaveBeenCalled();
  });
  it("refuses a missing trusted caller", async () => {
    expect(await modelProviderPack.handlers.manage_provider_account(request, "")).toMatchObject({ success: false });
    expect(pauseRestore.restoreOperatorProviderPause).not.toHaveBeenCalled();
  });
  it("returns an actionable source conflict without reporting success", async () => {
    pauseRestore.restoreOperatorProviderPause.mockRejectedValue(new Error("Provider pause source changed; refresh before restoring"));
    const result = await modelProviderPack.handlers.manage_provider_account(request, "trusted-caller");
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/source changed/) });
  });
  it("exposes restoration through the existing account tool without actor or expiry fields", () => {
    const definition = modelProviderPack.definitions.find(d => d.name === "manage_provider_account")!;
    const properties = definition.inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(properties.operation.enum).toContain("restore-pause");
    expect(properties.expectedOperationId).toBeDefined();
    expect(properties.actorId).toBeUndefined();
    expect(properties.resumeAt).toBeUndefined();
  });
});
