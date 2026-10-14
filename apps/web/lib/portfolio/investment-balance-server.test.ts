import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/decision/caller-context", () => ({ WWMD_PLATFORM_PROFILE_ID: "mark-dpf-platform" }));
vi.mock("@/lib/identity/principal-linking", () => ({ resolvePrincipalRecordIdForSessionIdentity: vi.fn(async () => "p1") }));
const roomAccess = vi.hoisted(() => vi.fn(async () => ({ decision: { level: "none" } })));
vi.mock("@/lib/work-management/workroom-agent-access.server", () => ({ resolveHumanWorkroomAccess: roomAccess }));
import { bindInvestmentFunding, loadBuildInvestmentContext, loadFundingAuthority, loadInvestmentStartPreferences, loadItemBalancePolicy, loadOwnerInvestmentPage, loadScopedBalancePolicy, loadScopedBalanceReport, projectItemInvestment, readInvestmentInstallationId, saveScopedBalancePolicy } from "./investment-balance-server";
import { defaultBalancePolicy } from "./investment-balance";

function fakeDb() {
  return {
    principal: { findUnique: vi.fn(async () => ({ id: "p1", kind: "human", status: "active" })) },
    principalAlias: { findMany: vi.fn(async () => [{ aliasValue: "u1" }]) },
    user: { findFirst: vi.fn(async () => ({ id: "u1" })) },
    organization: { findUnique: vi.fn(async () => ({ id: "org1", topAccountablePrincipalId: "p2" })) },
    decisionPerspectiveProfile: { findUnique: vi.fn(async () => ({ status: "active", ownerPrincipalId: "p1", ownerOrganizationId: "org1" })) },
    platformConfig: { findUnique: vi.fn(async () => null) },
  };
}
const scope = { principalId: "p1", organizationId: "org1", purpose: "shared-platform" as const };

