// GPP Phase 2, PR-C — permit verdicts (pure) and the fail-open observation sink.
// Plan: docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md (PR-C).
import { afterEach, describe, expect, it, vi } from "vitest";

import { APPROVAL_DECISION_WINDOW_MS } from "@/lib/coworker/approval-lifetime";

import { GPP_BINDINGS } from "./bindings";
import { canonicalPermitClaims } from "./permit-claims";
import { GPP_PERMIT_TTL_MS, shadowPermitClaims } from "./permit-mint";
import { setGppPermitStoreOverrideForTests } from "./permit-store";
import {
  evaluatePermitVerdict,
  recordPermitObservation,
  resolveMonitorPermit,
  verdictFromChecks,
  type PermitChecks,
} from "./permit-verdict";

const NOW = new Date("2026-10-01T12:00:00Z");
const row = (patch: Partial<Parameters<typeof evaluatePermitVerdict>[0] & object> = {}) => ({
  expiresAt: new Date(NOW.getTime() + 60_000),
  revokedAt: null,
  useCount: 0,
  maxUses: 1,
  capabilities: [{ tool: "create_portal_pr" }],
  ...patch,
});
const call = { toolName: "create_portal_pr", now: NOW };

afterEach(() => setGppPermitStoreOverrideForTests(null));

describe("evaluatePermitVerdict", () => {
  it("is absent with no permit", () => {
    expect(evaluatePermitVerdict(null, call)).toBe("absent");
  });
  it("is expired at or after expiresAt", () => {
    expect(evaluatePermitVerdict(row({ expiresAt: NOW }), call)).toBe("expired");
  });
  it("is revoked once revokedAt is set, even before expiry", () => {
    expect(evaluatePermitVerdict(row({ revokedAt: new Date(NOW.getTime() - 1) }), call)).toBe("revoked");
  });
  it("is exhausted when every use is spent", () => {
    expect(evaluatePermitVerdict(row({ useCount: 1 }), call)).toBe("exhausted");
  });
  it("is tool_not_in_capabilities for a tool the permit does not grant", () => {
    expect(evaluatePermitVerdict(row(), { ...call, toolName: "contribute_to_hive" })).toBe("tool_not_in_capabilities");
  });
  it("is valid for an unspent, unexpired, unrevoked permit that grants the tool", () => {
    expect(evaluatePermitVerdict(row(), call)).toBe("valid");
  });
});

describe("shadow permit claims", () => {
  const binding = GPP_BINDINGS[0]!;

  // BI-0012E6CA: approvals now live as long as their decision, but a permit is
  // minted at the gate admit for one use, so it keeps the short decision window.
  it("live for the short decision window, from the admit that mints them", () => {
    expect(GPP_PERMIT_TTL_MS).toBe(APPROVAL_DECISION_WINDOW_MS);
    expect(GPP_PERMIT_TTL_MS).toBe(15 * 60 * 1000);
    const claims = shadowPermitClaims({ binding, toolName: "create_portal_pr", actorUserId: "u1", now: NOW });
    expect(claims.expiresAt.getTime() - NOW.getTime()).toBe(GPP_PERMIT_TTL_MS);
    expect(claims).toMatchObject({ enforcement: "shadow", maxUses: 1, capabilities: [{ tool: "create_portal_pr" }] });
  });

  it("canonicalise independently of key order and render dates as ISO strings", () => {
    const claims = shadowPermitClaims({ binding, toolName: "create_portal_pr", actorUserId: "u1", now: NOW });
    const reordered = Object.fromEntries(Object.entries(claims).reverse()) as typeof claims;
    expect(canonicalPermitClaims(reordered)).toBe(canonicalPermitClaims(claims));
    expect(canonicalPermitClaims(claims)).toContain(`"notBefore":"${NOW.toISOString()}"`);
  });
});

describe("fail-open sinks", () => {
  const boom = async () => { throw new Error("db down"); };
  const failing = {
    createPermit: boom, findPermitByPermitId: boom, consumePermit: boom, createObservation: boom, findLineage: boom,
  };

  it("recordPermitObservation never throws", async () => {
    setGppPermitStoreOverrideForTests(failing);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(recordPermitObservation({
      permitRowId: null, bindingId: null, toolName: "t", verdict: "absent",
      path: "monitor", toolExecutionId: null, callerSite: null, detail: {},
    })).resolves.toBeUndefined();
    errors.mockRestore();
  });

  it("resolveMonitorPermit records absent, not a refusal, when the mint fails", async () => {
    setGppPermitStoreOverrideForTests(failing);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const outcome = await resolveMonitorPermit({
      toolName: "create_portal_pr", tool: { consequential: true }, alignmentApproved: true,
      alignmentInteractionId: "DI-1", approvedEnvelopeId: null, authorityDecisionId: null,
      actorUserId: "u1", actorAgentId: null, workroomId: null,
    });
    expect(outcome).toMatchObject({ verdict: "absent", permitId: null, bindingId: "tak-alignment-admit" });
    errors.mockRestore();
  });

  it("is ungoverned when no gate admitted and no handle was presented", async () => {
    const outcome = await resolveMonitorPermit({
      toolName: "deploy_feature", tool: { consequential: true }, alignmentApproved: false,
      alignmentInteractionId: null, approvedEnvelopeId: null, authorityDecisionId: null,
      actorUserId: "u1", actorAgentId: null, workroomId: null,
    });
    expect(outcome).toEqual({
      verdict: "ungoverned", permitId: null, permitRowId: null, bindingId: null, handle: null, detail: {},
    });
  });
});

describe("verdictFromChecks (PR-D verification order)", () => {
  const clean: PermitChecks = { mac: "ok", paramHash: "match", lineage: "sealed", state: "valid" };

  it("is the PR-C state when every PR-D check passes", () => {
    expect(verdictFromChecks(clean)).toBe("valid");
    expect(verdictFromChecks({ ...clean, state: "expired" })).toBe("expired");
  });

  it("orders MAC, then paramHash, then lineage, then state", () => {
    const all: PermitChecks = { mac: "invalid", paramHash: "mismatch", lineage: "missing", state: "expired" };
    expect(verdictFromChecks(all)).toBe("mac_invalid");
    expect(verdictFromChecks({ ...all, mac: "unsigned" })).toBe("unsigned");
    expect(verdictFromChecks({ ...all, mac: "ok" })).toBe("param_mismatch");
    expect(verdictFromChecks({ ...all, mac: "ok", paramHash: "match" })).toBe("lineage_missing");
    expect(verdictFromChecks({ ...all, mac: "ok", paramHash: "match", lineage: "unsealed" })).toBe("lineage_unsealed");
  });

  it("decides nothing on a failed lineage lookup or an unbound / unchecked paramHash", () => {
    expect(verdictFromChecks({ ...clean, lineage: "lookup_failed" })).toBe("valid");
    expect(verdictFromChecks({ ...clean, paramHash: "not_bound" })).toBe("valid");
    expect(verdictFromChecks({ ...clean, paramHash: "not_checked" })).toBe("valid");
  });
});
