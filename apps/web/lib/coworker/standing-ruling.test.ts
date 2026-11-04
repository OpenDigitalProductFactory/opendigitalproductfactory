// BI-E5631708: an owner's written approval, made standing.
//
// The chain under test, against one in-memory envelope table:
//   approve with "don't ask again" → the ruling is stored on that approval →
//   the next call of the same tool by the same coworker on the owner's
//   authority is steered by it and decided with no person → a damaging call
//   of the same class still reaches a person → "ask me again" withdraws it.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string; coworkerAgentId: string; delegatingUserId: string; threadId: string;
  chatMessageId: string | null; manifestActionId: string; argsJson: Record<string, unknown>;
  approvalBindingFingerprint: string | null; authorityDecisionId: string | null; rationale: string;
  status: string; createdAt: Date; resolvedAt: Date | null; expiresAt: Date | null;
};

const store = vi.hoisted(() => ({
  envelopes: [] as Row[],
  decisions: new Map<string, { rationale: unknown }>(),
}));

function stateOf(argsJson: unknown): unknown {
  const ruling = (argsJson as Record<string, unknown> | null)?.standingRuling as Record<string, unknown> | undefined;
  return ruling?.state;
}

function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === "argsJson") {
      const filter = cond as { path: string[]; equals: unknown };
      if (stateOf(row.argsJson) !== filter.equals) return false;
      continue;
    }
    if (key === "OR") {
      const now = Date.now();
      const ok = (cond as Array<Record<string, unknown>>).some((alt) =>
        "expiresAt" in alt && (alt.expiresAt === null ? row.expiresAt === null : (row.expiresAt?.getTime() ?? 0) > now));
      if (!ok) return false;
      continue;
    }
    const value = (row as unknown as Record<string, unknown>)[key];
    if (cond && typeof cond === "object" && "in" in (cond as object)) {
      if (!(cond as { in: unknown[] }).in.includes(value)) return false;
    } else if (value !== cond) return false;
  }
  return true;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/governance-data", () => ({ createAuthorizationDecisionLog: vi.fn() }));
vi.mock("@dpf/db", () => {
  const coworkerActionEnvelope = {
    findUnique: async ({ where }: { where: { id: string } }) => store.envelopes.find((row) => row.id === where.id) ?? null,
    findMany: async ({ where, take }: { where: Record<string, unknown>; take?: number }) =>
      store.envelopes.filter((row) => matches(row, where)).slice(0, take ?? 100),
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0;
      for (const row of store.envelopes) {
        if (matches(row, where)) { Object.assign(row, data); count += 1; }
      }
      return { count };
    },
  };
  return {
    prisma: {
      coworkerActionEnvelope,
      authorizationDecisionLog: {
        findUnique: async ({ where }: { where: { decisionId: string } }) => store.decisions.get(where.decisionId) ?? null,
      },
    },
  };
});

import { approveEnvelope } from "./envelope-actions";
import {
  findStandingRuling,
  readStandingRuling,
  revokeStandingRuling,
  rulingCovers,
  standingRulingEligibility,
} from "./standing-ruling";
import { resolveSteering } from "@/lib/govern/authority/resolve-coworker-tool-authority";
import { resolveEscalation, type EscalationInput } from "@/lib/govern/authority/escalation-gate";

const OWNER = "owner-1";
const COWORKER = "AGT-OPS";
const TOOL = "release_nonprod_environment_lease";

function envelope(over: Partial<Row> = {}): Row {
  return {
    id: "env-1", coworkerAgentId: COWORKER, delegatingUserId: OWNER, threadId: "t", chatMessageId: null,
    manifestActionId: TOOL,
    argsJson: { approvalBinding: { actingHumanUserId: OWNER, actingAgentId: COWORKER, toolName: TOOL } },
    approvalBindingFingerprint: "fp-1", authorityDecisionId: "AUTH-1", rationale: "r",
    status: "proposed", createdAt: new Date(), resolvedAt: null, expiresAt: new Date(Date.now() + 60_000),
    ...over,
  };
}

