import { describe, expect, it } from "vitest";
import { patchOptional, trimToNull } from "./patch-optional";

// Regression guard for the hazard that kept `assignEmployeeOrg` unusable: it rewrote every
// field from its input, and the old helper collapsed `undefined` to null, so a caller that
// mentioned only the manager silently cleared department, position, work location, and
// timezone. The org chart shipped a second narrow action to avoid it (BI-HCM-004).
describe("patchOptional", () => {
  const current = "current-value";

  it("keeps the current value when the key is absent", () => {
    expect(patchOptional({}, "departmentId", current)).toBe(current);
  });

  it("keeps the current value when the key is present but undefined", () => {
    expect(patchOptional({ departmentId: undefined }, "departmentId", current)).toBe(current);
  });

  it("clears on an explicit null", () => {
    expect(patchOptional({ departmentId: null }, "departmentId", current)).toBeNull();
  });

  it("clears on an explicit empty string", () => {
    expect(patchOptional({ departmentId: "" }, "departmentId", current)).toBeNull();
  });

  it("clears on a whitespace-only string", () => {
    expect(patchOptional({ departmentId: "   " }, "departmentId", current)).toBeNull();
  });

  it("sets and trims a supplied value", () => {
    expect(patchOptional({ departmentId: "  dept-2  " }, "departmentId", current)).toBe("dept-2");
  });

  it("leaves unmentioned siblings untouched — the actual defect", () => {
    const input = { managerEmployeeId: "mgr-9" };
    expect(patchOptional(input, "managerEmployeeId", null)).toBe("mgr-9");
    expect(patchOptional(input, "departmentId" as never, "dept-1")).toBe("dept-1");
    expect(patchOptional(input, "positionId" as never, "pos-1")).toBe("pos-1");
    expect(patchOptional(input, "workLocationId" as never, "loc-1")).toBe("loc-1");
    expect(patchOptional(input, "timezone" as never, "Europe/London")).toBe("Europe/London");
  });

  it("treats a null current value as a valid starting point", () => {
    expect(patchOptional({}, "departmentId", null)).toBeNull();
  });
});

describe("trimToNull", () => {
  it("nulls blank, whitespace, undefined, and null", () => {
    expect(trimToNull("")).toBeNull();
    expect(trimToNull("   ")).toBeNull();
    expect(trimToNull(undefined)).toBeNull();
    expect(trimToNull(null)).toBeNull();
  });

  it("trims a real value", () => {
    expect(trimToNull("  x  ")).toBe("x");
  });
});
