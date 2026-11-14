import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const persisted = vi.hoisted(() => ({ envelope: vi.fn(), user: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { coworkerActionEnvelope: { findUnique: persisted.envelope }, user: { findUnique: persisted.user } } }));
vi.mock("@/lib/decision/caller-context", () => ({ WWMD_PLATFORM_PROFILE_ID: "mark-dpf-platform" }));
import { fingerprintCoworkerInput } from "@/lib/govern/authority/coworker-authority-decision";
import { defaultBalancePolicy } from "./investment-balance";
import { policyScopeKey, type PolicyRevision } from "./investment-balance-policy";
import { confirmPlatformFundingOwner, readPlatformFundingSetup } from "./platform-funding-setup";

const now = new Date("2026-11-14T12:00:00Z");
const installationId = `did_${"a".repeat(64)}`;
const scope = { principalId: "person-1", organizationId: "org-01", purpose: "shared-platform" as const };
const human = () => ({ id: "user-1", email: "owner@example.test", isActive: true, isSuperuser: false,
  automationVerificationId: null as string | null, automationProfile: null as string | null,
  automationSlot: null as number | null, automationExpiresAt: null as Date | null,
  groups: [{ platformRole: { roleId: "HR-000" } }] });
const initialProfile = () => ({ id: "profile-1", profileId: "mark-dpf-platform", name: "Platform policy", kind: "platform", status: "active",
  ownerPrincipalId: null as string | null, ownerOrganizationId: null as string | null,
  currentVersionId: "platform-v1", updatedAt: new Date("2026-11-13T00:00:00Z"),
  currentVersion: { versionId: "platform-v1", profileId: "mark-dpf-platform", materialFingerprint: "material-v1", promotedByPrincipalId: null } });

/** Transaction double proves service behavior and rollback, not PostgreSQL isolation. */
function fixture() {
  let profile = initialProfile();
  const configs = new Map<string, unknown>([["federation.identity", { deviceId: installationId }]]);
  let account = human();
  const principal = { id: "person-1", kind: "human", status: "active", displayName: "Test owner" };
  const organizations = Array.from({ length: 19 }, (_, index) => ({ id: `org-${String(index + 1).padStart(2, "0")}`, name: `Organization ${index + 1}`,
    topAccountablePrincipalId: index === 18 ? "another-owner" : principal.id, updatedAt: new Date("2026-11-13T00:00:00Z") }));
  let queue = Promise.resolve();
  const db = {
    user: { findUnique: vi.fn(async () => structuredClone(account)) },
    principal: {
      findFirst: vi.fn(async () => principal.kind === "human" && principal.status === "active" ? structuredClone(principal) : null),
      findUnique: vi.fn(async () => structuredClone(principal)),
    },
    organization: {
      findMany: vi.fn(async (args: { where: { topAccountablePrincipalId: string; id?: { gt: string } }; take: number }) => organizations
        .filter(org => org.topAccountablePrincipalId === args.where.topAccountablePrincipalId && (!args.where.id || org.id > args.where.id.gt)).slice(0, args.take)),
      findUnique: vi.fn(async (args: { where: { id: string } }) => structuredClone(organizations.find(org => org.id === args.where.id) ?? null)),
    },
    decisionPerspectiveProfile: {
      findUnique: vi.fn(async () => structuredClone(profile)),
      updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (Object.entries(args.where).some(([key, value]) => JSON.stringify(profile[key as keyof typeof profile]) !== JSON.stringify(value))) return { count: 0 };
        profile = { ...profile, ...args.data, updatedAt: new Date(now.getTime() + 1) };
        return { count: 1 };
      }),
    },
    platformConfig: {
      findUnique: vi.fn(async (args: { where: { key: string } }) => configs.has(args.where.key) ? { value: structuredClone(configs.get(args.where.key)) } : null),
      create: vi.fn(async (args: { data: { key: string; value: unknown } }) => {
        if (configs.has(args.data.key)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
        configs.set(args.data.key, structuredClone(args.data.value));
        return args.data;
      }),
    },
    $transaction: vi.fn(async <T>(fn: (tx: unknown) => Promise<T>, _options?: unknown): Promise<T> => {
      const prior = queue;
      let release!: () => void;
      queue = new Promise<void>(resolve => { release = resolve; });
      await prior;
      const beforeProfile = structuredClone(profile);
      const beforeConfigs = structuredClone(configs);
      try { return await fn(db); }
      catch (error) {
        profile = beforeProfile; configs.clear();
        for (const [key, value] of beforeConfigs) configs.set(key, value);
        throw error;
      } finally { release(); }
    }),
  };
  persisted.user.mockImplementation(async () => structuredClone(account));
  return { db, configs, principal, organizations, get profile() { return profile; }, get account() { return account; },
    changeAccount: (patch: Partial<ReturnType<typeof human>>) => { account = { ...account, ...patch }; },
    changeProfile: (patch: Partial<ReturnType<typeof initialProfile>>) => { profile = { ...profile, ...patch }; } };
}
type Fixture = ReturnType<typeof fixture>;
async function confirmation(f: Fixture) {
  const read = await readPlatformFundingSetup(f.db as never, { userId: "user-1" });
  if (!read.ok) throw new Error(read.error);
  const option = read.data.organizations[0];
  if (!option) throw new Error("Setup must expose an eligible organization.");
  return { organizationId: option.id, expectedDigest: option.expectedDigest, attestation: true, reason: "I confirm this exact initial platform ownership." };
}
function confirm(f: Fixture, params: Record<string, unknown>, context = { governedSource: "rest" as const }) {
  return confirmPlatformFundingOwner(f.db as never, { userId: "user-1", params, context });
}
function approve(params: Record<string, unknown>, patch: Record<string, unknown> = {}) {
  persisted.envelope.mockResolvedValue({ id: "approval-1", status: "approved", resolvedAt: new Date(now.getTime() - 1000),
    expiresAt: new Date(now.getTime() + 60_000), manifestActionId: "confirm_platform_funding_owner", delegatingUserId: "user-1", coworkerAgentId: "agent-1",
    inputFingerprint: fingerprintCoworkerInput(params), argsJson: { humanApproval: { userId: "user-1", approvedAt: new Date(now.getTime() - 2000).toISOString() } }, ...patch });
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); vi.clearAllMocks(); persisted.envelope.mockResolvedValue(null); });
afterEach(() => { vi.useRealTimers(); });