const UNSTEERED = { damaging: false, escalationReason: "unsteered-side-effect", escalationSteering: "none" };
const CALL = { coworkerAgentIds: [COWORKER], toolName: TOOL, delegatingUserId: OWNER };

/** The gate's input for the coworker's next call, steered as the resolver would steer it. */
async function nextCall(over: Partial<EscalationInput["action"]> = {}, sensitivity: EscalationInput["dataPolicy"]["sensitivity"] = "internal", hitlPolicy: string | null = null) {
  const ruling = await findStandingRuling(CALL);
  const steering = resolveSteering({
    hitlPolicy,
    initiativeReviewBinding: null,
    roomAuthority: null,
    agentId: COWORKER,
    toolName: TOOL,
    standingRulingEnvelopeId: ruling?.envelopeId ?? null,
  });
  return resolveEscalation({
    action: { sideEffect: true, executionMode: "immediate", consequence: null, ...over },
    dataPolicy: { sensitivity },
    operatorRequiresApproval: true,
    steering,
  });
}

beforeEach(() => {
  store.envelopes = [envelope()];
  store.decisions = new Map([["AUTH-1", { rationale: UNSTEERED }]]);
});

describe("an approval made standing (BI-E5631708)", () => {
  it("asks a person before the ruling exists", async () => {
    expect(await nextCall()).toMatchObject({ verdict: "human", reasonCode: "unsteered-side-effect" });
  });

  it("records the ruling on the owner's approval, then lets the next equivalent call run with no envelope", async () => {
    const result = await approveEnvelope("env-1", OWNER, undefined, { makeStanding: true });
    expect(result).toMatchObject({ ok: true, standing: { recorded: true } });
    expect(readStandingRuling(store.envelopes[0].argsJson)).toMatchObject({
      state: "active",
      ruledBy: OWNER,
      actionClass: { coworkerAgentId: COWORKER, toolName: TOOL, delegatingUserId: OWNER },
    });
    // The approval itself is unchanged: still the person's own decision.
    expect(store.envelopes[0]).toMatchObject({ status: "approved", argsJson: { humanApproval: expect.any(Object) } });

    expect(await nextCall()).toEqual({
      verdict: "automated", reasonCode: "steered-by-standing-ruling", damaging: false, steering: "standing-ruling",
    });
  });

  it("still sends a damaging call of the same class to a person", async () => {
    await approveEnvelope("env-1", OWNER, undefined, { makeStanding: true });
    for (const consequence of ["outward", "irreversible", "authority"] as const) {
      expect(await nextCall({ consequence })).toMatchObject({
        verdict: "human", reasonCode: "damaging-consequence", damaging: true, steering: "standing-ruling",
      });
    }
    expect(await nextCall({}, "restricted")).toMatchObject({ verdict: "human", reasonCode: "damaging-sensitivity" });
    expect(await nextCall({ workCaseConsequential: true })).toMatchObject({ verdict: "human", reasonCode: "damaging-work-case" });
  });

  it("yields to an operator policy of always asking", async () => {
    await approveEnvelope("env-1", OWNER, undefined, { makeStanding: true });
    expect(await nextCall({}, "internal", " Always ")).toMatchObject({ verdict: "human", steering: "none" });
  });

  it("covers only its exact class: another coworker, tool or owner is still asked", async () => {
    await approveEnvelope("env-1", OWNER, undefined, { makeStanding: true });
    expect(await findStandingRuling({ ...CALL, coworkerAgentIds: ["AGT-OTHER"] })).toBeNull();
    expect(await findStandingRuling({ ...CALL, toolName: "create_portal_pr" })).toBeNull();
    expect(await findStandingRuling({ ...CALL, delegatingUserId: "someone-else" })).toBeNull();
  });

  it("makes nothing standing when not asked to", async () => {
    const result = await approveEnvelope("env-1", OWNER);
    expect(result.ok && result.standing).toBeUndefined();
    expect(readStandingRuling(store.envelopes[0].argsJson)).toBeNull();
    expect(await findStandingRuling(CALL)).toBeNull();
  });

  it("refuses to make a damaging approval standing, and still approves it once", async () => {
    store.decisions.set("AUTH-1", { rationale: { damaging: true, escalationReason: "damaging-consequence" } });
    const result = await approveEnvelope("env-1", OWNER, undefined, { makeStanding: true });
    expect(result).toMatchObject({ ok: true, envelope: { status: "approved" }, standing: { recorded: false, reason: "damaging" } });
    expect(await findStandingRuling(CALL)).toBeNull();
  });

  it("refuses an admin deciding on the owner's behalf", async () => {
    const result = await approveEnvelope("env-1", "admin-1", { reason: "Owner is away.", callerIsAdmin: true }, { makeStanding: true });
    expect(result).toMatchObject({ ok: true, standing: { recorded: false, reason: "decided-on-behalf" } });
    expect(await findStandingRuling(CALL)).toBeNull();
  });

  it("refuses when the gate's decision for the request was not recorded", async () => {
    store.decisions.clear();
    const result = await approveEnvelope("env-1", OWNER, undefined, { makeStanding: true });
    expect(result).toMatchObject({ ok: true, standing: { recorded: false, reason: "decision-unrecorded" } });
  });

  it("stops steering once the owner asks to be asked again", async () => {
    await approveEnvelope("env-1", OWNER, undefined, { makeStanding: true });
    expect(await revokeStandingRuling("env-1", "someone-else")).toMatchObject({ ok: false, httpStatus: 403 });
    expect(await revokeStandingRuling("env-1", OWNER)).toEqual({ ok: true, revoked: 1 });
    expect(readStandingRuling(store.envelopes[0].argsJson)).toMatchObject({ state: "revoked", revokedBy: OWNER });
    expect(await nextCall()).toMatchObject({ verdict: "human", reasonCode: "unsteered-side-effect" });
  });
});

