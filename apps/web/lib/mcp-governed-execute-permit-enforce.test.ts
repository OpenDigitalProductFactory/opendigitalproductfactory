// GPP Phase 2, PR-E — AC-ENFORCE at the reference monitor.
//
// 1. With the SHIPPED configuration nothing is enforced: every call below runs
//    exactly as it does in shadow (the founder's non-disruption constraint).
// 2. A tool under an enforced binding (a fixture binding promoted in this test
//    only) is refused with a structured `permit_required` when it carries no
//    valid permit, and executes with one.
// 3. Tools outside every enforced binding behave exactly as before.
// 4. A missing permit key, unsealed lineage the decision did not accept, an
//    infrastructure fault, or the operator's `shadow-all` override never turns
//    into a refusal: the binding falls back to shadow for that call and the
//    observation records `enforcement_downgraded` with the reason.
// Plan: docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md (PR-E).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setBindingEnforcementOverrideForTests, type BindingEnforcementEntry } from "./gpp/binding-enforcement";
import { GPP_BINDINGS, setGppBindingsOverrideForTests, type GppBinding } from "./gpp/bindings";
import type { PermitClaims } from "./gpp/permit-claims";
import { mintShadowPermit } from "./gpp/permit-mint";
import type { GppPermitStore, PermitObservationCreate, PermitRow } from "./gpp/permit-store";
import { _setGovernanceForTests, governedExecuteTool } from "./mcp-governed-execute";
import type { ToolResult } from "./mcp-tool-types";

const USER = { platformRole: "ceo", isSuperuser: true };
const STUB_RESULT: ToolResult = { success: true, message: "stub ran", entityId: "E-1", data: { ok: true } };
const TOOL = "create_digital_product";
const ARGS = { name: "Kiosk", description: "Retail kiosk" };

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

/** A human-checkpoint binding narrowed to one tool. A REST call carries no envelope, so this gate never admits it in-call. */
const FIXTURE_CHECKPOINT: GppBinding = {
  bindingId: "fixture-checkpoint-admit",
  version: 1,
  gateKey: "coworker-authority-escalation",
  authority: "wwwd",
  resolver: { module: "lib/govern/authority/coworker-tool-authority-gate", exportName: "enforceCoworkerToolAuthority" },
  admission: "approved-envelope",
  tools: [TOOL],
  toolPredicate: (tool) => tool.consequential,
  reason: "oai",
};

/** An alignment binding narrowed to one tool. The alignment gate runs for it and approves in-call. */
const FIXTURE_ALIGNMENT: GppBinding = {
  bindingId: "fixture-alignment-admit",
  version: 1,
  gateKey: "tak-alignment",
  authority: "wwwd",
  resolver: { module: "lib/tak/alignment-tool-gate", exportName: "runTakAlignmentGate" },
  admission: "alignment-approve",
  tools: [TOOL],
  toolPredicate: (tool) => tool.consequential,
  reason: "oai",
};

const ENTRY: BindingEnforcementEntry = {
  mode: "enforced",
  decisionId: "DI-0123456789AB",
  ratifiedAt: "2026-10-01",
  evidenceRef: "test fixture",
  lineage: "sealed-required",
};

type Lineage = Awaited<ReturnType<GppPermitStore["findLineage"]>>;

