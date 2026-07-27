import { describe, expect, it } from "vitest";

import {
  createRehydrationToken,
  readRehydrationTokenMap,
  storeRehydrationTokenMap,
  type StoredRehydrationToken,
} from "./rehydration-token-vault";

const binding = {
  expectedActor: {
    principalId: "PRN-manager",
    actingHumanUserId: "user-manager",
    actingAgentId: null,
    delegationGrantId: null,
  },
  purpose: "coworker-assistance" as const,
  surface: "private-employee" as const,
  subject: { kind: "employee" as const, id: "emp-report" },
  sensitivity: "confidential" as const,
  decisionVersions: [{
    decisionId: "ddp_employee",
    assetVersion: "asset-v1",
    classificationVersion: "classification-v1",
    authorityVersion: "authority-v1",
  }],
  dataClasses: ["employee-records" as const],
};

describe("rehydration token vault", () => {
  it("stores immutable token bindings behind an opaque bounded handle", () => {
    const raw = "ada@example.com";
    const token = createRehydrationToken(raw);
    const stored: StoredRehydrationToken = {
      value: raw,
      bindings: [binding],
    };
    const tokens = new Map([[token, stored]]);

    const handle = storeRehydrationTokenMap(tokens, { now: 1_000 });
    stored.value = "mutated@example.com";
    stored.bindings.length = 0;

    expect(handle).toMatch(/^rehydration_[a-f0-9]{24}$/);
    expect(readRehydrationTokenMap(handle, { now: 1_001 })).toEqual({
      status: "available",
      tokens: new Map([[
        token,
        {
          value: raw,
          bindings: [binding],
        },
      ]]),
    });
  });

  it("fails closed after expiry without exposing why a handle is unavailable", () => {
    const token = createRehydrationToken("555-867-5309");
    const handle = storeRehydrationTokenMap(
      new Map([[token, { value: "555-867-5309", bindings: [binding] }]]),
      { now: 2_000, ttlMs: 25 },
    );

    expect(readRehydrationTokenMap(handle, { now: 2_026 })).toEqual({
      status: "unavailable",
    });
    expect(readRehydrationTokenMap("rehydration_missing", { now: 2_026 })).toEqual({
      status: "unavailable",
    });
  });
});