describe("canonical funding authority reads", () => {
  it("keeps attribution-gap counts inside the organization for a non-founder owner", async () => {
    const base = fakeDb();
    base.organization.findUnique.mockResolvedValue({ id: "org1", topAccountablePrincipalId: "p1" });
    base.decisionPerspectiveProfile.findUnique.mockResolvedValue({ status: "active", ownerPrincipalId: "platform-owner", ownerOrganizationId: "platform-org" });
    base.platformConfig.findUnique.mockImplementation(async (args?: unknown) => (args as { where: { key: string } }).where.key === "federation.identity" ? { value: { deviceId: `did_${"a".repeat(64)}` } } as never : null);
    const query = vi.fn(async () => []);
    const result = await loadScopedBalanceReport({ ...base, $queryRaw: query } as never, scope);
    expect(result).toMatchObject({ ok: true, data: { ownerKind: "organization", attributionGap: { level: "organization", unassignedAttempts: 0 } } });
    expect(query.mock.calls.at(-1)?.slice(-2)).toEqual(["org1", "org1"]);
  });
  it("bounds owner listings and advances a stable organization cursor without crossing ownership", async () => {
    const organizations = Array.from({ length: 18 }, (_, i) => ({ id: `org-${String(i).padStart(2, "0")}`, name: `Organization ${i}` }));
    const findMany = vi.fn(async (args: { take: number; where: { id?: { gt: string } } }) => organizations.filter((org) => !args.where.id || org.id > args.where.id.gt).slice(0, args.take));
    const base = fakeDb();
    const db = { ...base, organization: { ...base.organization, findMany } };
    const first = await loadOwnerInvestmentPage(db as never, "u1");
    expect(first.views).toHaveLength(32);
    expect(first.nextCursor).toBe("org-15");
    const second = await loadOwnerInvestmentPage(db as never, "u1", first.nextCursor);
    expect(second.views).toHaveLength(4);
    expect(second.nextCursor).toBeNull();
    expect(second.views[0]?.scope.organizationId).toBe("org-16");
    expect(first.views.every((view) => view.scope.principalId === "p1")).toBe(true);
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 17, orderBy: { id: "asc" }, where: expect.objectContaining({ id: { gt: "org-15" }, OR: expect.arrayContaining([{ topAccountablePrincipalId: "p1" }]) }) }));
  });
  it("allows a funding owner to underwrite a portfolio managed by another person", async () => {
    const installationRef = `did_${"a".repeat(64)}`;
    const base = fakeDb();
    const db = { ...base, portfolio: { findUnique: vi.fn(async () => ({ accountablePrincipalId: "manager-b" })) }, platformConfig: { ...base.platformConfig, create: vi.fn(), update: vi.fn() }, $transaction: async (fn: (tx: unknown) => unknown) => fn(db) };
    db.platformConfig.findUnique.mockImplementation(async (args?: unknown) => (args as { where: { key: string } }).where.key === "federation.identity" ? { value: { deviceId: installationRef } } as never : null);
    const result = await bindInvestmentFunding(db as never, { userId: "u1", scope, target: { kind: "portfolio", id: "portfolio1", purpose: "shared-platform" }, expectedBoundAt: null, reason: "Fund our organization work in this portfolio" });
    expect(result).toMatchObject({ ok: true, data: { scope, portfolioAccountablePrincipalId: "manager-b" } });
    expect(db.platformConfig.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ key: expect.stringContaining('"org1","portfolio"') }) }));
  });
  it("requires reaffirmation after portfolio accountability changes, without transferring funding", async () => {
    const installationRef = `did_${"a".repeat(64)}`;
    const binding = { version: 1, scope, installationRef, actorPrincipalId: "p1", reason: "Fund portfolio", boundAt: "2026-01-01T00:00:00Z", portfolioAccountablePrincipalId: "manager-b" };
    const db = { ...fakeDb(), backlogItem: { findFirst: vi.fn(async () => ({ id: "item1", itemId: "BI-1", organizationId: "org1", scopeKind: "platform", portfolioId: "portfolio1" })) }, workroom: { findMany: vi.fn(async () => []) }, portfolio: { findUnique: vi.fn(async () => ({ accountablePrincipalId: "manager-c" })) } };
    db.platformConfig.findUnique.mockImplementation(async (args?: unknown) => {
      const key = (args as { where: { key: string } }).where.key;
      if (key === "federation.identity") return { value: { deviceId: installationRef } } as never;
      if (key.includes(":binding:")) return { value: binding } as never;
      return null;
    });
    expect(await loadItemBalancePolicy(db as never, { itemId: "BI-1" })).toMatchObject({ ok: false, error: "portfolio-accountability-changed" });
    expect(binding.scope.principalId).toBe("p1");
    db.portfolio.findUnique.mockResolvedValue({ accountablePrincipalId: "manager-b" });
    expect(await loadItemBalancePolicy(db as never, { itemId: "BI-1" })).toMatchObject({ ok: true, data: { scope } });
    db.backlogItem.findFirst.mockResolvedValue({ id: "item1", itemId: "BI-1", organizationId: "other-org", scopeKind: "platform", portfolioId: "portfolio1" });
    expect(await loadItemBalancePolicy(db as never, { itemId: "BI-1" })).toMatchObject({ ok: false, error: "funding-organization-mismatch" });
  });
  it("snapshots an evidenced repair classification for documentation without changing work type", async () => {
    const installationRef = `did_${"a".repeat(64)}`;
    const item = { id: "item1", itemId: "BI-1", organizationId: "org1", scopeKind: "platform", workType: "docs" };
    const binding = { version: 1, scope, installationRef, classification: "refactor", boundAt: "2026-10-13T00:00:00Z", reason: "Repair contradictory agent instructions" };
    const db = { ...fakeDb(), backlogItem: { findFirst: vi.fn(async () => item) }, workroom: { findMany: vi.fn(async () => [{ id: "room1" }]), findUnique: vi.fn(async () => ({ id: "room1", incomingRelations: [], promotionPolicy: { investmentBalanceV1: { bindings: { "BI-1": binding } } } })) }, featureBuild: { findFirst: vi.fn(async () => ({ originatingBacklogItemId: item.id })) } };
    db.platformConfig.findUnique.mockImplementation(async (args?: unknown) => (args as { where: { key: string } }).where.key === "federation.identity" ? { value: { deviceId: installationRef } } as never : null);
    const first = await loadBuildInvestmentContext(db as never, "FB-1");
    expect(first.snapshot?.investmentClass).toBe("refactor");
    expect(first.snapshot?.investmentPolicyRef).toContain("room1");
    binding.classification = "new";
    const second = await loadBuildInvestmentContext(db as never, "FB-1");
    expect(second.snapshot?.investmentClass).toBe("new");
    expect(first.snapshot?.investmentClass).toBe("refactor");
    expect(item.workType).toBe("docs");
  });
  it("rolls back an inserted revision when the current pointer loses its comparison", async () => {
    const base = fakeDb();
    const rollback = vi.fn();
    const db = { ...base, platformConfig: { ...base.platformConfig, create: vi.fn(), updateMany: vi.fn(async () => ({ count: 0 })) },
      $transaction: async (fn: (tx: unknown) => unknown) => { try { return await fn(db); } catch (error) { rollback(); throw error; } } };
    db.platformConfig.findUnique.mockResolvedValue({ value: { revision: "prior" } } as never);
    expect(await saveScopedBalancePolicy(db as never, { userId: "u1", scope, expectedRevision: "prior", reason: "Owner change", policy: defaultBalancePolicy("founder", "shared-platform") })).toMatchObject({ ok: false, error: "stale-revision" });
    expect(db.platformConfig.create).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledTimes(1);
  });
  it.each(["shared-platform", "archetype"] as const)("projects the same %s guidance to external agents and Build Studio", async (purpose) => {
    const fundedScope = { ...scope, purpose };
    const installationRef = `did_${"a".repeat(64)}`;
    const item = { id: "item1", itemId: "BI-1", organizationId: "org1", scopeKind: purpose === "archetype" ? "archetype-leaf" : "platform", workType: "bug" };
    const db = { ...fakeDb(), backlogItem: { findFirst: vi.fn(async () => item) }, workroom: { findMany: vi.fn(async () => []) }, featureBuild: { findFirst: vi.fn(async () => ({ originatingBacklogItemId: item.id })) } };
    db.platformConfig.findUnique.mockImplementation(async (args?: unknown) => {
      const key = (args as { where: { key: string } }).where.key;
      if (key === "federation.identity") return { value: { deviceId: installationRef } } as never;
      if (key.includes(":binding:")) return { value: { version: 1, scope: fundedScope, installationRef, actorPrincipalId: "p1", reason: "Explicit owner funding", boundAt: new Date().toISOString() } } as never;
      return null;
    });
    const external = await projectItemInvestment(db as never, { itemId: item.itemId });
    const build = await loadBuildInvestmentContext(db as never, "FB-1");
    expect(external.resolved).toBe(true);
    expect(build.guidance).toBe(external.guidance);
    expect(build.snapshot).toMatchObject({ investmentPrincipalId: "p1", investmentOrganizationId: "org1", investmentClass: "refactor", investmentItemId: item.id });
    expect(build.guidance).toContain(purpose === "shared-platform" ? "80% refactoring" : "20% refactoring");
  });
  it("rejects a cross-organization item before writing its room funding", async () => {
    const base = fakeDb();
    const db = { ...base, backlogItem: { findUnique: vi.fn(async () => ({ id: "item1", organizationId: "other" })) }, workroom: { findUnique: vi.fn(async () => ({ id: "room1", promotionPolicy: {} })), updateMany: vi.fn() }, $transaction: async (fn: (tx: unknown) => unknown) => fn(db) };
    db.platformConfig.findUnique.mockImplementation(async (args?: unknown) => (args as { where: { key: string } }).where.key === "federation.identity" ? { value: { deviceId: `did_${"a".repeat(64)}` } } as never : null);
    roomAccess.mockResolvedValue({ decision: { level: "action" } });
    expect(await bindInvestmentFunding(db as never, { userId: "u1", scope, target: { kind: "workroom", id: "WC-1", itemId: "BI-1" }, expectedBoundAt: null, reason: "Explicit funding" })).toMatchObject({ ok: false, error: "funding-organization-mismatch" });
    expect(db.workroom.updateMany).not.toHaveBeenCalled();
  });
  it("explicitly rebinds a cloned room while keeping the old installation in history", async () => {
    const installationRef = `did_${"a".repeat(64)}`;
    const previous = { version: 1, scope, installationRef: `did_${"b".repeat(64)}`, actorPrincipalId: "p1", reason: "Original install", boundAt: "2026-01-01T00:00:00Z" };
    const base = fakeDb();
    const db = { ...base, workroom: { findUnique: vi.fn(async () => ({ id: "room1", updatedAt: new Date(), promotionPolicy: { unrelated: true, investmentBalanceV1: { bindings: { "*": previous } } } })), updateMany: vi.fn(async () => ({ count: 1 })) }, workroomActivity: { create: vi.fn() }, $transaction: async (fn: (tx: unknown) => unknown) => fn(db) };
    db.platformConfig.findUnique.mockImplementation(async (args?: unknown) => (args as { where: { key: string } }).where.key === "federation.identity" ? { value: { deviceId: installationRef } } as never : null);
    roomAccess.mockResolvedValue({ decision: { level: "action" } });
    expect(await bindInvestmentFunding(db as never, { userId: "u1", scope, target: { kind: "workroom", id: "WC-1", itemId: "*" }, expectedBoundAt: previous.boundAt, reason: "Bind this cloned development install" })).toMatchObject({ ok: true, data: { installationRef } });
    expect(db.workroomActivity.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payload: expect.objectContaining({ previous }) }) }));
    expect(db.workroom.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ promotionPolicy: expect.objectContaining({ unrelated: true }) }) }));
  });
  it("lets the verified owner inspect an expired revision for renewal without enabling execution", async () => {
    const revision = "00000000-0000-4000-8000-000000000001";
    const epoch = Date.now();
    const stored = { version: 1, revision, previousRevision: null, scope, policy: { ...defaultBalancePolicy("founder", "shared-platform"), steeringEnabled: true }, actorPrincipalId: "p1", reason: "Time-limited allocation", effectiveAt: new Date(epoch - 60 * 86400000).toISOString(), expiresAt: new Date(epoch - 30 * 86400000).toISOString() };
    const db = { ...fakeDb(), $queryRaw: vi.fn(async () => []) };
    db.platformConfig.findUnique.mockImplementation(async (args?: unknown) => {
      const key = (args as { where: { key: string } }).where.key;
      if (key === "federation.identity") return { value: { deviceId: `did_${"a".repeat(64)}` } } as never;
      if (key.endsWith(":current")) return { value: { revision } } as never;
      if (key.endsWith(`:revision:${revision}`)) return { value: stored } as never;
      return null;
    });
    expect(await loadScopedBalancePolicy(db as never, scope)).toMatchObject({ ok: false, error: "inactive-policy" });
    expect(await loadScopedBalanceReport(db as never, scope)).toMatchObject({ ok: true, data: { policyActive: false, revision: { revision }, observation: { preferred: null } } });
  });
  it("permits an explicit successor after canonical funding ownership changes, preserving binding history", async () => {
    const installationRef = `did_${"a".repeat(64)}`;
    const previous = { version: 1, scope: { ...scope, principalId: "old-owner" }, installationRef, actorPrincipalId: "old-owner", reason: "Original funding", boundAt: "2026-01-01T00:00:00Z" };
    const base = fakeDb();
    const db = { ...base, platformConfig: { ...base.platformConfig, create: vi.fn(async () => ({})), update: vi.fn(async () => ({})) }, $transaction: async (fn: (tx: unknown) => unknown) => fn(db) };
    db.platformConfig.findUnique.mockImplementation(async (args?: unknown) => {
      const key = (args as { where: { key: string } }).where.key;
      if (key === "federation.identity") return { value: { deviceId: installationRef } } as never;
      if (key.includes(":binding:")) return { value: previous } as never;
      return null;
    });
    expect(await bindInvestmentFunding(db as never, { userId: "u1", scope, target: { kind: "installation", purpose: "shared-platform" }, expectedBoundAt: previous.boundAt, reason: "Canonical owner succession" })).toMatchObject({ ok: true, data: { scope } });
    expect(db.platformConfig.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ key: expect.stringContaining(":history:") }) }));
  });
  it("refuses a removed original requester using current room authorization", async () => {
    const base = fakeDb();
    const db = { ...base, workroom: { findUnique: vi.fn(async () => ({ id: "room1", requestedByPrincipalId: "p1", promotionPolicy: {} })), updateMany: vi.fn(async () => ({ count: 1 })) }, workroomActivity: { create: vi.fn() }, $transaction: async (fn: (tx: unknown) => unknown) => fn(db) };
    db.platformConfig.findUnique.mockResolvedValue({ value: { deviceId: `did_${"a".repeat(64)}` } } as never);
    // Identity is the only config; policy has no stored override.
    db.platformConfig.findUnique.mockImplementation(async (args?: unknown) => (args as { where: { key: string } }).where.key === "federation.identity" ? { value: { deviceId: `did_${"a".repeat(64)}` } } as never : null);
    roomAccess.mockResolvedValue({ decision: { level: "none" } });
    expect(await bindInvestmentFunding(db as never, { userId: "u1", scope, target: { kind: "workroom", id: "WC-1", itemId: "*" }, expectedBoundAt: null, reason: "Fund work" })).toMatchObject({ ok: false, error: "room-access-required" });
    expect(db.workroom.updateMany).not.toHaveBeenCalled();
  });
  it("checks every candidate rather than dropping policy after candidate 200", async () => {
    const db = { ...fakeDb(), backlogItem: { findFirst: vi.fn(async () => null) } };
    db.platformConfig.findUnique.mockResolvedValue({ value: { deviceId: `did_${"a".repeat(64)}` } } as never);
    await loadInvestmentStartPreferences(db as never, Array.from({ length: 201 }, (_, index) => `BI-${index}`));
    expect(db.backlogItem.findFirst).toHaveBeenCalledTimes(201);
  });
  it("refuses funding inherited across an item's organization boundary", async () => {
    const installationRef = `did_${"a".repeat(64)}`;
    const db = {
      ...fakeDb(),
      backlogItem: { findFirst: vi.fn(async () => ({ id: "item1", itemId: "BI-1", organizationId: "org2", scopeKind: "archetype-leaf", portfolioId: null })) },
      workroom: {
        findMany: vi.fn(async () => [{ id: "child" }]),
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => where.id === "child"
          ? { id: "child", promotionPolicy: {}, incomingRelations: [{ fromWorkroomId: "parent" }] }
          : { id: "parent", promotionPolicy: { investmentBalanceV1: { bindings: { "*": { version: 1, scope, installationRef } } } }, incomingRelations: [] }),
      },
    };
    db.platformConfig.findUnique.mockImplementation(async (args?: unknown) => (args as { where: { key: string } }).where.key === "federation.identity" ? { value: { deviceId: installationRef } } as never : null);
    expect(await loadItemBalancePolicy(db as never, { itemId: "BI-1" })).toMatchObject({ ok: false, error: "funding-organization-mismatch" });
  });
  it.each(["archetype-category", "archetype-leaf", "multi-archetype"])("resolves recorded %s work through an archetype funding binding", async (scopeKind) => {
    const installationRef = `did_${"a".repeat(64)}`;
    const fundedScope = { ...scope, purpose: "archetype" };
    const db = {
      ...fakeDb(),
      backlogItem: { findFirst: vi.fn(async () => ({ id: "item1", itemId: "BI-1", scopeKind, portfolioId: null, organizationId: "org1" })) },
      workroom: { findMany: vi.fn(async () => []) },
    };
    db.platformConfig.findUnique.mockImplementation(async (args?: unknown) => {
      const key = (args as { where: { key: string } }).where.key;
      if (key === "federation.identity") return { value: { deviceId: installationRef } } as never;
      if (key.includes(":binding:")) return { value: { version: 1, scope: fundedScope, installationRef, actorPrincipalId: "p1", reason: "Fund archetype", boundAt: new Date().toISOString() } } as never;
      return null;
    });
    expect(await loadItemBalancePolicy(db as never, { itemId: "BI-1" })).toMatchObject({ ok: true, data: { scope: fundedScope, policy: { refactorPercent: 20 } } });
  });
  it("refuses an unknown explicit workroom instead of falling through to installation funding", async () => {
    const db = {
      ...fakeDb(),
      backlogItem: { findFirst: vi.fn(async () => ({ id: "item1", itemId: "BI-1", scopeKind: "platform", portfolioId: null })) },
      workroom: { findMany: vi.fn(async () => []) },
    };
    db.platformConfig.findUnique.mockResolvedValue({ value: { deviceId: `did_${"a".repeat(64)}` } } as never);
    expect(await loadItemBalancePolicy(db as never, { itemId: "BI-1", roomId: "WC-missing" })).toEqual({ ok: false, error: "unknown-workroom" });
    expect(db.platformConfig.findUnique).toHaveBeenCalledTimes(1);
  });
  it("derives founder defaults only from an active profile bound to this organization", async () => {
    const db = fakeDb();
    expect(await loadScopedBalancePolicy(db as never, scope)).toMatchObject({ ok: true, data: { source: "default", ownerKind: "founder", policy: { refactorPercent: 80, steeringEnabled: false } } });
    db.decisionPerspectiveProfile.findUnique.mockResolvedValue({ status: "active", ownerPrincipalId: "p1", ownerOrganizationId: "foreign" });
    expect(await loadScopedBalancePolicy(db as never, scope)).toMatchObject({ ok: false, error: "unresolved-authority" });
  });
  it("does not grant a retired profile authority", async () => {
    const db = fakeDb();
    db.decisionPerspectiveProfile.findUnique.mockResolvedValue({ status: "retired", ownerPrincipalId: "p1", ownerOrganizationId: "org1" });
    expect((await loadFundingAuthority(db as never, scope)).founderPrincipalId).toBeNull();
  });
  it("does not substitute an admin when the person's account is inactive", async () => {
    const db = fakeDb();
    db.user.findFirst.mockResolvedValue(null as never);
    expect(await loadScopedBalancePolicy(db as never, scope)).toMatchObject({ ok: false, error: "unresolved-authority" });
    expect(db.user.findFirst).toHaveBeenCalledWith({ where: { id: { in: ["u1"] }, isActive: true }, select: { id: true } });
  });
  it("reads installation identity without creating or guessing one", async () => {
    const db = fakeDb();
    expect(await readInvestmentInstallationId(db as never)).toBeNull();
    db.platformConfig.findUnique.mockResolvedValue({ value: { deviceId: `did_${"a".repeat(64)}` } } as never);
    expect(await readInvestmentInstallationId(db as never)).toBe(`did_${"a".repeat(64)}`);
  });
});
