import { describe, expect, it } from "vitest";
import * as Shared from "./index";

describe("shared barrel export", () => {
  it("exports all public symbols", () => {
    expect(Object.keys(Shared).sort()).toMatchSnapshot();
  });

  it("includes key utilities", () => {
    expect(Shared).toHaveProperty("parseCSV");
    expect(Shared).toHaveProperty("parseFileContent");
    expect(Shared).toHaveProperty("safeRenderValue");
    expect(Shared).toHaveProperty("parseICal");
  });
});
