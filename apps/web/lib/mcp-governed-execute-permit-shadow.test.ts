// GPP Phase 2, PR-C — AC-SHADOW-PERMIT.
// The reference monitor mints a permit when an existing gate admits an O/A/I
// call, records one verdict per O/A/I call, and never refuses: every result is
// exactly what the call returned before permits existed.
// Plan: docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md (PR-C).
// PR-D adds the MAC, parameter-hash and lineage verdicts (AC-FORGERY at the
// monitor): each is recorded, and the call still runs with the same result.
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

type Lineage = Awaited<ReturnType<GppPermitStore["findLineage"]>>;

type Harness = {
  execute: ReturnType<typeof vi.fn>;
  audits: Record<string, unknown>[];
  permits: PermitRow[];
  observations: PermitObservationCreate[];
  consumed: string[];
  lineage: { value: Lineage };
  store: GppPermitStore;
};

function makeStore(h: Pick<Harness, "permits" | "observations" | "consumed" | "lineage">): GppPermitStore {
  return {
    createPermit: async (claims: PermitClaims, signature) => {
      const row: PermitRow = {
        ...claims, id: `row-${h.permits.length + 1}`, useCount: 0, revokedAt: null,
        keyId: signature?.keyId ?? null, mac: signature?.mac ?? null,
      };
      h.permits.push(row);
      return row;
    },
    findPermitByPermitId: async (permitId) => h.permits.find((row) => row.permitId === permitId) ?? null,
    consumePermit: async (row) => { h.consumed.push(row.id); return true; },
    createObservation: async (data) => { h.observations.push(data); },
    findLineage: async () => h.lineage.value,
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
  // A keyed install whose gate decisions are sealed: the conditions under
  // which a minted permit verifies `valid`. PR-D cases change one at a time.
  const lineage = { value: { found: true, sealed: true } as Lineage };
  vi.stubEnv("DPF_GPP_PERMIT_SECRET", "test-permit-secret-0123456789abcdef");
  vi.stubEnv("DPF_GPP_PERMIT_KEY_ID", "k1");
  h = {
    execute: vi.fn(async (): Promise<ToolResult> => STUB_RESULT),
    audits: [],
    permits,
    observations,
    consumed,
    lineage,
    store: makeStore({ permits, observations, consumed, lineage }),
  };
  install();
});

