// GPP Phase 2, PR-G — pre-promotion hardening at the reference monitor.
//
// 1. Concurrent replay: two concurrent calls presenting one single-use handle.
//    With the SHIPPED configuration both still run (shadow), and their
//    observations now say which one took the use (`valid`) and which did not
//    (`exhausted`). Under an enforced binding exactly one runs; the other is
//    refused `permit_required` / `handle_invalid` / `exhausted`. A failed use
//    count is an infrastructure fault and downgrades, never refuses.
// 2. The monitor reports when the handle it minted expires, next to the
//    handle, so the MCP route can return both on the result's `_meta`.
// Plan: docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md (PR-G).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GPP_BINDING_ENFORCEMENT, setBindingEnforcementOverrideForTests, type BindingEnforcementEntry } from "./gpp/binding-enforcement";
import { GPP_BINDINGS, setGppBindingsOverrideForTests, type GppBinding } from "./gpp/bindings";
import { mintShadowPermit } from "./gpp/permit-mint";
import type { GppPermitStore, PermitObservationCreate, PermitRow } from "./gpp/permit-store";
import { _setGovernanceForTests, governedExecuteTool } from "./mcp-governed-execute";
import type { ToolResult } from "./mcp-tool-types";

const USER = { platformRole: "ceo", isSuperuser: true };
const STUB_RESULT: ToolResult = { success: true, message: "stub ran", entityId: "E-1", data: { ok: true } };
const TOOL = "create_digital_product";
const ARGS = { name: "Kiosk", description: "Retail kiosk" };

const resolveActor = async (args: { userId: string }) => ({
  principalId: "PRN-HUMAN", gaid: "GAID-HUMAN", actorKind: "owner" as const, actorRef: args.userId,
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
      criteria: { market: "retail", segment: "retail", product: "kiosks", motion: "direct", geography: "us", customerType: "smb" },
      evidence: [],
      missing: [],
    },
    checks: [],
    veto: null,
  },
});

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

const ENTRY: BindingEnforcementEntry = {
  mode: "enforced", decisionId: "DI-0123456789AB", ratifiedAt: "2026-10-01", evidenceRef: "test fixture", lineage: "sealed-required",
};

type Harness = {
  execute: ReturnType<typeof vi.fn>;
  audits: Record<string, unknown>[];
  permits: PermitRow[];
  observations: PermitObservationCreate[];
  store: GppPermitStore;
  /** Hold the next `n` presented-handle lookups until all have read the same row. */
  arm: (n: number) => void;
};

