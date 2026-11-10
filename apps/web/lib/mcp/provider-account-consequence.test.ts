import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ stance: vi.fn(), account: vi.fn(), job: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { aiProviderConnection: { findUnique: mocks.account }, scheduledJob: { findUnique: mocks.job } } }));
vi.mock("@/lib/install/instance-stance", () => ({ loadInstanceStance: mocks.stance, prismaInstanceStanceStore: () => ({}) }));

import { providerAccountDefinitions } from "./packs/provider-account-tools";
import { resolveCallConsequence } from "@/lib/tool-consequence";
import { resolveEscalation } from "@/lib/govern/authority/escalation-gate";

const tool = providerAccountDefinitions.find((t) => t.name === "manage_provider_account")!;
const classify = (params: Record<string, unknown>) => resolveCallConsequence(tool, { toolName: tool.name, params, userId: "owner" });
const local = { connectionId: "provider-default-local", providerId: "local", authMethod: "local", executionChannel: "local-runtime", credentialEntryId: null, organizationId: null };
const disable = { operation: "disable", connectionId: local.connectionId };

describe("stopping a persisted quota-recovery commission", () => {
  const params = { operation: "stop-quota-recovery", connectionId: "provider-default-chatgpt" };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stance.mockResolvedValue({ environmentClass: "production", primaryPurpose: "operate-business" });
    mocks.account.mockResolvedValue({ connectionId: params.connectionId, providerId: "chatgpt", organizationId: null, status: "paused" });
    mocks.job.mockResolvedValue({ metadata: { kind: "subscription-quota-recovery", version: 1, modelId: "target", hourly: true } });
  });
  it("narrows only the existing commission without restoring an account or invoking a provider", async () => {
    expect((await classify(params)).consequence).toBeNull();
    expect(tool.requiredCapability).toBe("manage_provider_connections");
  });
  it.each([{ ...params, hourly: true }, { ...params, modelId: "different" }, { ...params, providerId: "codex" }, { ...params, force: true }])("retains authority for extra or mismatched effects: %j", async request => {
    expect((await classify(request)).consequence).toBe("authority");
  });
  it("retains authority if no valid owned commission is proven", async () => {
    mocks.job.mockResolvedValue(null);
    expect((await classify(params)).consequence).toBe("authority");
    mocks.job.mockResolvedValue({ metadata: { kind: "different", version: 1, modelId: "target", hourly: true } });
    expect((await classify(params)).consequence).toBe("authority");
  });
});

describe("active DEV subscription verification", () => {
  const account = { connectionId: "provider-default-chatgpt", providerId: "chatgpt", authMethod: "oauth", status: "active", credentialEntryId: "owned", organizationId: null };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stance.mockResolvedValue({ environmentClass: "development", primaryPurpose: "evolve-dpf" });
    mocks.account.mockResolvedValue(account);
  });
  it.each(["chatgpt", "codex"])("verifies the active default %s through recorded delegation", async providerId => {
    mocks.account.mockResolvedValue({ ...account, providerId, connectionId: `provider-default-${providerId}` });
    const consequence = (await classify({ operation: "test", providerId, connectionId: `provider-default-${providerId}` })).consequence;
    expect(consequence).toBeNull();
    const base = { action: { sideEffect: true, executionMode: "immediate" as const, consequence }, dataPolicy: { sensitivity: "internal" as const }, operatorRequiresApproval: true };
    expect(resolveEscalation({ ...base, steering: "connection-delegation" }).verdict).toBe("automated");
    expect(resolveEscalation({ ...base, steering: "none" }).verdict).toBe("human");
    expect(resolveEscalation({ ...base, steering: "connection-delegation", dataPolicy: { sensitivity: "restricted" } }).verdict).toBe("human");
    expect(resolveEscalation({ ...base, steering: "connection-delegation", proposeBoundary: true }).verdict).toBe("human");
  });
  it.each([
    { ...account, status: "inactive" }, { ...account, status: "disabled" }, { ...account, status: "disconnected" },
    { ...account, organizationId: "peer" }, { ...account, credentialEntryId: null },
    { ...account, authMethod: "api-key" }, { ...account, connectionId: "additional-account" }, null,
  ])("keeps other persisted account effects consequential: %j", async persisted => {
    mocks.account.mockResolvedValue(persisted);
    expect((await classify({ operation: "test", connectionId: account.connectionId })).consequence).toBe("authority");
  });
  it.each([{}, { environmentClass: "production", primaryPurpose: "evolve-dpf" }, { environmentClass: "development", primaryPurpose: "operate-business" }])("requires proven DEV maintenance stance: %j", async stance => {
    mocks.stance.mockResolvedValue(stance);
    expect((await classify({ operation: "test", connectionId: account.connectionId })).consequence).toBe("authority");
  });
  it.each([{ secretRef: "replacement" }, { environmentClass: "development" }, { providerId: "openai" }])("does not trust configuration or environment assertions: %j", async extra => {
    expect((await classify({ operation: "test", connectionId: account.connectionId, ...extra })).consequence).toBe("authority");
  });
});

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


