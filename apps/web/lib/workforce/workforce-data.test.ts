import { describe, expect, it } from "vitest";
import { summarizeEmployeeDisplayName } from "./workforce-data";

describe("summarizeEmployeeDisplayName", () => {
  it("prefers displayName when present", () => {
    expect(summarizeEmployeeDisplayName({
      firstName: "Ada",
      lastName: "Lovelace",
      displayName: "Ada Lovelace",
    })).toBe("Ada Lovelace");
  });
});
