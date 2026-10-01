// GPP Phase 2, PR-C — permit verdicts (pure) and the fail-open observation sink.
// Plan: docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md (PR-C).
import { afterEach, describe, expect, it, vi } from "vitest";

import { AUTHORITY_APPROVAL_TTL_MS } from "@/lib/coworker/authority-approval-envelope";

import { GPP_BINDINGS } from "./bindings";
import { canonicalPermitClaims } from "./permit-claims";
import { GPP_PERMIT_TTL_MS, shadowPermitClaims } from "./permit-mint";
import { setGppPermitStoreOverrideForTests } from "./permit-store";
import { evaluatePermitVerdict, recordPermitObservation, resolveMonitorPermit } from "./permit-verdict";

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

  it("live as long as the approval a checkpoint permit cites", () => {
    expect(GPP_PERMIT_TTL_MS).toBe(AUTHORITY_APPROVAL_TTL_MS);
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
  const failing = { createPermit: boom, findPermitByPermitId: boom, consumePermit: boom, createObservation: boom };

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
    expect(outcome).toEqual({ verdict: "ungoverned", permitId: null, permitRowId: null, bindingId: null, detail: {} });
  });
});