describe("bounded DEV restoration of the persisted operator pause", () => {
  const params = { operation: "restore-pause", connectionId: local.connectionId, expectedOperationId: "original-pause" };
  const source = () => ({ jobId: "provider-pause-local", enabled: true, lastStatus: "resumed", metadata: { kind: "operator-provider-pause", version: 1, providerId: "local", operationId: "original-pause", actorId: "original-operator", pausedAt: new Date(Date.now() - 120_000).toISOString(), resumedAt: new Date(Date.now() - 60_000).toISOString(), resumeAt: new Date(Date.now() + 3_600_000).toISOString(), priorProviderStatus: "active", priorConnectionStatus: "active" } });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stance.mockResolvedValue({ environmentClass: "development", primaryPurpose: "evolve-dpf" });
    mocks.account.mockResolvedValue({ ...local, status: "active" });
    mocks.job.mockResolvedValue(source());
  });
  it("narrows only restoration of the exact existing future pause", async () => {
    expect((await classify(params)).consequence).toBeNull();
    expect((await classify({ operation: "enable", connectionId: local.connectionId, providerId: "local" })).consequence).toBe("authority");
    expect(tool.requiredCapability).toBe("manage_provider_connections");
  });
  it.each([{ expectedOperationId: "different" }, { actorId: "spoof" }, { resumeAt: "2030-01-01" }, { force: true }, { providerId: "ollama" }])("keeps malformed, expanded or foreign effects consequential: %j", async extra => {
    expect((await classify({ ...params, ...extra })).consequence).toBe("authority");
  });
  it.each([null, { ...local, status: "disabled" }, { ...local, status: "active", credentialEntryId: "key" }, { ...local, status: "active", organizationId: "peer" }])("keeps ineligible persisted accounts consequential: %j", async account => {
    mocks.account.mockResolvedValue(account);
    expect((await classify(params)).consequence).toBe("authority");
  });
  it.each(["production", "staging"])("never narrows %s authority", async environmentClass => {
    mocks.stance.mockResolvedValue({ environmentClass, primaryPurpose: "evolve-dpf" });
    expect((await classify(params)).consequence).toBe("authority");
  });
  it.each(["newer", "expired", "malformed", "indefinite"])("retains authority for %s source", async kind => {
    const job = source();
    if (kind === "newer") job.metadata.operationId = "newer-pause";
    if (kind === "expired") job.metadata.resumeAt = new Date(Date.now() - 1).toISOString();
    if (kind === "malformed") job.metadata.kind = "different";
    if (kind === "indefinite") job.metadata.resumeAt = null as unknown as string;
    mocks.job.mockResolvedValue(job);
    expect((await classify(params)).consequence).toBe("authority");
  });
  it("preserves the exact original enable approval binding", async () => {
    const { buildCoworkerApprovalBinding } = await import("@/lib/govern/authority/coworker-authority-decision");
    const { buildEffectiveAuthContext } = await import("@/lib/identity/effective-auth-context");
    const authContext = buildEffectiveAuthContext({ user: { id: "owner", type: "admin", platformRole: null, isSuperuser: false, accountId: null, contactId: null }, grantedCapabilities: [], actingHumanUserId: "owner", actingAgentId: "agent" });
    const binding = buildCoworkerApprovalBinding({ authContext, action: { toolName: "manage_provider_account", requiredCapability: "manage_provider_connections", agentGrantAllowed: true, sideEffect: true, executionMode: "immediate", routeContext: null, approvalPolicy: "side-effects" }, integration: { required: false, state: "not-required" }, rawParams: { operation: "enable", providerId: "local", connectionId: "provider-default-local" }, subject: { kind: "platform", id: "dpf" }, dataPolicy: { sensitivity: "internal", maskingRequired: false, maskingSatisfied: true, decisionVersionsCurrent: true, decisionVersionIds: ["coworker-authority-v1"] } });
    expect(binding).toEqual({ actingHumanUserId: "owner", actingAgentId: "agent", chainId: null, taskRunId: null, toolName: "manage_provider_account", subject: { kind: "platform", id: "dpf" }, routeContext: null, inputFingerprint: "35cadae30ace6d7b044cb464ef3ab710aece0ec3efa237b0443a675b3007f562", sensitivity: "internal", decisionVersionFingerprint: "5405b8f3656e47f6aab8a1bcf7e33642277732782683ab5fbd49de10fde910ce" });
  });
});
