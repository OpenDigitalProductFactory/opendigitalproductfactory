import { beforeEach, describe, expect, it, vi } from "vitest";
const feedback = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/routing/response-feedback", () => ({ getResponseFeedback: feedback.read }));
const human = vi.hoisted(() => ({ current: vi.fn() }));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: human.current }));
const funding = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/portfolio/platform-funding-setup", () => ({ readPlatformFundingSetup: funding.read }));

import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import { TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";
import { defaultBalancePolicy } from "@/lib/portfolio/investment-balance";

import {
  ALL_SURFACE_DEFINITIONS,
  AUTHORIZED_SURFACE_CATALOG,
  authorizedSurfaceRuntime, createServerSurfaceContext,
} from "./authorized-surface-registry";

describe("Authorized Surface fleet conformance", () => {
  it("compiles every definition into one deterministic catalog with no executable/browser-only metadata", () => {
    expect(AUTHORIZED_SURFACE_CATALOG.definitions).toHaveLength(ALL_SURFACE_DEFINITIONS.length);
    expect(AUTHORIZED_SURFACE_CATALOG.digest).toMatch(/^[a-f0-9]{64}$/);
    for (const definition of ALL_SURFACE_DEFINITIONS) {
      expect(() => JSON.stringify(definition)).not.toThrow();
      expect(JSON.stringify(definition)).not.toMatch(/\b(window|document|HTMLElement|onClick)\b/);
    }
  });

  it("requires every persistent surface action to bind a real side-effect tool with grant metadata", () => {
    const tools = new Map(PLATFORM_TOOLS.map((tool) => [tool.name, tool]));
    for (const definition of ALL_SURFACE_DEFINITIONS) {
      for (const action of definition.actions.filter((candidate) => candidate.actionClass === "domain")) {
        expect(action.tool, `${definition.surfaceId}:${action.actionId}`).toBeTruthy();
        expect(tools.get(action.tool!)?.sideEffect, action.tool).toBe(true);
        expect(TOOL_TO_GRANTS[action.tool!], action.tool).toBeDefined();
      }
    }
  });

  it("keeps stable surface/node/action ids unique across the fleet", () => {
    const surfaceIds = new Set<string>();
    for (const definition of ALL_SURFACE_DEFINITIONS) {
      expect(surfaceIds.has(definition.surfaceId)).toBe(false);
      surfaceIds.add(definition.surfaceId);
      expect(new Set(definition.nodes.map((node) => node.nodeId)).size).toBe(definition.nodes.length);
      expect(new Set(definition.actions.map((action) => action.actionId)).size).toBe(definition.actions.length);
    }
  });
});

describe("response feedback registered resource parity", () => {
  const raw = { delegatingUserId: "u1", actingAgentId: "AGT-1", mode: "external" as const, locale: "en-US", timezone: "UTC",
    workContext: { resourceType: "agent-message", resourceIds: ["m1"] } };
  it("refuses a surface-only reader before accessing feedback", async () => {
    feedback.read.mockClear();
    const context = createServerSurfaceContext(raw, { authorizedToolNames: new Set(["surface_open"]) });
    const result = await authorizedSurfaceRuntime.open({ context, selector: { surfaceId: "coworker.response-feedback" } });
    expect(result).toMatchObject({ ok: false, code: "surface_not_authorized" });
    expect(feedback.read).not.toHaveBeenCalled();
  });
  it("loads the same domain DTO and binds fixed disposition arguments through governed dispatch", async () => {
    feedback.read.mockResolvedValue({ messageId: "m1", available: true, unavailableReason: null, value: null, source: null, actorLabel: null, acceptedAt: null, revision: 4, canWrite: true });
    const dispatch = vi.fn(async () => ({ success: true, message: "Saved." }));
    const context = createServerSurfaceContext(raw, { authorizedToolNames: new Set(["get_response_feedback", "record_response_feedback"]), governedDispatch: dispatch });
    const opened = await authorizedSurfaceRuntime.open({ context, selector: { resourceType: "agent-message" } });
    expect(opened.ok).toBe(true); if (!opened.ok) return;
    expect(feedback.read).toHaveBeenCalledWith("m1", { userId: "u1", agentId: "AGT-1" });
    const result = await authorizedSurfaceRuntime.act({ sessionId: opened.session.sessionId, caller: raw, expectedRevision: opened.session.revision,
      actionId: "feedback.revise", args: { messageId: "forged", expectedRevision: 999, value: true, source: "human" } });
    expect(result.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledWith("record_response_feedback", { messageId: "m1", expectedRevision: 4, value: false }, expect.objectContaining({ actionId: "feedback.revise" }));
  });
});

describe("Finance native expense guidance", () => {
  const raw = { delegatingUserId: "u1", actingAgentId: "finance-agent", mode: "browser" as const,
    locale: "en-US", timezone: "America/Chicago", route: "/finance" };
  const context = () => createServerSurfaceContext(raw, { authorizedToolNames: new Set() });
  it("grounds the native workflow from the existing form catalog, without live financial data or actions", async () => {
    human.current.mockResolvedValue({ userId: "u1", isSuperuser: false, platformRole: "HR-000", platformRoles: ["HR-000"] });
    const opened = await authorizedSurfaceRuntime.open({ context: context(), selector: { route: "/finance" } });
    expect(opened.ok).toBe(true); if (!opened.ok) return;
    const snapshot = await authorizedSurfaceRuntime.snapshot({ sessionId: opened.session.sessionId, caller: raw });
    expect(snapshot.ok && "graph" in snapshot).toBe(true); if (!snapshot.ok || !("graph" in snapshot)) return;
    const text = JSON.stringify(snapshot.graph);
    expect(text).toContain("/finance/my-expenses/new");
    expect(text).toContain("Save as Draft");
    expect(text).toContain("Submit for Approval");
    expect(text).toContain("positive amount");
    expect(text).not.toContain("currentBalance");
    expect(snapshot.graph.actions).toEqual([]);
    await authorizedSurfaceRuntime.close(opened.session.sessionId, raw);
  });
  it.each([null, { userId: "u1", isSuperuser: false, platformRole: "HR-300", platformRoles: ["HR-300"] }])(
    "refuses missing or denied current human authority", async current => {
      human.current.mockResolvedValue(current);
      const opened = await authorizedSurfaceRuntime.open({ context: context(), selector: { surfaceId: "finance.expense-guidance" } });
      expect(opened).toMatchObject({ ok: false, code: "surface_not_authorized" });
    },
  );
  it("rechecks authority when rehydrating a previously authorized surface", async () => {
    human.current.mockResolvedValue({ userId: "u1", isSuperuser: false, platformRole: "HR-000", platformRoles: ["HR-000"] });
    const opened = await authorizedSurfaceRuntime.open({ context: context(), selector: { route: "/finance" } });
    expect(opened.ok).toBe(true); if (!opened.ok) return;
    human.current.mockResolvedValue(null);
    expect(await authorizedSurfaceRuntime.snapshot({ sessionId: opened.session.sessionId, caller: raw })).toMatchObject({ ok: false });
    await authorizedSurfaceRuntime.close(opened.session.sessionId, raw);
  });
});

describe("platform ownership registered surface authority", () => {
  const raw = { delegatingUserId: "owner-user", actingAgentId: "owner-assistant", mode: "external" as const,
    locale: "en-US", timezone: "UTC", route: "/ops/demand" };
  const state = () => ({ status: "available", reason: null, installationId: "install-test",
    person: { principalId: "owner-person", displayName: "Owner" },
    profile: { profileId: "platform-test", name: "Platform policy", currentVersionId: "version-test", ownerPrincipalId: null, ownerOrganizationId: null },
    organizations: [{ id: "org-test", name: "Owner organization", expectedDigest: "a".repeat(64), allocation: { source: "default", policy: defaultBalancePolicy("founder", "shared-platform"), revision: null, active: true } }], nextCursor: null });
  let currentTools: Set<string>;
  const currentAuthority = vi.fn(async (name: string, principal: { delegatingUserId: string; actingAgentId: string }) =>
    principal.delegatingUserId === raw.delegatingUserId && principal.actingAgentId === raw.actingAgentId && currentTools.has(name));
  const context = (tools = ["read_platform_funding_setup", "confirm_platform_funding_owner"], dispatch = vi.fn(async () => ({ success: true, message: "Recorded." }))) => createServerSurfaceContext(raw, {
    authorizedToolNames: new Set(tools), governedDispatch: dispatch, currentToolAuthority: currentAuthority,
  });
  beforeEach(() => {
    currentTools = new Set(["read_platform_funding_setup", "confirm_platform_funding_owner"]);
    currentAuthority.mockClear();
    human.current.mockResolvedValue({ userId: raw.delegatingUserId, isSuperuser: true, platformRole: "HR-300", platformRoles: ["HR-300"] });
    funding.read.mockReset().mockResolvedValue({ ok: true, data: state() });
  });

  it("requires the real read tool before loading the authenticated person's record", async () => {
    const result = await authorizedSurfaceRuntime.open({ context: context(["surface_open", "surface_snapshot"]), selector: { surfaceId: "portfolio.platform-funding-setup" } });
    expect(result).toMatchObject({ ok: false, code: "surface_not_authorized" });
    expect(funding.read).not.toHaveBeenCalled();
  });

  it("fails closed when no current tool-authority proof is available", async () => {
    const unproved = createServerSurfaceContext(raw, { authorizedToolNames: new Set(["read_platform_funding_setup"]) });
    expect(await authorizedSurfaceRuntime.open({ context: unproved, selector: { surfaceId: "portfolio.platform-funding-setup" } })).toMatchObject({ ok: false, code: "surface_not_authorized" });
    expect(funding.read).not.toHaveBeenCalled();
  });

  it("reads as the authenticated user and ignores forged actor, organization and attestation action arguments", async () => {
    const dispatch = vi.fn(async () => ({ success: true, message: "Recorded." }));
    const opened = await authorizedSurfaceRuntime.open({ context: context(undefined, dispatch), selector: { route: "/ops/demand" } });
    expect(opened.ok).toBe(true); if (!opened.ok) return;
    expect(funding.read).toHaveBeenCalledWith(expect.anything(), { userId: raw.delegatingUserId });
    let revision = opened.session.revision;
    for (const [actionId, value] of [["platform-funding-organization", "org-test"], ["platform-funding-reason", "Record the selected platform owner."], ["platform-funding-attestation", true]] as const) {
      const result = await authorizedSurfaceRuntime.act({ sessionId: opened.session.sessionId, caller: raw, context: context(undefined, dispatch), expectedRevision: revision, actionId, args: { value } });
      expect(result.ok).toBe(true); if (!result.ok) return; revision = result.revision;
    }
    const result = await authorizedSurfaceRuntime.act({ sessionId: opened.session.sessionId, caller: raw, context: context(undefined, dispatch), expectedRevision: revision, actionId: "platform-funding-confirm", args: {
      expectedDigest: "a".repeat(64), organizationId: "forged-org", reason: "forged reason", attestation: false,
      principalId: "forged-person", userId: "forged-user", approvedAuthorityEnvelopeId: "forged-envelope", humanApproved: true,
    } });
    expect(result.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledWith("confirm_platform_funding_owner", { organizationId: "org-test", reason: "Record the selected platform owner.", attestation: true, expectedDigest: "a".repeat(64) }, expect.objectContaining({ surfaceId: "portfolio.platform-funding-setup", actionId: "platform-funding-confirm" }));
  });

  it("never pre-attests or takes field values directly from confirmation arguments", async () => {
    const dispatch = vi.fn(async () => ({ success: false, message: "Explicit owner attestation is required." }));
    const opened = await authorizedSurfaceRuntime.open({ context: context(undefined, dispatch), selector: { surfaceId: "portfolio.platform-funding-setup" } });
    expect(opened.ok).toBe(true); if (!opened.ok) return;
    const result = await authorizedSurfaceRuntime.act({ sessionId: opened.session.sessionId, caller: raw, context: context(undefined, dispatch), expectedRevision: opened.session.revision, actionId: "platform-funding-confirm", args: {
      expectedDigest: "a".repeat(64), organizationId: "forged-org", reason: "forged reason", attestation: true,
    } });
    expect(result).toMatchObject({ ok: false, code: "surface_action_failed" });
    expect(dispatch).toHaveBeenCalledWith("confirm_platform_funding_owner", { organizationId: "", reason: "", attestation: false, expectedDigest: "a".repeat(64) }, expect.anything());
  });

  it("refuses a current permission loss before rereading protected state or dispatching", async () => {
    const dispatch = vi.fn(async () => ({ success: true, message: "Recorded." }));
    const opened = await authorizedSurfaceRuntime.open({ context: context(undefined, dispatch), selector: { surfaceId: "portfolio.platform-funding-setup" } });
    expect(opened.ok).toBe(true); if (!opened.ok) return;
    funding.read.mockClear(); human.current.mockResolvedValue(null);
    const result = await authorizedSurfaceRuntime.snapshot({ sessionId: opened.session.sessionId, caller: raw });
    expect(result).toMatchObject({ ok: false, code: "surface_not_authorized" });
    expect(funding.read).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled();
  });

  it.each(["already-recorded", "partial-or-conflicting", "unavailable"])("suppresses and refuses confirmation when current state is %s", async status => {
    funding.read.mockResolvedValue({ ok: true, data: { ...state(), status } });
    const dispatch = vi.fn(async () => ({ success: true, message: "Recorded." }));
    const opened = await authorizedSurfaceRuntime.open({ context: context(undefined, dispatch), selector: { surfaceId: "portfolio.platform-funding-setup" } });
    expect(opened.ok).toBe(true); if (!opened.ok) return;
    expect(opened.actions.find(({ actionId }) => actionId === "platform-funding-confirm")).toBeUndefined();
    expect(await authorizedSurfaceRuntime.act({ sessionId: opened.session.sessionId, caller: raw, context: context(undefined, dispatch), expectedRevision: opened.session.revision, actionId: "platform-funding-confirm", args: { expectedDigest: "a".repeat(64) } })).toMatchObject({ ok: false, code: "surface_action_not_authorized" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each(["profile ownership", "organization eligibility"])("does not replay cached confirmation success after changed %s", async changed => {
    const recorded = { ...state(), status: "already-recorded", profile: { ...state().profile,
      ownerPrincipalId: "owner-person", ownerOrganizationId: "org-test" } };
    const dispatch = vi.fn(async () => {
      funding.read.mockResolvedValue({ ok: true, data: recorded });
      return { success: true, message: "Recorded." };
    });
    const opened = await authorizedSurfaceRuntime.open({ context: context(undefined, dispatch), selector: { surfaceId: "portfolio.platform-funding-setup" } });
    expect(opened.ok).toBe(true); if (!opened.ok) return;
    let revision = opened.session.revision;
    for (const [actionId, value] of [["platform-funding-organization", "org-test"], ["platform-funding-reason", "Record initial ownership"], ["platform-funding-attestation", true]] as const) {
      const drafted = await authorizedSurfaceRuntime.act({ sessionId: opened.session.sessionId, caller: raw,
        context: context(undefined, dispatch), expectedRevision: revision, actionId, args: { value } });
      expect(drafted.ok).toBe(true); if (!drafted.ok) return;
      revision = drafted.revision;
    }
    const input = { sessionId: opened.session.sessionId, caller: raw, expectedRevision: revision,
      actionId: "platform-funding-confirm", args: { expectedDigest: "a".repeat(64) }, idempotencyKey: "confirmed-owner-K" };
    const saved = await authorizedSurfaceRuntime.act({ ...input, context: context(undefined, dispatch) });
    expect(saved.ok).toBe(true); if (!saved.ok) return;
    expect(dispatch).toHaveBeenCalledTimes(1);
    funding.read.mockClear().mockResolvedValue({ ok: true, data: changed === "profile ownership"
      ? { ...recorded, status: "partial-or-conflicting", profile: { ...recorded.profile, ownerOrganizationId: "different-org" } }
      : { ...recorded, status: "unavailable", reason: "organization-not-eligible", organizations: [] } });
    // Fresh proof and the returned revision must not make a historical success current.
    const repeated = await authorizedSurfaceRuntime.act({ ...input, context: context(undefined, dispatch), expectedRevision: saved.revision });
    expect(repeated).toMatchObject({ ok: false, code: "surface_action_not_authorized" });
    expect(funding.read).toHaveBeenCalledWith(expect.anything(), { userId: raw.delegatingUserId });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("withholds confirmation without the existing writer authority", async () => {
    const opened = await authorizedSurfaceRuntime.open({ context: context(["read_platform_funding_setup"]), selector: { surfaceId: "portfolio.platform-funding-setup" } });
    expect(opened.ok).toBe(true); if (!opened.ok) return;
    expect(opened.actions.find(({ actionId }) => actionId === "platform-funding-confirm")).toBeUndefined();
  });

  it("refuses a revoked current read entitlement despite the original open-time grant", async () => {
    const opened = await authorizedSurfaceRuntime.open({ context: context(), selector: { surfaceId: "portfolio.platform-funding-setup" } });
    expect(opened.ok).toBe(true); if (!opened.ok) return;
    funding.read.mockClear(); currentTools.delete("read_platform_funding_setup");
    expect(await authorizedSurfaceRuntime.snapshot({ sessionId: opened.session.sessionId, caller: raw })).toMatchObject({ ok: false, code: "surface_not_authorized" });
    expect(funding.read).not.toHaveBeenCalled();
    expect(currentAuthority).toHaveBeenLastCalledWith("read_platform_funding_setup", { delegatingUserId: raw.delegatingUserId, actingAgentId: raw.actingAgentId });
  });

  it("refuses a revoked current write entitlement without borrowing its original one", async () => {
    const dispatch = vi.fn(async () => ({ success: true, message: "Recorded." }));
    const opened = await authorizedSurfaceRuntime.open({ context: context(undefined, dispatch), selector: { surfaceId: "portfolio.platform-funding-setup" } });
    expect(opened.ok).toBe(true); if (!opened.ok) return;
    currentTools.delete("confirm_platform_funding_owner");
    expect(await authorizedSurfaceRuntime.act({ sessionId: opened.session.sessionId, caller: raw, context: context(undefined, dispatch), expectedRevision: opened.session.revision, actionId: "platform-funding-confirm", args: { expectedDigest: "a".repeat(64) } })).toMatchObject({ ok: false, code: "surface_action_not_authorized" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects raw fresh-context authority claims and never retains an opening dispatch as current", async () => {
    const dispatch = vi.fn(async () => ({ success: true, message: "Recorded." }));
    const opened = await authorizedSurfaceRuntime.open({ context: context(undefined, dispatch), selector: { surfaceId: "portfolio.platform-funding-setup" } });
    expect(opened.ok).toBe(true); if (!opened.ok) return;
    funding.read.mockClear();
    const forged = { ...raw, route: "/forged-route", authorizedToolNames: ["read_platform_funding_setup"], currentToolAuthority: async () => true };
    expect(await authorizedSurfaceRuntime.snapshot({ sessionId: opened.session.sessionId, caller: raw, context: forged })).toMatchObject({ ok: false, code: "surface_not_authorized" });
    expect(funding.read).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled();
  });
});