describe("standingRulingEligibility", () => {
  const base = { envelope: envelope(), decisionRationale: UNSTEERED, onBehalf: false };

  it("allows only a non-damaging request a person was asked solely for lack of steering", () => {
    expect(standingRulingEligibility(base)).toMatchObject({ eligible: true });
    expect(standingRulingEligibility({ ...base, decisionRationale: { damaging: false, escalationReason: "declared-proposal" } }))
      .toEqual({ eligible: false, reason: "not-unsteered" });
    expect(standingRulingEligibility({ ...base, decisionRationale: { escalationReason: "unsteered-side-effect" } }))
      .toEqual({ eligible: false, reason: "decision-unrecorded" });
  });

  it("refuses a screen envelope, a propose-boundary request and a binding for someone else", () => {
    expect(standingRulingEligibility({ ...base, envelope: envelope({ argsJson: { title: "x" } }) }))
      .toEqual({ eligible: false, reason: "not-an-authority-request" });
    expect(standingRulingEligibility({ ...base, envelope: envelope({ argsJson: { ...envelope().argsJson, proposeBoundary: true } }) }))
      .toEqual({ eligible: false, reason: "raised-under-propose-boundary" });
    expect(standingRulingEligibility({ ...base, envelope: envelope({ delegatingUserId: "admin-1" }) }))
      .toEqual({ eligible: false, reason: "binding-owner-mismatch" });
  });
});

describe("readStandingRuling / rulingCovers", () => {
  const ruling = {
    version: 1, state: "active", ruledBy: OWNER, ruledAt: "2026-11-04T00:00:00.000Z",
    actionClass: { coworkerAgentId: COWORKER, toolName: TOOL, delegatingUserId: OWNER },
  };

  it("treats a malformed or unversioned ruling as no ruling", () => {
    expect(readStandingRuling({ standingRuling: { ...ruling, version: 2 } })).toBeNull();
    expect(readStandingRuling({ standingRuling: { ...ruling, actionClass: { coworkerAgentId: COWORKER } } })).toBeNull();
    expect(readStandingRuling({ standingRuling: { ...ruling, state: "forever" } })).toBeNull();
  });

  it("does not cover a ruling someone other than the owner recorded", () => {
    expect(rulingCovers(readStandingRuling({ standingRuling: ruling }), CALL)).toBe(true);
    expect(rulingCovers(readStandingRuling({ standingRuling: { ...ruling, ruledBy: "admin-1" } }), CALL)).toBe(false);
  });
});
