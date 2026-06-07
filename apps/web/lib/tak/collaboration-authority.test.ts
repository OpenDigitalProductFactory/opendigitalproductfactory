import { describe, expect, it } from "vitest";
import { isHandoffPermitted } from "./collaboration-authority";

describe("isHandoffPermitted", () => {
  it("permits a target listed in delegatesTo", () => {
    expect(
      isHandoffPermitted({ delegatesTo: ["AGT-110", "AGT-111"], escalatesTo: null, targetIds: ["AGT-111"] }),
    ).toBe(true);
  });

  it("permits the escalatesTo target", () => {
    expect(
      isHandoffPermitted({ delegatesTo: [], escalatesTo: "AGT-ORCH-000", targetIds: ["AGT-ORCH-000"] }),
    ).toBe(true);
  });

  it("matches on either the agentId or the slug in targetIds", () => {
    expect(
      isHandoffPermitted({ delegatesTo: ["ea-architect"], escalatesTo: null, targetIds: ["AGT-WS-EA", "ea-architect"] }),
    ).toBe(true);
  });

  it("denies a target not in delegatesTo or escalatesTo", () => {
    expect(
      isHandoffPermitted({ delegatesTo: ["AGT-110"], escalatesTo: "AGT-ORCH-000", targetIds: ["AGT-999"] }),
    ).toBe(false);
  });

  it("fails closed when no delegation authority is declared", () => {
    expect(
      isHandoffPermitted({ delegatesTo: [], escalatesTo: null, targetIds: ["AGT-111"] }),
    ).toBe(false);
  });
});