describe("explicit initial platform ownership setup", () => {
  it("exposes a bounded owner-confirmation preview without establishing ownership or changing policy", async () => {
    const f = fixture();
    const result = await readPlatformFundingSetup(f.db as never, { userId: "user-1" });
    expect(result).toMatchObject({ ok: true, data: { status: "available", installationId, person: { principalId: "person-1" }, nextCursor: "org-10" } });
    if (!result.ok) return;
    expect(result.data.organizations).toHaveLength(10);
    expect(result.data.organizations[0]).toMatchObject({ id: "org-01", allocation: { source: "default", active: true, revision: null, policy: { refactorPercent: 80 } } });
    expect(result.data.organizations[0]!.expectedDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(f.profile.ownerPrincipalId).toBeNull();
    expect(f.db.platformConfig.create).not.toHaveBeenCalled();
    const next = await readPlatformFundingSetup(f.db as never, { userId: "user-1", afterOrganizationId: result.data.nextCursor });
    expect(next).toMatchObject({ ok: true, data: { nextCursor: null } });
    if (next.ok) expect(next.data.organizations.map(org => org.id)).toEqual(Array.from({ length: 8 }, (_, i) => `org-${i + 11}`));
  });

  it("preserves an explicit expired allocation in the preview rather than substituting founder defaults", async () => {
    const f = fixture();
    const revision: PolicyRevision = { version: 1, revision: "00000000-0000-0000-0000-000000000001", previousRevision: null, scope,
      policy: { ...defaultBalancePolicy("organization", "shared-platform"), refactorPercent: 35 }, actorPrincipalId: "person-1", reason: "Existing target",
      effectiveAt: "2026-11-01T00:00:00Z", expiresAt: "2026-11-12T00:00:00Z" };
    f.configs.set(`${policyScopeKey(scope)}:current`, { revision: revision.revision });
    f.configs.set(`${policyScopeKey(scope)}:revision:${revision.revision}`, revision);
    const result = await readPlatformFundingSetup(f.db as never, { userId: "user-1" });
    expect(result).toMatchObject({ ok: true, data: { organizations: expect.arrayContaining([expect.objectContaining({ id: "org-01", allocation: { source: "explicit", active: false, revision, policy: revision.policy } })]) } });
  });

  it.each([
    { isActive: false }, { email: "automation@dpf.local" }, { automationVerificationId: "fixture" },
    { automationProfile: "platform_manager" }, { automationSlot: 0 }, { automationExpiresAt: new Date("2026-12-01T00:00:00Z") },
    { groups: [{ platformRole: { roleId: "HR-100" } }] },
  ])("refuses ineligible current human state %j", async patch => {
    const f = fixture(); f.changeAccount(patch);
    expect(await readPlatformFundingSetup(f.db as never, { userId: "user-1" })).toMatchObject({ ok: false, error: "funding-setup-not-authorized" });
  });

  it.each(["inactive", "non-human"])("does not infer ownership through an %s principal", async state => {
    const f = fixture(); if (state === "inactive") f.principal.status = "inactive"; else f.principal.kind = "agent";
    expect(await readPlatformFundingSetup(f.db as never, { userId: "user-1" })).toMatchObject({ ok: false, error: "funding-setup-not-authorized" });
  });

  it.each([
    [null, "org-01", "partial-or-conflicting"], ["person-1", null, "partial-or-conflicting"],
    ["another-person", "another-org", "already-recorded"],
  ])("shows existing ownership %s / %s without an overwrite control", async (ownerPrincipalId, ownerOrganizationId, status) => {
    const f = fixture(); f.changeProfile({ ownerPrincipalId, ownerOrganizationId });
    expect(await readPlatformFundingSetup(f.db as never, { userId: "user-1" })).toMatchObject({ ok: true, data: { status, organizations: [] } });
  });

  it("reports unavailable profile or installation state honestly", async () => {
    const f = fixture(); f.configs.delete("federation.identity");
    expect(await readPlatformFundingSetup(f.db as never, { userId: "user-1" })).toMatchObject({ ok: true, data: { status: "unavailable", organizations: [] } });
    f.configs.set("federation.identity", { deviceId: installationId }); f.changeProfile({ status: "retired" });
    expect(await readPlatformFundingSetup(f.db as never, { userId: "user-1" })).toMatchObject({ ok: true, data: { status: "unavailable", organizations: [] } });
  });

  it("records only the authenticated person's initial ownership and its immutable audit", async () => {
    const f = fixture(); const params = await confirmation(f); const originalConfigs = structuredClone(f.configs);
    const result = await confirm(f, params);
    expect(result).toMatchObject({ ok: true, data: { status: "confirmed", installationId, profileId: "mark-dpf-platform", principalId: "person-1", organizationId: "org-01" } });
    expect(f.profile).toMatchObject({ ownerPrincipalId: "person-1", ownerOrganizationId: "org-01", currentVersionId: "platform-v1", currentVersion: { promotedByPrincipalId: null } });
    expect(f.db.decisionPerspectiveProfile.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ ownerPrincipalId: null, ownerOrganizationId: null, updatedAt: new Date("2026-11-13T00:00:00Z") }), data: { ownerPrincipalId: "person-1", ownerOrganizationId: "org-01" } }));
    expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(f.configs.size).toBe(originalConfigs.size + 1);
    for (const [key, value] of originalConfigs) expect(f.configs.get(key)).toEqual(value);
    expect(f.db.platformConfig.create).toHaveBeenCalledTimes(1);
  });

  it("permits exactly the matching repeat while rechecking current after-state and authority", async () => {
    const f = fixture(); const params = await confirmation(f);
    const first = await confirm(f, params); const repeated = await confirm(f, params);
    expect(first).toMatchObject({ ok: true });
    expect(repeated).toMatchObject({ ok: true, data: { status: "already-recorded" } });
    expect(f.db.decisionPerspectiveProfile.updateMany).toHaveBeenCalledTimes(1);
    expect(f.db.platformConfig.create).toHaveBeenCalledTimes(1);
    expect(await confirm(f, { ...params, reason: "A different ownership claim" })).toMatchObject({ ok: false });
    f.changeProfile({ ownerOrganizationId: "different-org" });
    expect(await confirm(f, params)).toMatchObject({ ok: false });
  });

  it("does not let a copied audit authorize the same act on another installation", async () => {
    const f = fixture(); const params = await confirmation(f); await confirm(f, params);
    f.configs.set("federation.identity", { deviceId: `did_${"b".repeat(64)}` });
    expect(await confirm(f, params)).toMatchObject({ ok: false });
    expect(f.db.platformConfig.create).toHaveBeenCalledTimes(1);
  });

  it("does not trust a malformed completed audit as proof of an initial ownership act", async () => {
    const f = fixture(); const params = await confirmation(f); const first = await confirm(f, params);
    if (!first.ok) throw new Error(first.error);
    const audit = f.configs.get(first.data.auditKey) as { beforeState: { ownerPrincipalId: string | null } };
    audit.beforeState.ownerPrincipalId = "a-prior-owner";
    expect(await confirm(f, params)).toMatchObject({ ok: false, error: "funding-setup-conflict" });
    expect(f.db.decisionPerspectiveProfile.updateMany).toHaveBeenCalledTimes(1);
  });

  it.each(["account", "principal", "capability"])("rechecks current %s authority after the preview", async changed => {
    const f = fixture(); const params = await confirmation(f);
    if (changed === "account") f.changeAccount({ isActive: false });
    if (changed === "principal") f.principal.status = "inactive";
    if (changed === "capability") f.changeAccount({ groups: [{ platformRole: { roleId: "HR-100" } }] });
    expect(await confirm(f, params)).toMatchObject({ ok: false, error: "funding-setup-not-authorized" });
    expect(f.db.decisionPerspectiveProfile.updateMany).not.toHaveBeenCalled();
    expect(f.db.platformConfig.create).not.toHaveBeenCalled();
  });

  it.each(["updatedAt", "version", "revision", "organization", "profile", "installation"])("refuses a stale %s consequence", async change => {
    const f = fixture(); const params = await confirmation(f);
    if (change === "updatedAt") f.changeProfile({ updatedAt: new Date(now.getTime() + 1) });
    if (change === "version") f.changeProfile({ currentVersionId: "platform-v2", currentVersion: { ...f.profile.currentVersion, versionId: "platform-v2" } });
    if (change === "revision") {
      const revision: PolicyRevision = { version: 1, revision: "00000000-0000-0000-0000-000000000002", previousRevision: null, scope,
        policy: defaultBalancePolicy("founder", "shared-platform"), actorPrincipalId: "person-1", reason: "A newly saved allocation",
        effectiveAt: "2026-11-13T00:00:00Z", expiresAt: null };
      f.configs.set(`${policyScopeKey(scope)}:current`, { revision: revision.revision });
      f.configs.set(`${policyScopeKey(scope)}:revision:${revision.revision}`, revision);
    }
    if (change === "organization") f.organizations[0]!.topAccountablePrincipalId = "different-person";
    if (change === "profile") f.changeProfile({ ownerPrincipalId: "different-person", ownerOrganizationId: "org-01" });
    if (change === "installation") f.configs.set("federation.identity", { deviceId: `did_${"b".repeat(64)}` });
    expect(await confirm(f, params)).toMatchObject({ ok: false });
    expect(f.db.platformConfig.create).not.toHaveBeenCalled();
    expect(f.db.decisionPerspectiveProfile.updateMany).not.toHaveBeenCalled();
  });

  it("compares allocation validity again at confirmation", async () => {
    const f = fixture();
    const revision: PolicyRevision = { version: 1, revision: "00000000-0000-0000-0000-000000000001", previousRevision: null, scope,
      policy: defaultBalancePolicy("founder", "shared-platform"), actorPrincipalId: "person-1", reason: "Existing choice", effectiveAt: "2026-11-13T00:00:00Z", expiresAt: new Date(now.getTime() + 1000).toISOString() };
    f.configs.set(`${policyScopeKey(scope)}:current`, { revision: revision.revision }); f.configs.set(`${policyScopeKey(scope)}:revision:${revision.revision}`, revision);
    const params = await confirmation(f); vi.setSystemTime(new Date(now.getTime() + 2000));
    expect(await confirm(f, params)).toMatchObject({ ok: false, error: "funding-setup-stale" });
  });

  it("rolls back the owner write when immutable audit persistence fails", async () => {
    const f = fixture(); const params = await confirmation(f);
    f.db.platformConfig.create.mockRejectedValue(Object.assign(new Error("write conflict"), { code: "P2034" }));
    expect(await confirm(f, params)).toMatchObject({ ok: false, error: "funding-setup-stale" });
    expect(f.profile.ownerPrincipalId).toBeNull(); expect(f.profile.ownerOrganizationId).toBeNull();
    expect(f.configs.size).toBe(1);
  });

  it("never writes an audit after losing the owner comparison", async () => {
    const f = fixture(); const params = await confirmation(f); f.db.decisionPerspectiveProfile.updateMany.mockResolvedValue({ count: 0 });
    expect(await confirm(f, params)).toMatchObject({ ok: false, error: "funding-setup-stale" });
    expect(f.db.platformConfig.create).not.toHaveBeenCalled();
  });

  it("handles competing confirmations without replacing the winner", async () => {
    const f = fixture(); const params = await confirmation(f);
    const results = await Promise.all([confirm(f, params), confirm(f, { ...params, reason: "Competing confirmation" })]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(f.db.platformConfig.create).toHaveBeenCalledTimes(1);
    expect(f.profile.ownerPrincipalId).toBe("person-1");
  });

  it.each([
    { attestation: false }, { reason: " " }, { expectedDigest: "invalid" }, { principalId: "another-person" }, { humanApproval: { userId: "user-1" } },
  ])("rejects forged or incomplete confirmation parameters %j", async patch => {
    const f = fixture(); const params = await confirmation(f);
    expect(await confirm(f, { ...params, ...patch })).toMatchObject({ ok: false, error: "funding-setup-invalid-input" });
    expect(f.db.decisionPerspectiveProfile.updateMany).not.toHaveBeenCalled();
  });

  it.each([undefined, { governedSource: "external-jsonrpc" }, { governedSource: "internal-mcp-session" }, { governedSource: "rest", apiTokenId: "pat" }])("does not treat missing agent identity as direct-human provenance %j", async context => {
    const f = fixture(); const params = await confirmation(f);
    expect(await confirmPlatformFundingOwner(f.db as never, { userId: "user-1", params, context: context as never })).toMatchObject({ ok: false, error: "funding-setup-human-required" });
  });

  it("accepts the exact reserved same-user human decision for an agent", async () => {
    const f = fixture(); const params = await confirmation(f); approve(params);
    expect(await confirmPlatformFundingOwner(f.db as never, { userId: "user-1", params,
      context: { governedSource: "external-jsonrpc", agentId: "agent-1", approvedAuthorityEnvelopeId: "approval-1" } })).toMatchObject({ ok: true });
  });

  it.each(["policy-only", "on-behalf", "different-input", "expired"])("rejects a %s agent approval", async kind => {
    const f = fixture(); const params = await confirmation(f); approve(params);
    if (kind === "policy-only") approve(params, { argsJson: { policyAuthority: { interactionId: "DI-test" } } });
    if (kind === "on-behalf") approve(params, { argsJson: { humanApproval: { userId: "admin-2", by: "admin-2", onBehalfOf: "user-1", reason: "Administrator agrees", approvedAt: new Date(now.getTime() - 2000).toISOString() } } });
    if (kind === "different-input") approve({ ...params, reason: "different" });
    if (kind === "expired") approve(params, { expiresAt: new Date(now.getTime() - 1) });
    expect(await confirmPlatformFundingOwner(f.db as never, { userId: "user-1", params,
      context: { governedSource: "external-jsonrpc", agentId: "agent-1", approvedAuthorityEnvelopeId: "approval-1" } })).toMatchObject({ ok: false, error: "funding-setup-human-required" });
    expect(f.db.decisionPerspectiveProfile.updateMany).not.toHaveBeenCalled();
  });
});
