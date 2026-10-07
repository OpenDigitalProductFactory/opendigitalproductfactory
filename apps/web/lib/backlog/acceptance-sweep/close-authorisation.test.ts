import { describe, expect, it, vi } from "vitest";

import { getAgentToolGrants, isToolAllowedByGrants } from "@/lib/tak/agent-grants";

import {
  CLOSE_AUTHORISATION_CONFIG_KEY,
  COMPLETION_TRANSITION_TOOL,
  DEFAULT_CLOSE_LIMIT,
  MAX_CLOSE_LIMIT,
  grantCloseAuthorisationRecord,
  parseCloseAuthorisation,
  resolveCloseAuthorisation,
  revokeCloseAuthorisationRecord,
  type CloseAuthorisationPorts,
} from "./close-authorisation";

// BI-45D3BBF4 AC-1: the pre-authorisation is a recorded, revocable operator
// setting; absent, revoked, malformed or out of scope, nothing is closed.

const SET_AT = new Date("2026-10-01T09:00:00.000Z");
const granted = grantCloseAuthorisationRecord({ userId: "user-operator", reason: "Operator pre-authorised (BI-8A32EBFF).", now: SET_AT });

function ports(value: unknown, overrides: Partial<CloseAuthorisationPorts> = {}): CloseAuthorisationPorts {
  return {
    readConfig: vi.fn(async (key: string) => (key === CLOSE_AUTHORISATION_CONFIG_KEY ? value : null)),
    operatorMayCloseBacklog: vi.fn(async () => true),
    agentCompletionGrant: vi.fn(async () => "backlog_write"),
    ...overrides,
  };
}

describe("resolveCloseAuthorisation", () => {
  it("defaults to disabled when nothing is recorded", async () => {
    const result = await resolveCloseAuthorisation("AGT-WS-PORTFOLIO", ports(null));
    expect(result).toMatchObject({ state: "disabled", reason: "not-recorded" });
  });

  it("is enabled with the operator's provenance and the held grant when a grant is in force", async () => {
    const p = ports(granted);
    const result = await resolveCloseAuthorisation("AGT-WS-PORTFOLIO", p);
    expect(result).toEqual({
      state: "enabled",
      setByUserId: "user-operator",
      setAt: SET_AT.toISOString(),
      reason: "Operator pre-authorised (BI-8A32EBFF).",
      limit: DEFAULT_CLOSE_LIMIT,
      agentGrant: "backlog_write",
    });
    expect(p.operatorMayCloseBacklog).toHaveBeenCalledWith("user-operator");
    expect(p.agentCompletionGrant).toHaveBeenCalledWith("AGT-WS-PORTFOLIO");
  });

  it("is disabled after a revocation, and says who revoked it and why", async () => {
    const revoked = revokeCloseAuthorisationRecord(granted, {
      userId: "user-second",
      reason: "Pausing closures while the gate is reviewed.",
      now: new Date("2026-10-03T09:00:00.000Z"),
    });
    const result = await resolveCloseAuthorisation("AGT-WS-PORTFOLIO", ports(revoked));
    expect(result.state).toBe("disabled");
    if (result.state === "disabled") {
      expect(result.reason).toBe("revoked");
      expect(result.because).toContain("user-second");
      expect(result.because).toContain("Pausing closures");
    }
  });

  it("is disabled for a record without provenance or with another scope", async () => {
    const { setByUserId: _omit, ...noWho } = granted;
    expect(await resolveCloseAuthorisation("A", ports(noWho))).toMatchObject({ state: "disabled", reason: "malformed" });
    expect(await resolveCloseAuthorisation("A", ports({ ...granted, scope: "close-anything" })))
      .toMatchObject({ state: "disabled", reason: "out-of-scope" });
  });

  it("is disabled when the authorising operator no longer holds manage_backlog", async () => {
    const result = await resolveCloseAuthorisation("A", ports(granted, { operatorMayCloseBacklog: async () => false }));
    expect(result).toMatchObject({ state: "disabled", reason: "operator-not-authorised" });
  });

  it("is disabled, and grants nothing, when the coworker holds no completion grant", async () => {
    const result = await resolveCloseAuthorisation("A", ports(granted, { agentCompletionGrant: async () => null }));
    expect(result).toMatchObject({ state: "disabled", reason: "agent-not-granted" });
  });

  it("clamps the per-run bound", () => {
    expect(parseCloseAuthorisation({ ...granted, maxClosuresPerRun: 5 })?.maxClosuresPerRun).toBe(5);
    expect(parseCloseAuthorisation({ ...granted, maxClosuresPerRun: 10_000 })?.maxClosuresPerRun).toBe(MAX_CLOSE_LIMIT);
    expect(parseCloseAuthorisation({ ...granted, maxClosuresPerRun: 0 })?.maxClosuresPerRun).toBe(DEFAULT_CLOSE_LIMIT);
  });
});

describe("the sweep's coworker authority (no silent grant)", () => {
  it("AGT-WS-PORTFOLIO's registry grants already permit the completion transition", () => {
    // The sweep reuses the grant the seed already gives its steward; this pins it so
    // a later registry edit cannot silently strip (or a test silently assume) it.
    const grants = getAgentToolGrants("AGT-WS-PORTFOLIO");
    expect(grants).not.toBeNull();
    expect(isToolAllowedByGrants(COMPLETION_TRANSITION_TOOL, grants!)).toBe(true);
  });
});
