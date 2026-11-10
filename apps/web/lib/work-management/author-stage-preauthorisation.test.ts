import { describe, expect, it } from "vitest";

import {
  AUTHOR_STAGE_PREAUTHORISATION_CONFIG_KEY,
  AUTHOR_STAGE_PREAUTHORISATION_SCOPE,
  grantAuthorStagePreauthorisationRecord,
  parseAuthorStagePreauthorisation,
  resolveAuthorStagePreauthorisation,
  revokeAuthorStagePreauthorisationRecord,
  writeAuthorStagePreauthorisation,
} from "./author-stage-preauthorisation";

const NOW = new Date("2026-10-07T12:00:00.000Z");
const granted = grantAuthorStagePreauthorisationRecord({ userId: "user-op", reason: "Operator chose all shapes within budget", now: NOW });

function ports(value: unknown, operatorOk = true) {
  return {
    readConfig: async (key: string) => (key === AUTHOR_STAGE_PREAUTHORISATION_CONFIG_KEY ? value : null),
    operatorMayAuthorise: async () => operatorOk,
  };
}

describe("resolveAuthorStagePreauthorisation (BI-8A32EBFF AC-3)", () => {
  it("is not in force when nothing is recorded: the shipped default is off", async () => {
    const result = await resolveAuthorStagePreauthorisation(ports(null));
    expect(result.state).toBe("not-in-force");
    if (result.state === "not-in-force") expect(result.because).toMatch(/No operator pre-authorisation is recorded/);
  });

  it("is in force for a complete granted record whose operator still holds the authority", async () => {
    const result = await resolveAuthorStagePreauthorisation(ports(granted));
    expect(result).toEqual({ state: "in-force", setByUserId: "user-op", setAt: NOW.toISOString(), reason: granted.reason });
  });

  it("is not in force once revoked, and says who revoked it", async () => {
    const revoked = revokeAuthorStagePreauthorisationRecord(granted, { userId: "user-2", reason: "Pause autonomy for the release", now: NOW });
    const result = await resolveAuthorStagePreauthorisation(ports(revoked));
    expect(result.state).toBe("not-in-force");
    if (result.state === "not-in-force") expect(result.because).toMatch(/revoked by user-2/);
  });

  it("is not in force when the operator behind it lost the authority (missing authority escalates)", async () => {
    const result = await resolveAuthorStagePreauthorisation(ports(granted, false));
    expect(result.state).toBe("not-in-force");
    if (result.state === "not-in-force") expect(result.because).toMatch(/no longer active or no longer holds manage_platform/);
  });

  it("is not in force for a malformed or out-of-scope record", async () => {
    expect((await resolveAuthorStagePreauthorisation(ports({ enabled: true }))).state).toBe("not-in-force");
    expect(parseAuthorStagePreauthorisation({ ...granted, scope: "close-when-gate-allows" })?.scope).toBe("close-when-gate-allows");
    const outOfScope = await resolveAuthorStagePreauthorisation(ports({ ...granted, scope: "close-when-gate-allows" }));
    expect(outOfScope.state).toBe("not-in-force");
  });
});

describe("writeAuthorStagePreauthorisation", () => {
  function db(initial: unknown = null) {
    let stored = initial;
    return {
      get stored() { return stored; },
      platformConfig: {
        findUnique: async () => (stored === null ? null : { value: stored }),
        upsert: async (args: { create: { value: unknown } }) => { stored = args.create.value; return {}; },
      },
    };
  }

  it("records who granted it, when and why, with the scope", async () => {
    const store = db();
    const result = await writeAuthorStagePreauthorisation(store, { action: "grant", userId: "user-op", reason: "All shapes within budget", now: NOW });
    expect(result.ok).toBe(true);
    expect(store.stored).toMatchObject({ scope: AUTHOR_STAGE_PREAUTHORISATION_SCOPE, enabled: true, setByUserId: "user-op", setAt: NOW.toISOString() });
  });

  it("refuses a short reason", async () => {
    const result = await writeAuthorStagePreauthorisation(db(), { action: "grant", userId: "user-op", reason: "ok", now: NOW });
    expect(result.ok).toBe(false);
  });

  it("revokes keeping the grant's provenance, and refuses when nothing is in force", async () => {
    const store = db(granted);
    const result = await writeAuthorStagePreauthorisation(store, { action: "revoke", userId: "user-2", reason: "Stop for the release window", now: NOW });
    expect(result.ok).toBe(true);
    expect(store.stored).toMatchObject({ enabled: false, setByUserId: "user-op", revokedByUserId: "user-2" });
    const again = await writeAuthorStagePreauthorisation(store, { action: "revoke", userId: "user-2", reason: "Stop for the release window", now: NOW });
    expect(again.ok).toBe(false);
  });
});

describe("loadAuthorStagePreauthorisationView", () => {
  const users = { findMany: async () => [{ id: "user-op", email: "op@example.test" }] };
  const load = async (value: unknown) => {
    const { loadAuthorStagePreauthorisationView } = await import("./author-stage-preauthorisation-view");
    return loadAuthorStagePreauthorisationView({ platformConfig: { findUnique: async () => (value === null ? null : { value }) }, user: users });
  };

  it("reads off with no record: the shipped default", async () => {
    expect(await load(null)).toMatchObject({ state: "off", grant: null, recordProblem: false });
  });

  it("reads on with who, when and why", async () => {
    expect(await load(granted)).toMatchObject({ state: "on", grant: { by: "op@example.test", at: NOW.toISOString() } });
  });

  it("flags a record for another scope as unusable", async () => {
    expect(await load({ ...granted, scope: "close-when-gate-allows" })).toMatchObject({ state: "off", recordProblem: true });
  });
});
