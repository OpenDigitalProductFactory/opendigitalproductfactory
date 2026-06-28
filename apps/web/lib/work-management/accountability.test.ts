import { describe, expect, it } from "vitest";

import {
  WORK_CASE_AUTHORITY_MODES,
  validateWorkCaseAccountability,
} from "./accountability";

describe("Work Case accountability", () => {
  it("defines the authority mode vocabulary from the Work Case spec", () => {
    expect(WORK_CASE_AUTHORITY_MODES).toEqual([
      "autonomous",
      "on-behalf-of",
      "authenticated-inbound",
    ]);
  });

  it("allows person actors without an agent sponsor", () => {
    expect(
      validateWorkCaseAccountability({
        actor: { actorKind: "person", actorId: "prn-user-1" },
        authorityMode: "autonomous",
      }),
    ).toMatchObject({ ok: true });
  });

  it("denies autonomous agent actors without a sponsor", () => {
    expect(
      validateWorkCaseAccountability({
        actor: { actorKind: "agent", actorId: "agt-1" },
        authorityMode: "autonomous",
      }),
    ).toEqual({
      ok: false,
      reason: "missing_agent_sponsor",
      message: "Agent actor agt-1 requires sponsorPrincipalId for autonomous authority.",
    });
  });

  it("requires a delegating principal for on-behalf-of authority", () => {
    expect(
      validateWorkCaseAccountability({
        actor: { actorKind: "agent", actorId: "agt-1" },
        authorityMode: "on-behalf-of",
        sponsorPrincipalId: "prn-sponsor-1",
      }),
    ).toMatchObject({
      ok: false,
      reason: "missing_delegating_principal",
    });
  });

  it("allows sponsored on-behalf-of agent authority with a delegating principal", () => {
    expect(
      validateWorkCaseAccountability({
        actor: { actorKind: "agent", actorId: "agt-1" },
        authorityMode: "on-behalf-of",
        sponsorPrincipalId: "prn-sponsor-1",
        delegatingPrincipalId: "prn-human-1",
      }),
    ).toEqual({
      ok: true,
      accountablePrincipalId: "prn-sponsor-1",
    });
  });

  it("allows authenticated-inbound agent authority only when an inbound principal was verified", () => {
    expect(
      validateWorkCaseAccountability({
        actor: { actorKind: "agent", actorId: "external-agent-1" },
        authorityMode: "authenticated-inbound",
      }),
    ).toMatchObject({
      ok: false,
      reason: "missing_authenticated_inbound_principal",
    });

    expect(
      validateWorkCaseAccountability({
        actor: { actorKind: "agent", actorId: "external-agent-1" },
        authorityMode: "authenticated-inbound",
        authenticatedInboundPrincipalId: "prn-customer-agent-1",
      }),
    ).toEqual({
      ok: true,
      accountablePrincipalId: "prn-customer-agent-1",
    });
  });
});