afterEach(() => {
  _setGovernanceForTests({});
  vi.unstubAllEnvs();
});

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

  // PR-D: expiry is a signed claim, so an expired permit is reached by the
  // clock passing its expiresAt, not by editing the row (that is `mac_invalid`).
  it.each([
    ["expired", () => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 16 * 60 * 1000); }, "expired"],
    ["revoked", () => { h.permits[0]!.revokedAt = new Date(); }, "revoked"],
  ])("an O/A/I call carrying an %s handle still executes", async (_label, age, verdict) => {
    const baseline = await call("create_digital_product", { name: "Kiosk" });
    h.observations.length = 0;
    const replayed = h.permits[0]!;
    Object.assign(replayed, { useCount: 0 });
    age();

    try {
      const result = await call("create_digital_product", { name: "Kiosk" }, { permitHandle: replayed.permitId });

      expect(withoutDuration(result)).toEqual(withoutDuration(baseline));
      expect(h.execute).toHaveBeenCalledTimes(2);
      expect(h.observations).toEqual([expect.objectContaining({ verdict, permitRowId: replayed.id })]);
    } finally {
      vi.useRealTimers();
    }
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
        findLineage: boom,
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

describe("GPP permit MAC, parameter binding and lineage at the reference monitor (PR-D)", () => {
  const ARGS = { name: "Kiosk", description: "Retail kiosk" };

  async function mintedHandle(): Promise<{ baseline: Awaited<ReturnType<typeof call>>; handle: string }> {
    const baseline = await call("create_digital_product", ARGS);
    const handle = baseline.governance?.permit?.handle;
    if (!handle) throw new Error("no handle returned");
    h.observations.length = 0;
    h.consumed.length = 0;
    // Make the replayed permit otherwise usable, so only the PR-D check differs.
    Object.assign(h.permits[0]!, { useCount: 0 });
    return { baseline, handle };
  }

  it("returns the signed handle of the permit it minted, additively, on governance.permit", async () => {
    const result = await call("create_digital_product", ARGS);

    const row = h.permits[0]!;
    expect(row.paramHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.keyId).toBe("k1");
    expect(result.governance?.permit).toEqual({ handle: `gpp1.${row.permitId}.k1.${row.mac}`, verdict: "valid" });
    // The handler and the audit row cite the opaque id, never the MAC.
    expect(h.execute.mock.calls[0]![3]).toMatchObject({ gppPermitId: row.permitId });
    expect(h.audits[0]).toMatchObject({ gppPermitRef: row.permitId, gppPermitVerdict: "valid" });
  });

  it("a valid handle replayed with different arguments records param_mismatch and still executes", async () => {
    const { baseline, handle } = await mintedHandle();

    const result = await call("create_digital_product", { ...ARGS, name: "Other" }, { permitHandle: handle });

    expect(withoutDuration(result)).toEqual(withoutDuration(baseline));
    expect(h.execute).toHaveBeenCalledTimes(2);
    expect(h.observations).toEqual([
      expect.objectContaining({ verdict: "param_mismatch", permitRowId: h.permits[0]!.id }),
    ]);
    // A mismatched presentation does not spend the legitimate permit's use.
    expect(h.consumed).not.toContain(h.permits[0]!.id);
  });

  it("the same handle replayed with the same arguments in another key order is not a mismatch", async () => {
    const { handle } = await mintedHandle();

    await call("create_digital_product", { description: ARGS.description, name: ARGS.name }, { permitHandle: handle });

    expect(h.observations).toEqual([expect.objectContaining({ verdict: "valid" })]);
  });

  it("AC-FORGERY: a replayed permit whose row was edited records mac_invalid and still executes", async () => {
    const { baseline, handle } = await mintedHandle();
    h.permits[0]!.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const result = await call("create_digital_product", ARGS, { permitHandle: handle });

    expect(withoutDuration(result)).toEqual(withoutDuration(baseline));
    expect(h.observations).toEqual([expect.objectContaining({ verdict: "mac_invalid" })]);
    expect(h.audits.at(-1)).toMatchObject({ gppPermitVerdict: "mac_invalid" });
  });

  it("AC-FORGERY: an invented row with a guessed handle records mac_invalid and still executes", async () => {
    const { baseline } = await mintedHandle();
    const forged: PermitRow = {
      ...h.permits[0]!, id: "row-forged", permitId: "GPM-00000000-0000-4000-8000-000000000000",
      mac: "A".repeat(43), useCount: 0,
    };
    h.permits.push(forged);

    const result = await call("create_digital_product", ARGS, {
      permitHandle: `gpp1.${forged.permitId}.k1.${forged.mac}`,
    });

    expect(withoutDuration(result)).toEqual(withoutDuration(baseline));
    expect(h.observations).toEqual([expect.objectContaining({ verdict: "mac_invalid", permitRowId: "row-forged" })]);
  });

  it("an unsealed gate decision records lineage_unsealed and still executes", async () => {
    h.lineage.value = { found: true, sealed: false };

    const result = await call("create_digital_product", ARGS);

    expect(withoutDuration(result)).toEqual(STUB_RESULT);
    expect(h.observations).toEqual([expect.objectContaining({ verdict: "lineage_unsealed" })]);
    expect(result.governance?.permit?.verdict).toBe("lineage_unsealed");
  });

  it("a gate decision that cannot be found records lineage_missing and still executes", async () => {
    h.lineage.value = { found: false };

    const result = await call("create_digital_product", ARGS);

    expect(withoutDuration(result)).toEqual(STUB_RESULT);
    expect(h.observations).toEqual([expect.objectContaining({ verdict: "lineage_missing" })]);
  });

  it("an install with no key mints unsigned, records unsigned, and still executes", async () => {
    vi.stubEnv("DPF_GPP_PERMIT_SECRET", "");

    const result = await call("create_digital_product", ARGS);

    expect(withoutDuration(result)).toEqual(STUB_RESULT);
    expect(h.permits[0]).toMatchObject({ keyId: null, mac: null });
    expect(h.observations).toEqual([expect.objectContaining({ verdict: "unsigned" })]);
    // Unsigned is an install property, not a bad presentation: the use counts.
    expect(h.consumed).toEqual([h.permits[0]!.id]);
    expect(result.governance?.permit).toEqual({ handle: h.permits[0]!.permitId, verdict: "unsigned" });
  });

  it("a lineage lookup failure never fails the call", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    install({ gppPermitStore: { ...h.store, findLineage: async () => { throw new Error("db down"); } } });

    const result = await call("create_digital_product", ARGS);

    expect(withoutDuration(result)).toEqual(STUB_RESULT);
    expect(h.observations).toEqual([expect.objectContaining({ verdict: "valid" })]);
    expect(h.observations[0]!.detail).toMatchObject({ checks: { lineage: "lookup_failed" } });
    errors.mockRestore();
  });
});
