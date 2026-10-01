// GPP Phase 2, PR-C — AC-SHADOW-PERMIT.
// The reference monitor mints a permit when an existing gate admits an O/A/I
// call, records one verdict per O/A/I call, and never refuses: every result is
// exactly what the call returned before permits existed.
// Plan: docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md (PR-C).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PermitClaims } from "./gpp/permit-claims";
import type { GppPermitStore, PermitObservationCreate, PermitRow } from "./gpp/permit-store";
import { _setGovernanceForTests, governedExecuteTool } from "./mcp-governed-execute";
import type { ToolResult } from "./mcp-tool-types";

const USER = { platformRole: "ceo", isSuperuser: true };
const STUB_RESULT: ToolResult = { success: true, message: "stub ran", entityId: "E-1", data: { ok: true } };

const resolveActor = async (args: { context?: { agentId?: string }; userId: string }) => ({
  principalId: "PRN-HUMAN",
  gaid: "GAID-HUMAN",
  actorKind: "owner" as const,
  actorRef: args.userId,
});

const approve = async () => ({
  verdict: "approve" as const,
  interactionId: "DI-ALIGN-1",
  rationale: "aligned",
  policyVersion: "wwwd:v1",
  alignment: {
    verdict: "approve" as const,
    criteria: {
      status: "complete" as const,
      criteria: {
        market: "retail", segment: "retail", product: "kiosks", motion: "direct",
        geography: "us", customerType: "smb",
      },
      evidence: [],
      missing: [],
    },
    checks: [],
    veto: null,
  },
});

type Harness = {
  execute: ReturnType<typeof vi.fn>;
  audits: Record<string, unknown>[];
  permits: PermitRow[];
  observations: PermitObservationCreate[];
  consumed: string[];
  store: GppPermitStore;
};

function makeStore(h: Pick<Harness, "permits" | "observations" | "consumed">): GppPermitStore {
  return {
    createPermit: async (claims: PermitClaims) => {
      const row: PermitRow = { ...claims, id: `row-${h.permits.length + 1}`, useCount: 0, revokedAt: null };
      h.permits.push(row);
      return row;
    },
    findPermitByPermitId: async (permitId) => h.permits.find((row) => row.permitId === permitId) ?? null,
    consumePermit: async (row) => { h.consumed.push(row.id); },
    createObservation: async (data) => { h.observations.push(data); },
  };
}

let h: Harness;

function install(overrides: Partial<Parameters<typeof _setGovernanceForTests>[0]> = {}) {
  _setGovernanceForTests({
    executeTool: h.execute as never,
    toolExecutionCreate: async (data) => { h.audits.push(data); return { id: `exec-${h.audits.length}` }; },
    toolExecutionUpdate: async () => undefined,
    toolExecutionReceiptCreate: async () => ({ id: "receipt-1" }),
    toolExecutionReceiptUpdate: async () => undefined,
    gaidActorResolver: resolveActor,
    alignmentGate: approve,
    gppPermitStore: h.store,
    ...overrides,
  });
}

function call(toolName: string, rawParams: Record<string, unknown> = {}, context?: Record<string, unknown>) {
  return governedExecuteTool({ toolName, rawParams, userId: "user-1", userContext: USER, source: "rest", context });
}

function withoutDuration(result: Record<string, unknown>) {
  const { governance: _governance, ...rest } = result;
  return rest;
}

beforeEach(() => {
  const permits: PermitRow[] = [];
  const observations: PermitObservationCreate[] = [];
  const consumed: string[] = [];
  h = {
    execute: vi.fn(async (): Promise<ToolResult> => STUB_RESULT),
    audits: [],
    permits,
    observations,
    consumed,
    store: makeStore({ permits, observations, consumed }),
  };
  install();
});

afterEach(() => _setGovernanceForTests({}));

