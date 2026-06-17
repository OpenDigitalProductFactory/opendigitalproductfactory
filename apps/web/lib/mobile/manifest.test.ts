import { describe, it, expect } from "vitest";
import {
  normalizeBrandingTokens,
  activationToCapabilities,
  buildInstanceDescriptor,
  buildAppConfigManifest,
  resolveAppPersona,
  resolveAppNavigation,
} from "./manifest";

describe("normalizeBrandingTokens", () => {
  it("returns undefined for non-objects / empty", () => {
    expect(normalizeBrandingTokens(null)).toBeUndefined();
    expect(normalizeBrandingTokens("x")).toBeUndefined();
    expect(normalizeBrandingTokens({})).toBeUndefined();
  });

  it("extracts a dual light/dark palette + typography", () => {
    const result = normalizeBrandingTokens({
      light: { palette: { accent: "#1e6f50", bg: "#fff" }, typography: { fontFamily: "Inter" } },
      dark: { palette: { accent: "#0a3" } },
    });
    expect(result).toEqual({
      light: { palette: { accent: "#1e6f50", bg: "#fff" }, typography: { fontFamily: "Inter" } },
      dark: { palette: { accent: "#0a3" } },
    });
  });

  it("extracts a flat (single-scheme) palette", () => {
    expect(normalizeBrandingTokens({ palette: { accent: "#abc" } })).toEqual({
      palette: { accent: "#abc" },
    });
  });

  it("drops unknown keys and blank values", () => {
    const result = normalizeBrandingTokens({
      palette: { accent: "  ", text: "#111", bogus: "#999" },
    });
    expect(result).toEqual({ palette: { text: "#111" } });
  });
});

describe("activationToCapabilities", () => {
  it("always includes the baseline", () => {
    expect(activationToCapabilities(null)).toContain("notifications");
  });

  it("includes the profile modules", () => {
    const caps = activationToCapabilities({
      modules: ["service-operations", "billing-readiness"],
    });
    expect(caps).toEqual(
      expect.arrayContaining(["notifications", "service-operations", "billing-readiness"]),
    );
  });

  it("adds field-dispatch capabilities for the onsite-services axis triple", () => {
    const caps = activationToCapabilities({
      modules: ["service-operations"],
      axes: { form: "services", delivery: "physical", consumptionChannel: "onsite-plus-portal" },
    });
    expect(caps).toEqual(
      expect.arrayContaining(["field-dispatch", "work-items", "offline-sync"]),
    );
  });

  it("does not add field-dispatch for a non-matching axis set", () => {
    const caps = activationToCapabilities({
      modules: [],
      axes: { form: "goods", delivery: "digital", consumptionChannel: "storefront" },
    });
    expect(caps).not.toContain("field-dispatch");
  });
});

describe("buildInstanceDescriptor", () => {
  it("defaults apiVersion + authModes and omits empty branding", () => {
    const d = buildInstanceDescriptor({ instanceId: "inst_1", orgName: "Acme" });
    expect(d.apiVersion).toBe("v1");
    expect(d.authModes).toEqual(["password"]);
    expect(d.branding).toBeUndefined();
    expect(d.archetype).toBeUndefined();
  });

  it("includes archetype + branding when present", () => {
    const d = buildInstanceDescriptor({
      instanceId: "inst_1",
      orgName: "Acme HVAC",
      archetype: "trades-maintenance/hvac-contractor",
      accent: "#1e6f50",
      logoUrl: "https://x/logo.png",
    });
    expect(d.archetype).toBe("trades-maintenance/hvac-contractor");
    expect(d.branding).toEqual({ accent: "#1e6f50", logoUrl: "https://x/logo.png" });
  });
});

describe("buildAppConfigManifest", () => {
  it("assembles a v1 manifest with tokens + capabilities", () => {
    const m = buildAppConfigManifest({
      orgName: "Acme HVAC",
      archetype: "trades-maintenance/hvac-contractor",
      persona: { kind: "employee", mode: "field" },
      brandingTokensRaw: { light: { palette: { accent: "#1e6f50" } } },
      capabilities: ["work-items", "notifications"],
    });
    expect(m.schemaVersion).toBe("1");
    expect(m.org).toEqual({ name: "Acme HVAC", archetype: "trades-maintenance/hvac-contractor" });
    expect(m.persona).toEqual({ kind: "employee", mode: "field" });
    expect(m.designTokens).toEqual({ light: { palette: { accent: "#1e6f50" } } });
    expect(m.capabilities).toEqual(["work-items", "notifications"]);
  });

  it("omits designTokens when branding is absent/invalid", () => {
    const m = buildAppConfigManifest({
      orgName: "Acme",
      persona: { kind: "operator" },
      brandingTokensRaw: null,
      capabilities: ["notifications"],
    });
    expect(m.designTokens).toBeUndefined();
    expect(m.org.archetype).toBeUndefined();
  });

  it("emits the navigation block when provided", () => {
    const m = buildAppConfigManifest({
      orgName: "Acme HVAC",
      persona: { kind: "employee", mode: "field" },
      capabilities: ["field-dispatch", "work-items"],
      navigation: { tabs: [], defaultTab: "jobs" },
    });
    expect(m.navigation).toEqual({ tabs: [], defaultTab: "jobs" });
  });

  it("omits navigation when not provided", () => {
    const m = buildAppConfigManifest({
      orgName: "Acme",
      persona: { kind: "operator" },
      capabilities: ["notifications"],
    });
    expect(m.navigation).toBeUndefined();
  });
});

describe("resolveAppPersona", () => {
  it("returns customer for a customer principal", () => {
    expect(
      resolveAppPersona({ userType: "customer", employeeId: null, capabilities: [] }),
    ).toEqual({ kind: "customer" });
  });

  it("returns employee:field when the workforce user has an employee profile and the install has field-dispatch", () => {
    expect(
      resolveAppPersona({
        userType: "admin",
        employeeId: "emp_1",
        capabilities: ["field-dispatch", "work-items"],
      }),
    ).toEqual({ kind: "employee", mode: "field" });
  });

  it("returns plain employee for a workforce user with an employee profile but no field-dispatch", () => {
    expect(
      resolveAppPersona({
        userType: "admin",
        employeeId: "emp_1",
        capabilities: ["notifications"],
      }),
    ).toEqual({ kind: "employee" });
  });

  it("returns operator for a workforce user with no employee profile (platform operator)", () => {
    expect(
      resolveAppPersona({
        userType: "admin",
        employeeId: null,
        capabilities: ["notifications"],
      }),
    ).toEqual({ kind: "operator" });
  });
});

describe("resolveAppNavigation", () => {
  it("lands a field employee on Jobs", () => {
    expect(
      resolveAppNavigation({
        persona: { kind: "employee", mode: "field" },
        capabilities: ["field-dispatch", "work-items"],
      }),
    ).toEqual({ tabs: [], defaultTab: "jobs" });
  });

  it("falls back to Home for operator / admin / non-field employee", () => {
    for (const persona of [
      { kind: "operator" as const },
      { kind: "admin" as const },
      { kind: "employee" as const },
    ]) {
      expect(
        resolveAppNavigation({ persona, capabilities: ["notifications"] }),
      ).toEqual({ tabs: [], defaultTab: "index" });
    }
  });

  it("lands a customer on Home (customer surface lights up post-P5)", () => {
    expect(
      resolveAppNavigation({ persona: { kind: "customer" }, capabilities: [] }),
    ).toEqual({ tabs: [], defaultTab: "index" });
  });
});