type Harness = {
  execute: ReturnType<typeof vi.fn>;
  audits: Record<string, unknown>[];
  receipts: Record<string, unknown>[];
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
    toolExecutionReceiptCreate: async (data) => { h.receipts.push(data); return { id: `receipt-${h.receipts.length}` }; },
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

/** Promote `binding` in THIS test only, placed ahead of the seeds. */
function promote(binding: GppBinding, entry: BindingEnforcementEntry = ENTRY) {
  setGppBindingsOverrideForTests([binding, ...GPP_BINDINGS]);
  setBindingEnforcementOverrideForTests({ [binding.bindingId]: entry });
}

/** A permit the fixture checkpoint gate would have minted for exactly this call. */
async function checkpointHandle(params: Record<string, unknown> = ARGS): Promise<string> {
  const minted = await mintShadowPermit({
    binding: FIXTURE_CHECKPOINT, toolName: TOOL, actorUserId: "user-1",
    authorityDecisionId: "AD-1", envelopeId: "env-1", params,
  });
  if (!minted) throw new Error("fixture mint failed");
  return minted.handle;
}

beforeEach(() => {
  const permits: PermitRow[] = [];
  const observations: PermitObservationCreate[] = [];
  const consumed: string[] = [];
  const lineage = { value: { found: true, sealed: true } as Lineage };
  vi.stubEnv("DPF_GPP_PERMIT_SECRET", "test-permit-secret-0123456789abcdef");
  vi.stubEnv("DPF_GPP_PERMIT_KEY_ID", "k1");
  vi.stubEnv("DPF_GPP_ENFORCEMENT", "");
  h = {
    execute: vi.fn(async (): Promise<ToolResult> => STUB_RESULT),
    audits: [],
    receipts: [],
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
  setBindingEnforcementOverrideForTests(null);
  setGppBindingsOverrideForTests(null);
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

/** Every shape of O/A/I call the shadow suite exercises, plus a read and a write. */
async function battery(): Promise<Array<{ label: string; result: Awaited<ReturnType<typeof call>> }>> {
  const out: Array<{ label: string; result: Awaited<ReturnType<typeof call>> }> = [];
  const minted = await call(TOOL, ARGS);
  out.push({ label: "minted", result: minted });
  const handle = minted.governance?.permit?.handle ?? "";
  Object.assign(h.permits[0]!, { useCount: 0 });
  out.push({ label: "replayed", result: await call(TOOL, ARGS, { permitHandle: handle }) });
  out.push({ label: "param-mismatch", result: await call(TOOL, { ...ARGS, name: "Other" }, { permitHandle: handle }) });
  out.push({ label: "unknown-handle", result: await call(TOOL, ARGS, { permitHandle: "GPM-not-a-permit" }) });
  out.push({ label: "forged", result: await call(TOOL, ARGS, { permitHandle: `gpp1.${h.permits[0]!.permitId}.k1.${"A".repeat(43)}` }) });
  out.push({ label: "checkpoint-handle", result: await call(TOOL, ARGS, { permitHandle: await checkpointHandle() }) });
  out.push({ label: "unbound-oai", result: await call("deploy_feature", { buildId: "FB-1" }) });
  out.push({ label: "read", result: await call("query_backlog", { title: "x" }) });
  out.push({ label: "write", result: await call("create_backlog_item", { title: "x" }) });
  h.lineage.value = { found: true, sealed: false };
  out.push({ label: "unsealed", result: await call(TOOL, ARGS) });
  h.lineage.value = { found: false };
  out.push({ label: "lineage-missing", result: await call(TOOL, ARGS) });
  h.lineage.value = { found: true, sealed: true };
  vi.stubEnv("DPF_GPP_PERMIT_SECRET", "");
  out.push({ label: "unsigned", result: await call(TOOL, ARGS) });
  vi.stubEnv("DPF_GPP_PERMIT_SECRET", "test-permit-secret-0123456789abcdef");
  return out;
}

describe("AC-ENFORCE: the shipped configuration enforces nothing", () => {
  it("every binding and tool runs exactly as in shadow: no refusal, no enforcement recorded", async () => {
    const results = await battery();

    expect(h.execute).toHaveBeenCalledTimes(results.length);
    for (const { label, result } of results) {
      expect(withoutDuration(result), label).toEqual(STUB_RESULT);
      expect(result.governance?.rejected, label).toBeUndefined();
    }
    for (const observation of h.observations) {
      expect(observation, observation.verdict).not.toHaveProperty("enforcement");
      expect(observation.detail, observation.verdict).not.toHaveProperty("enforcement");
    }
    for (const audit of h.audits) expect((audit.result as { error?: string }).error).not.toBe("permit_required");
  });

  it("a raising value of DPF_GPP_ENFORCEMENT changes nothing", async () => {
    vi.stubEnv("DPF_GPP_ENFORCEMENT", "enforced");
    const results = await battery();

    for (const { label, result } of results) expect(withoutDuration(result), label).toEqual(STUB_RESULT);
    for (const observation of h.observations) expect(observation).not.toHaveProperty("enforcement");
  });
});

describe("AC-ENFORCE: a tool under an enforced binding", () => {
  it("is refused without a valid permit: permit_required names the gate, the tool never runs, the refusal is audited", async () => {
    promote(FIXTURE_CHECKPOINT);

    const result = await call(TOOL, ARGS);

    expect(h.execute).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: false,
      error: "permit_required",
      disposition: "awaiting-input",
      governance: { rejected: "permit_required" },
    });
    expect(result.message).toMatch(/fixture-checkpoint-admit@1/);
    expect(result.data).toEqual({
      authorization: {
        reason: "insufficient_authorization",
        remediation: "available",
        remediationHints: [{
          type: "transaction_authorization",
          condition: "handle_required",
          gate: expect.objectContaining({
            gateRef: "fixture-checkpoint-admit@1",
            obtain: "out_of_band",
            gateKey: "coworker-authority-escalation",
            authority: "wwwd",
            admission: "approved-envelope",
            title: expect.any(String),
          }),
        }],
      },
      permit: expect.objectContaining({
        condition: "handle_required",
        verdict: "valid",
        reason: "permit-from-other-binding",
        carriage: "com.opendigitalproductfactory/authorization-handle",
      }),
    });
    // Audited exactly as the other rejections are: one audit row, one receipt.
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({ toolName: TOOL, success: false, result: expect.objectContaining({ error: "permit_required" }) });
    expect(h.receipts).toHaveLength(1);
    expect(h.observations).toEqual([
      expect.objectContaining({
        toolName: TOOL,
        enforcement: "enforced",
        toolExecutionId: "exec-1",
        detail: expect.objectContaining({
          enforcement: expect.objectContaining({
            outcome: "refused", condition: "handle_required", bindings: ["fixture-checkpoint-admit"], decisionIds: ["DI-0123456789AB"],
          }),
        }),
      }),
    ]);
  });

  it("executes with a valid permit from that binding", async () => {
    promote(FIXTURE_CHECKPOINT);
    const handle = await checkpointHandle();

    const result = await call(TOOL, ARGS, { permitHandle: handle });

    expect(withoutDuration(result)).toEqual(STUB_RESULT);
    expect(h.execute).toHaveBeenCalledOnce();
    expect(h.observations).toEqual([
      expect.objectContaining({
        verdict: "valid",
        enforcement: "enforced",
        bindingId: "fixture-checkpoint-admit",
        detail: expect.objectContaining({
          enforcement: { outcome: "allowed", bindingId: "fixture-checkpoint-admit", decisionId: "DI-0123456789AB" },
        }),
      }),
    ]);
  });

  it("an admitted call under an enforced alignment binding mints its own permit and executes", async () => {
    promote(FIXTURE_ALIGNMENT);

    const result = await call(TOOL, ARGS);

    expect(withoutDuration(result)).toEqual(STUB_RESULT);
    expect(h.observations).toEqual([
      expect.objectContaining({ verdict: "valid", enforcement: "enforced", bindingId: "fixture-alignment-admit" }),
    ]);
  });

  it("refuses a forged handle (mac_invalid) as handle_invalid", async () => {
    promote(FIXTURE_CHECKPOINT);
    const handle = await checkpointHandle();
    h.permits[0]!.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const result = await call(TOOL, ARGS, { permitHandle: handle });

    expect(h.execute).not.toHaveBeenCalled();
    expect(result.error).toBe("permit_required");
    expect(result.data?.permit).toMatchObject({ condition: "handle_invalid", verdict: "mac_invalid" });
  });

  it("refuses an invented handle as handle_invalid", async () => {
    promote(FIXTURE_CHECKPOINT);

    const result = await call(TOOL, ARGS, { permitHandle: "GPM-00000000-0000-4000-8000-000000000000" });

    expect(h.execute).not.toHaveBeenCalled();
    expect(result.data?.permit).toMatchObject({ condition: "handle_invalid", verdict: "absent" });
  });

  it("refuses a valid handle replayed with other arguments as handle_mismatch", async () => {
    promote(FIXTURE_CHECKPOINT);
    const handle = await checkpointHandle();

    const result = await call(TOOL, { ...ARGS, name: "Other" }, { permitHandle: handle });

    expect(h.execute).not.toHaveBeenCalled();
    expect(result.data?.permit).toMatchObject({ condition: "handle_mismatch", verdict: "param_mismatch" });
  });

  it("refuses an expired permit as handle_invalid", async () => {
    promote(FIXTURE_CHECKPOINT);
    const handle = await checkpointHandle();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 16 * 60 * 1000);

    const result = await call(TOOL, ARGS, { permitHandle: handle });

    expect(h.execute).not.toHaveBeenCalled();
    expect(result.data?.permit).toMatchObject({ condition: "handle_invalid", verdict: "expired" });
  });

  it("refuses a gate decision that cannot be found (lineage_missing) as handle_invalid", async () => {
    promote(FIXTURE_CHECKPOINT);
    const handle = await checkpointHandle();
    h.lineage.value = { found: false };

    const result = await call(TOOL, ARGS, { permitHandle: handle });

    expect(h.execute).not.toHaveBeenCalled();
    expect(result.data?.permit).toMatchObject({ condition: "handle_invalid", verdict: "lineage_missing" });
  });
});

describe("AC-ENFORCE: enforcement never becomes a refusal storm", () => {
  function expectDowngraded(result: Awaited<ReturnType<typeof call>>, reason: string) {
    expect(withoutDuration(result)).toEqual(STUB_RESULT);
    expect(h.observations.at(-1)).toMatchObject({
      enforcement: "shadow",
      detail: expect.objectContaining({
        enforcement: expect.objectContaining({ outcome: "enforcement_downgraded", reason }),
      }),
    });
  }

  it("an install with no permit key falls back to shadow, even for a call with no permit", async () => {
    promote(FIXTURE_CHECKPOINT);
    vi.stubEnv("DPF_GPP_PERMIT_SECRET", "");

    expectDowngraded(await call(TOOL, ARGS), "permit-key-unconfigured");
    expect(h.execute).toHaveBeenCalledOnce();
  });

  it("unsealed lineage the decision did not accept falls back to shadow", async () => {
    promote(FIXTURE_ALIGNMENT, { ...ENTRY, lineage: "sealed-required" });
    h.lineage.value = { found: true, sealed: false };

    expectDowngraded(await call(TOOL, ARGS), "lineage-unsealed-not-accepted");
  });

  it("unsealed lineage the decision accepted stays enforced, and the call runs", async () => {
    promote(FIXTURE_ALIGNMENT, { ...ENTRY, lineage: "unsealed-accepted" });
    h.lineage.value = { found: true, sealed: false };

    const result = await call(TOOL, ARGS);

    expect(withoutDuration(result)).toEqual(STUB_RESULT);
    expect(h.observations).toEqual([
      expect.objectContaining({ verdict: "lineage_unsealed", enforcement: "enforced" }),
    ]);
  });

  it("unsealed lineage never excuses a forged permit on a keyed install", async () => {
    promote(FIXTURE_CHECKPOINT, { ...ENTRY, lineage: "unsealed-accepted" });
    const handle = await checkpointHandle();
    h.permits[0]!.capabilities = [{ tool: TOOL }, { tool: "deploy_feature" }];
    h.lineage.value = { found: true, sealed: false };

    const result = await call(TOOL, ARGS, { permitHandle: handle });

    expect(h.execute).not.toHaveBeenCalled();
    expect(result.data?.permit).toMatchObject({ condition: "handle_invalid", verdict: "mac_invalid" });
  });

  it("a failed mint after the enforced gate admitted falls back to shadow", async () => {
    promote(FIXTURE_ALIGNMENT);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    install({ gppPermitStore: { ...h.store, createPermit: async () => { throw new Error("db down"); } } });

    expectDowngraded(await call(TOOL, ARGS), "permit-mint-failed");
    errors.mockRestore();
  });

  it("a failed lineage lookup falls back to shadow", async () => {
    promote(FIXTURE_ALIGNMENT);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    install({ gppPermitStore: { ...h.store, findLineage: async () => { throw new Error("db down"); } } });

    expectDowngraded(await call(TOOL, ARGS), "lineage-lookup-failed");
    errors.mockRestore();
  });

  it("DPF_GPP_ENFORCEMENT=shadow-all returns an enforced binding to shadow", async () => {
    promote(FIXTURE_CHECKPOINT);
    vi.stubEnv("DPF_GPP_ENFORCEMENT", "shadow-all");

    expectDowngraded(await call(TOOL, ARGS), "operator-shadow-all");
    expect(h.execute).toHaveBeenCalledOnce();
  });
});

describe("AC-ENFORCE: tools outside every enforced binding behave exactly as before", () => {
  async function run(toolName: string, params: Record<string, unknown>) {
    const result = await call(toolName, params);
    const snapshot = {
      result: withoutDuration(result),
      governance: { ...result.governance, durationMs: undefined },
      observations: structuredClone(h.observations),
      audits: h.audits.map((audit) => ({ ...audit, durationMs: undefined })),
      executeCalls: h.execute.mock.calls.map((args) => [args[0], args[1], args[2]]),
    };
    h.observations.length = 0;
    h.audits.length = 0;
    h.permits.length = 0;
    h.execute.mockClear();
    return snapshot;
  }

  it.each([
    ["an R tool", "query_backlog", { title: "x" }],
    ["a W tool", "create_backlog_item", { title: "x" }],
    ["an O/A/I tool no enforced binding names", "deploy_feature", { buildId: "FB-1" }],
  ])("%s: the result, audit and observation are deep-equal with and without the promotion", async (_label, toolName, params) => {
    const before = await run(toolName, params);
    promote(FIXTURE_CHECKPOINT);
    const after = await run(toolName, params);

    expect(after).toEqual(before);
    expect(after.result).toEqual(STUB_RESULT);
  });
});
