import { describe, expect, it } from "vitest";
import { buildExternalAccessDisabledInstruction } from "./agent-external-access-permission";

describe("buildExternalAccessDisabledInstruction (BI-49690A99)", () => {
  it("names the Web access composer control so the user knows where to flip it", () => {
    const text = buildExternalAccessDisabledInstruction([
      { name: "search_public_web", description: "Search the public web" },
    ]);
    expect(text).toContain("Web access");
    expect(text.toLowerCase()).toContain("message box");
    expect(text).toContain("search_public_web");
    expect(text.toLowerCase()).not.toContain("open the build details");
  });
});
