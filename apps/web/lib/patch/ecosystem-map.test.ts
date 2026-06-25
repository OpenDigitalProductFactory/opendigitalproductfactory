import { describe, expect, it } from "vitest";

import { osvEcosystemFor } from "./ecosystem-map";

describe("osvEcosystemFor", () => {
  it("maps language package managers to OSV ecosystems", () => {
    expect(osvEcosystemFor("npm")).toBe("npm");
    expect(osvEcosystemFor("pip")).toBe("PyPI");
    expect(osvEcosystemFor("PyPI")).toBe("PyPI");
    expect(osvEcosystemFor("cargo")).toBe("crates.io");
    expect(osvEcosystemFor("nuget")).toBe("NuGet");
  });

  it("returns null for OS package managers that need distro context", () => {
    expect(osvEcosystemFor("dpkg")).toBeNull();
    expect(osvEcosystemFor("rpm")).toBeNull();
    expect(osvEcosystemFor("brew")).toBeNull();
    expect(osvEcosystemFor("powershell")).toBeNull();
    expect(osvEcosystemFor(null)).toBeNull();
    expect(osvEcosystemFor(undefined)).toBeNull();
  });
});
