// EP-SOVEREIGN-SOC P2c — SIEM tool grant coverage + implication guard.
import { describe, expect, it } from "vitest";

import { isToolAllowedByGrants } from "./agent-grants";

const READ_TOOLS = ["query_security_events", "query_detections", "get_security_case"];

describe("SIEM tool grant coverage", () => {
  it("read tools require siem_read and reject unrelated grants", () => {
    for (const t of READ_TOOLS) {
      expect(isToolAllowedByGrants(t, ["siem_read"])).toBe(true);
      expect(isToolAllowedByGrants(t, ["registry_read"])).toBe(false);
    }
  });

  it("case writes require siem_investigate (read alone cannot write)", () => {
    for (const t of ["open_security_case", "update_security_case"]) {
      expect(isToolAllowedByGrants(t, ["siem_investigate"])).toBe(true);
      expect(isToolAllowedByGrants(t, ["siem_read"])).toBe(false);
    }
  });

  it("tuning requires siem_tune; response requires incident_respond", () => {
    expect(isToolAllowedByGrants("propose_detection_tuning", ["siem_tune"])).toBe(true);
    expect(isToolAllowedByGrants("propose_detection_tuning", ["siem_read"])).toBe(false);
    expect(isToolAllowedByGrants("propose_response", ["incident_respond"])).toBe(true);
    expect(isToolAllowedByGrants("propose_response", ["siem_investigate"])).toBe(false);
  });

  it("write grants imply read (one-way) — a responder can read its cases", () => {
    expect(isToolAllowedByGrants("get_security_case", ["incident_respond"])).toBe(true);
    expect(isToolAllowedByGrants("query_detections", ["siem_investigate"])).toBe(true);
    expect(isToolAllowedByGrants("query_security_events", ["siem_tune"])).toBe(true);
  });

  it("an unmapped security-ish tool is default-denied even with siem grants", () => {
    expect(
      isToolAllowedByGrants("delete_all_security_events", ["siem_read", "incident_respond"]),
    ).toBe(false);
  });
});
