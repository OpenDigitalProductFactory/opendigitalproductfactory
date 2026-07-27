import { describe, expect, it } from "vitest";
import {
  coworkerIdFromRecordRoute,
  resolveSelectedCoworkerForRoute,
} from "./selected-coworker-route";

describe("coworkerIdFromRecordRoute", () => {
  it("decodes one safe coworker identifier", () => {
    expect(
      coworkerIdFromRecordRoute(
        "/platform/ai/agent/AGT-WS-CUSTOMER?tab=overview",
      ),
    ).toBe("AGT-WS-CUSTOMER");
  });

  it("rejects nested, malformed, or non-record routes", () => {
    expect(coworkerIdFromRecordRoute("/platform/ai/agent/one/more")).toBeNull();
    expect(coworkerIdFromRecordRoute("/platform/ai/agent/%2F")).toBeNull();
    expect(coworkerIdFromRecordRoute("/platform/ai/overview")).toBeNull();
  });
});

describe("resolveSelectedCoworkerForRoute", () => {
  it("projects the selected identity without widening platform access", () => {
    expect(
      resolveSelectedCoworkerForRoute(
        "/platform/ai/agent/customer-advisor",
        { platformRole: null, isSuperuser: false },
      ),
    ).toMatchObject({
      agentId: "customer-advisor",
      agentName: "Customer Advisor",
      canAssist: false,
    });
  });
});
