import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ stance: vi.fn(), account: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { aiProviderConnection: { findUnique: mocks.account } } }));
vi.mock("@/lib/install/instance-stance", () => ({ loadInstanceStance: mocks.stance, prismaInstanceStanceStore: () => ({}) }));

import { providerAccountDefinitions } from "./packs/provider-account-tools";
import { resolveCallConsequence } from "@/lib/tool-consequence";
import { resolveEscalation } from "@/lib/govern/authority/escalation-gate";

const tool = providerAccountDefinitions.find((t) => t.name === "manage_provider_account")!;
const classify = (params: Record<string, unknown>) => resolveCallConsequence(tool, { toolName: tool.name, params, userId: "owner" });
const local = { connectionId: "provider-default-local", providerId: "local", authMethod: "local", executionChannel: "local-runtime", credentialEntryId: null, organizationId: null };
const disable = { operation: "disable", connectionId: local.connectionId };

describe("delegated DEV credentialless local containment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stance.mockResolvedValue({ environmentClass: "development", primaryPurpose: "evolve-dpf" });
    mocks.account.mockResolvedValue(local);
  });

  it.each(["local", "ollama"])("narrows disabling the canonical %s default", async (providerId) => {
    mocks.account.mockResolvedValue({ ...local, providerId, connectionId: `provider-default-${providerId}` });
    expect((await classify({ operation: "disable", connectionId: `provider-default-${providerId}`, providerId })).consequence).toBeNull();
  });

  it.each([
    { environmentClass: "production", primaryPurpose: "evolve-dpf" },
    { environmentClass: "staging", primaryPurpose: "evolve-dpf" },
    { environmentClass: "development", primaryPurpose: "operate-business" }, {},
  ])("retains authority for unproven DEV purpose: %j", async (stance) => {
    mocks.stance.mockResolvedValue(stance);
    expect((await classify(disable)).consequence).toBe("authority");
  });

  it.each([
    null, { ...local, providerId: "codex" }, { ...local, connectionId: "provider-account-local" },
    { ...local, credentialEntryId: "credential" }, { ...local, authMethod: "api-key" },
    { ...local, executionChannel: "direct-api" }, { ...local, organizationId: "peer" },
  ])("retains authority for ineligible persisted account: %j", async (account) => {
    mocks.account.mockResolvedValue(account);
    expect((await classify(disable)).consequence).toBe("authority");
  });

  it.each([
    { operation: "enable", connectionId: local.connectionId }, { operation: "disable" },
    { ...disable, connectionId: "" }, { ...disable, connectionId: 1 }, { ...disable, providerId: "codex" },
    { ...disable, providerId: 1 }, { ...disable, secretRef: "replacement" },
    { ...disable, force: true }, { ...disable, environmentClass: "development" },
  ])("retains authority for other or malformed requests: %j", async (params) => {
    expect((await classify(params)).consequence).toBe("authority");
  });

  it.each(["stance", "account"] as const)("fails closed when %s cannot be read", async (reader) => {
    mocks[reader].mockRejectedValue(new Error("unavailable"));
    expect((await classify(disable)).consequence).toBe("authority");
  });

  it("preserves catalog discovery and management capability", async () => {
    expect(tool.requiredCapability).toBe("manage_provider_connections");
    expect((await classify({ operation: "discover", connectionId: "account-a" })).consequence).toBeNull();
    expect(mocks.account).not.toHaveBeenCalled();
  });

  it("still requires delegation and observes restricted-data boundaries", async () => {
    const consequence = (await classify(disable)).consequence;
    const base = { action: { sideEffect: true, executionMode: "immediate" as const, consequence }, dataPolicy: { sensitivity: "internal" as const }, operatorRequiresApproval: true };
    expect(resolveEscalation({ ...base, steering: "connection-delegation" }).verdict).toBe("automated");
    expect(resolveEscalation({ ...base, steering: "none" }).verdict).toBe("human");
    expect(resolveEscalation({ ...base, steering: "connection-delegation", dataPolicy: { sensitivity: "restricted" } }).verdict).toBe("human");
  });
});
