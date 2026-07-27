import { describe, expect, it } from "vitest";

import { NOTATION_OPTIONS } from "./CreateViewButton";

describe("CreateViewButton notation options", () => {
  it("allows authorized authors to create SysML views", () => {
    expect(NOTATION_OPTIONS).toContainEqual({ slug: "sysml2", label: "SysML 2" });
  });
});
