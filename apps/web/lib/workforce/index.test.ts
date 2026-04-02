import { describe, expect, it } from "vitest";
import * as Workforce from "./index";

describe("workforce barrel export", () => {
  it("exports all public symbols", () => {
    expect(Object.keys(Workforce).sort()).toMatchSnapshot();
  });

  it("includes key types and functions", () => {
    expect(Workforce).toHaveProperty("validateLifecycleTransition");
    expect(Workforce).toHaveProperty("buildWorkforceContext");
  });
});
