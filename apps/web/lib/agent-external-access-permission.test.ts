import { describe, expect, it } from "vitest";
import { buildExternalAccessDisabledInstruction } from "./agent-external-access-permission";

const TOOLS = [{ name: "search_public_web", description: "Search the public web" }];

describe("buildExternalAccessDisabledInstruction (EP-WORK-POSTURE 8.2, BI-947780FE)", () => {
  it("names the standing grant as the authority when the coworker lacks web_search", () => {
    const text = buildExternalAccessDisabledInstruction(TOOLS, {
      externalAccess: { reason: "no-web-search-grant" },
      workroomId: null,
    });
    expect(text).toContain("EXTERNAL ACCESS NOT AUTHORIZED");
    expect(text).toContain("web_search grant");
    expect(text).toContain("search_public_web");
    // The composer switch is gone: never point the employee at a control.
    expect(text.toLowerCase()).not.toContain("message box");
    expect(text.toLowerCase()).not.toContain("switch next to");
  });

  it("names the room's activity shape when the room narrows web access", () => {
    const text = buildExternalAccessDisabledInstruction(TOOLS, {
      externalAccess: { reason: "room-does-not-authorize-web" },
      workroomId: "WC-ROOM",
    });
    expect(text).toContain("WC-ROOM");
    expect(text).toContain("activity");
    expect(text).toContain("accountable owner");
  });

  it("defaults to the grant explanation when no context is supplied", () => {
    const text = buildExternalAccessDisabledInstruction(TOOLS);
    expect(text).toContain("web_search grant");
  });
});