describe("GPP shadow permits at the reference monitor", () => {
  it("records a permit verdict for every O/A/I call under a binding and refuses none", async () => {
    const result = await call("create_digital_product", { name: "Kiosk", description: "Retail kiosk" });

    expect(withoutDuration(result)).toEqual(STUB_RESULT);
    expect(h.execute).toHaveBeenCalledOnce();
    expect(h.permits).toHaveLength(1);
    expect(h.permits[0]).toMatchObject({
      bindingId: "tak-alignment-admit",
      bindingVersion: 1,
      gateKey: "tak-alignment",
      authority: "wwwd",
      gateDecisionId: "DI-ALIGN-1",
      actorUserId: "user-1",
      capabilities: [{ tool: "create_digital_product" }],
      enforcement: "shadow",
      maxUses: 1,
    });
    expect(h.permits[0]!.permitId).toMatch(/^GPM-[0-9a-f-]{36}$/);
    expect(h.permits[0]!.expiresAt.getTime() - h.permits[0]!.notBefore.getTime()).toBe(15 * 60 * 1000);
    expect(h.observations).toEqual([
      expect.objectContaining({
        toolName: "create_digital_product",
        verdict: "valid",
        path: "monitor",
        bindingId: "tak-alignment-admit",
        permitRowId: "row-1",
        toolExecutionId: "exec-1",
      }),
    ]);
    expect(h.consumed).toEqual(["row-1"]);
    // The handler can cite the permit, and the audit row carries it.
    expect(h.execute.mock.calls[0]![3]).toMatchObject({ gppPermitId: h.permits[0]!.permitId });
    expect(h.audits[0]).toMatchObject({ gppPermitRef: h.permits[0]!.permitId, gppPermitVerdict: "valid" });
  });

  it.each([
    ["expired", { expiresAt: new Date(Date.now() - 1000) }, "expired"],
    ["revoked", { revokedAt: new Date() }, "revoked"],
  ])("an O/A/I call carrying an %s handle still executes", async (_label, patch, verdict) => {
    const baseline = await call("create_digital_product", { name: "Kiosk" });
    h.observations.length = 0;
    const replayed = h.permits[0]!;
    Object.assign(replayed, { useCount: 0 }, patch);

    const result = await call("create_digital_product", { name: "Kiosk" }, { permitHandle: replayed.permitId });

    expect(withoutDuration(result)).toEqual(withoutDuration(baseline));
    expect(h.execute).toHaveBeenCalledTimes(2);
    expect(h.observations).toEqual([expect.objectContaining({ verdict, permitRowId: replayed.id })]);
  });

  it("an O/A/I call carrying an unknown handle still executes", async () => {
    const baseline = await call("create_digital_product", { name: "Kiosk" });
    h.observations.length = 0;

    const result = await call("create_digital_product", { name: "Kiosk" }, { permitHandle: "GPM-not-a-permit" });

    expect(withoutDuration(result)).toEqual(withoutDuration(baseline));
    expect(h.observations).toEqual([expect.objectContaining({ verdict: "absent", permitRowId: null })]);
  });

  it.each([
    ["an R tool", "query_backlog"],
    ["a W tool", "create_backlog_item"],
  ])("%s records nothing and mints nothing", async (_label, toolName) => {
    const result = await call(toolName, { title: "x" });

    expect(withoutDuration(result)).toEqual(STUB_RESULT);
    expect(h.permits).toEqual([]);
    expect(h.observations).toEqual([]);
    expect(h.execute.mock.calls[0]![3]).not.toHaveProperty("gppPermitId");
    for (const audit of h.audits) {
      expect(audit).not.toHaveProperty("gppPermitRef");
      expect(audit).not.toHaveProperty("gppPermitVerdict");
    }
  });

  it("a tool with no binding behaves exactly as before", async () => {
    // deploy_feature is irreversible: consequential, receipted, never
    // alignment-gated, and a human REST caller carries no approval envelope.
    // No gate admits it, so no binding covers it.
    const alignmentGate = vi.fn(approve);
    install({ alignmentGate });

    const result = await call("deploy_feature", { buildId: "FB-1" });

    expect(withoutDuration(result)).toEqual(STUB_RESULT);
    expect(alignmentGate).not.toHaveBeenCalled();
    expect(h.permits).toEqual([]);
    expect(h.observations).toEqual([
      expect.objectContaining({ toolName: "deploy_feature", verdict: "ungoverned", bindingId: null, permitRowId: null }),
    ]);
    expect(h.audits[0]).toMatchObject({ gppPermitVerdict: "ungoverned" });
    expect(h.audits[0]).not.toHaveProperty("gppPermitRef");
    expect(h.execute.mock.calls[0]![3]).not.toHaveProperty("gppPermitId");
  });

  it("mint or record failure never fails the call", async () => {
    const boom = async () => { throw new Error("db down"); };
    install({
      gppPermitStore: {
        createPermit: boom,
        findPermitByPermitId: boom,
        consumePermit: boom,
        createObservation: boom,
      },
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const minted = await call("create_digital_product", { name: "Kiosk" });
    const replayed = await call("create_digital_product", { name: "Kiosk" }, { permitHandle: "GPM-x" });
    const unbound = await call("deploy_feature", { buildId: "FB-1" });

    expect(withoutDuration(minted)).toEqual(STUB_RESULT);
    expect(withoutDuration(replayed)).toEqual(STUB_RESULT);
    expect(withoutDuration(unbound)).toEqual(STUB_RESULT);
    expect(h.execute).toHaveBeenCalledTimes(3);
    expect(h.audits[0]).toMatchObject({ gppPermitVerdict: "absent" });
    errors.mockRestore();
  });
});