/** Snapshot reads plus a compare-and-set use count: the PostgreSQL behaviour of the real store. */
function racingStore(permits: PermitRow[], observations: PermitObservationCreate[]): Pick<Harness, "store" | "arm"> {
  let waiting: Array<() => void> = [];
  let readers = 0;
  return {
    arm: (n) => { readers = n; },
    store: {
      createPermit: async (claims, signature) => {
        const row: PermitRow = {
          ...claims, id: `row-${permits.length + 1}`, useCount: 0, revokedAt: null,
          keyId: signature?.keyId ?? null, mac: signature?.mac ?? null,
        };
        permits.push(row);
        return { ...row };
      },
      findPermitByPermitId: async (permitId) => {
        const live = permits.find((row) => row.permitId === permitId);
        const snapshot = live ? { ...live } : null;
        if (readers > 0) {
          await new Promise<void>((resolve) => {
            waiting.push(resolve);
            if (waiting.length >= readers) {
              const release = waiting;
              waiting = [];
              readers = 0;
              for (const go of release) go();
            }
          });
        }
        return snapshot;
      },
      consumePermit: async (row) => {
        await Promise.resolve();
        const live = permits.find((candidate) => candidate.id === row.id);
        if (!live || live.useCount >= row.maxUses) return false;
        live.useCount += 1;
        return true;
      },
      createObservation: async (data) => { observations.push(data); },
      findLineage: async () => ({ found: true, sealed: true }),
    },
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

function promote(binding: GppBinding) {
  setGppBindingsOverrideForTests([binding, ...GPP_BINDINGS]);
  setBindingEnforcementOverrideForTests({ [binding.bindingId]: ENTRY });
}

/** A single-use permit the checkpoint gate would have minted for exactly this call. */
async function checkpointHandle(binding: GppBinding): Promise<string> {
  const minted = await mintShadowPermit({
    binding, toolName: TOOL, actorUserId: "user-1", authorityDecisionId: "AD-1", envelopeId: "env-1", params: ARGS,
  });
  if (!minted) throw new Error("fixture mint failed");
  return minted.handle;
}

/** The observation recorded for the presented permit (row-1), one per call. */
function presentedObservations() {
  return h.observations.filter((o) => o.permitRowId === "row-1");
}

beforeEach(() => {
  vi.stubEnv("DPF_GPP_PERMIT_SECRET", "test-permit-secret-0123456789abcdef");
  vi.stubEnv("DPF_GPP_PERMIT_KEY_ID", "k1");
  vi.stubEnv("DPF_GPP_ENFORCEMENT", "");
  const permits: PermitRow[] = [];
  const observations: PermitObservationCreate[] = [];
  h = { execute: vi.fn(async (): Promise<ToolResult> => STUB_RESULT), audits: [], permits, observations, ...racingStore(permits, observations) };
  install();
});

afterEach(() => {
  _setGovernanceForTests({});
  setBindingEnforcementOverrideForTests(null);
  setGppBindingsOverrideForTests(null);
  vi.unstubAllEnvs();
});

describe("PR-G #1: concurrent replay of one single-use handle", () => {
  it("shipped configuration: both calls still run, and exactly one observation is valid, the other exhausted", async () => {
    expect(GPP_BINDING_ENFORCEMENT).toEqual({});
    const handle = await checkpointHandle(GPP_BINDINGS.find((b) => b.bindingId === "human-checkpoint-admit")!);
    h.arm(2);

    const results = await Promise.all([
      call(TOOL, ARGS, { permitHandle: handle }),
      call(TOOL, ARGS, { permitHandle: handle }),
    ]);

    // Shadow: no outcome changes.
    expect(h.execute).toHaveBeenCalledTimes(2);
    for (const result of results) {
      expect(result.success).toBe(true);
      expect(result.governance?.rejected).toBeUndefined();
    }
    const verdicts = presentedObservations().map((o) => o.verdict).sort();
    expect(verdicts).toEqual(["exhausted", "valid"]);
    for (const observation of h.observations) expect(observation).not.toHaveProperty("enforcement");
    expect(h.permits[0]!.useCount).toBe(1);
  });

  it("enforced binding: exactly one concurrent presentation executes; the other is refused exhausted", async () => {
    promote(FIXTURE_CHECKPOINT);
    const handle = await checkpointHandle(FIXTURE_CHECKPOINT);
    h.arm(2);

    const results = await Promise.all([
      call(TOOL, ARGS, { permitHandle: handle }),
      call(TOOL, ARGS, { permitHandle: handle }),
    ]);

    expect(h.execute).toHaveBeenCalledOnce();
    const ran = results.filter((r) => r.success);
    const refused = results.filter((r) => !r.success);
    expect(ran).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ error: "permit_required", governance: { rejected: "permit_required" } });
    expect(refused[0]!.data).toMatchObject({
      authorization: { remediationHints: [expect.objectContaining({ condition: "handle_invalid" })] },
      permit: expect.objectContaining({ condition: "handle_invalid", verdict: "exhausted", reason: "exhausted" }),
    });
    expect(presentedObservations().map((o) => o.verdict).sort()).toEqual(["exhausted", "valid"]);
    expect(h.permits[0]!.useCount).toBe(1);
  });

  it("enforced binding: a failed use count downgrades to shadow and records why; it never refuses", async () => {
    promote(FIXTURE_CHECKPOINT);
    const handle = await checkpointHandle(FIXTURE_CHECKPOINT);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    install({ gppPermitStore: { ...h.store, consumePermit: async () => { throw new Error("db down"); } } });

    const result = await call(TOOL, ARGS, { permitHandle: handle });

    expect(result.success).toBe(true);
    expect(h.execute).toHaveBeenCalledOnce();
    expect(presentedObservations().at(-1)).toMatchObject({
      enforcement: "shadow",
      detail: expect.objectContaining({
        consumeFailed: true,
        enforcement: expect.objectContaining({ outcome: "enforcement_downgraded", reason: "permit-consume-failed" }),
      }),
    });
    errors.mockRestore();
  });
});

describe("PR-G #2: the minted handle's expiry travels with it", () => {
  it("an admitted consequential call reports the handle and its expiry", async () => {
    const result = await call(TOOL, ARGS);

    const row = h.permits[0]!;
    expect(result.governance?.permit?.handle).toBe(`gpp1.${row.permitId}.k1.${row.mac}`);
    expect(result.governance?.permitHandleExpiresAt).toBe(row.expiresAt.toISOString());
  });

  it.each([["a read", "query_backlog"], ["a write", "create_backlog_item"], ["an unadmitted O/A/I call", "deploy_feature"]])(
    "%s carries neither",
    async (_label, toolName) => {
      const result = await call(toolName, { title: "x", buildId: "FB-1" });
      expect(result.governance).not.toHaveProperty("permit");
      expect(result.governance).not.toHaveProperty("permitHandleExpiresAt");
    },
  );
});
