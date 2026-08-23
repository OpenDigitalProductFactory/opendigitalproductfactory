import { describe, expect, it } from "vitest";

import {
  ENVIRONMENT_CLASS_CONFIG_KEY,
  ENVIRONMENT_CLASS_TIERS,
  loadEnvironmentClassResolution,
  parsePortalEnvironmentClassDeclaration,
  resolveEnvironmentClassPrecedence,
} from "./environment-class";

const PORTAL_DEV = {
  schemaVersion: 1 as const,
  environmentClass: "development" as const,
  declaredAt: "2026-08-22T12:00:00.000Z",
  declaredByPrincipalId: "PRN-1",
};

describe("ENVIRONMENT_CLASS_TIERS", () => {
  it("states the design's precedence order once, highest first", () => {
    expect(ENVIRONMENT_CLASS_TIERS).toEqual([
      "process-override",
      "installer-state",
      "portal-declaration",
      "default",
    ]);
  });
});

describe("parsePortalEnvironmentClassDeclaration", () => {
  it("accepts a well-formed declaration", () => {
    expect(parsePortalEnvironmentClassDeclaration(PORTAL_DEV)).toEqual(PORTAL_DEV);
  });

  it("rejects an unknown schema version", () => {
    expect(parsePortalEnvironmentClassDeclaration({ ...PORTAL_DEV, schemaVersion: 2 })).toBeNull();
  });

  it("rejects a class outside the closed vocabulary", () => {
    expect(
      parsePortalEnvironmentClassDeclaration({ ...PORTAL_DEV, environmentClass: "staging" }),
    ).toBeNull();
  });

  it("rejects a declaration with no principal", () => {
    expect(
      parsePortalEnvironmentClassDeclaration({ ...PORTAL_DEV, declaredByPrincipalId: "  " }),
    ).toBeNull();
  });

  it("rejects a non-object", () => {
    expect(parsePortalEnvironmentClassDeclaration("development")).toBeNull();
    expect(parsePortalEnvironmentClassDeclaration(null)).toBeNull();
    expect(parsePortalEnvironmentClassDeclaration([PORTAL_DEV])).toBeNull();
  });
});

describe("resolveEnvironmentClassPrecedence", () => {
  it("puts a process override above every other tier", () => {
    const result = resolveEnvironmentClassPrecedence({
      processOverride: "test",
      installerState: "production",
      portalDeclaration: PORTAL_DEV,
    });
    expect(result.environmentClass).toBe("test");
    expect(result.tier).toBe("process-override");
  });

  it("ignores an override outside the closed vocabulary", () => {
    const result = resolveEnvironmentClassPrecedence({
      processOverride: "staging",
      installerState: "production",
    });
    expect(result.environmentClass).toBe("production");
    expect(result.tier).toBe("installer-state");
  });

  it("puts installer state above the portal declaration", () => {
    const result = resolveEnvironmentClassPrecedence({
      installerState: "production",
      portalDeclaration: PORTAL_DEV,
    });
    expect(result.environmentClass).toBe("production");
    expect(result.tier).toBe("installer-state");
    expect(result.shadowedPortalDeclaration).toEqual({
      declaredClass: "development",
      winningTier: "installer-state",
      winningClass: "production",
    });
  });

  it("does not report drift when the portal declaration agrees with the winner", () => {
    const result = resolveEnvironmentClassPrecedence({
      installerState: "development",
      portalDeclaration: PORTAL_DEV,
    });
    expect(result.tier).toBe("installer-state");
    expect(result.shadowedPortalDeclaration).toBeUndefined();
    expect(result.portalDeclaration).toEqual(PORTAL_DEV);
  });

  it("uses the portal declaration when no higher tier spoke", () => {
    const result = resolveEnvironmentClassPrecedence({ portalDeclaration: PORTAL_DEV });
    expect(result.environmentClass).toBe("development");
    expect(result.tier).toBe("portal-declaration");
    expect(result.declared).toBe(true);
    expect(result.shadowedPortalDeclaration).toBeUndefined();
  });

  it("falls back to production and reports nothing was declared", () => {
    const result = resolveEnvironmentClassPrecedence({});
    expect(result.environmentClass).toBe("production");
    expect(result.tier).toBe("default");
    expect(result.declared).toBe(false);
  });
});

describe("loadEnvironmentClassResolution", () => {
  const installState = (environmentClass?: string) => async () =>
    JSON.stringify(environmentClass ? { environmentClass } : { installMode: "consumer" });

  it("reads installer state and the portal declaration together", async () => {
    const result = await loadEnvironmentClassResolution(
      {
        readConfig: async (key) => (key === ENVIRONMENT_CLASS_CONFIG_KEY ? PORTAL_DEV : null),
      },
      { readText: installState("production"), env: {} },
    );
    expect(result.tier).toBe("installer-state");
    expect(result.installerStateValue).toBe("production");
    expect(result.shadowedPortalDeclaration?.declaredClass).toBe("development");
  });

  it("lets the portal declaration stand when the installer said nothing", async () => {
    const result = await loadEnvironmentClassResolution(
      { readConfig: async () => PORTAL_DEV },
      { readText: installState(), env: {} },
    );
    expect(result.environmentClass).toBe("development");
    expect(result.tier).toBe("portal-declaration");
  });

  it("honours the process override", async () => {
    const result = await loadEnvironmentClassResolution(
      { readConfig: async () => PORTAL_DEV },
      { readText: installState("development"), env: { DPF_ENVIRONMENT_CLASS: "test" } },
    );
    expect(result.environmentClass).toBe("test");
    expect(result.tier).toBe("process-override");
  });

  it("degrades one failed read without losing the others", async () => {
    const result = await loadEnvironmentClassResolution(
      {
        readConfig: async () => {
          throw new Error("db down");
        },
      },
      { readText: installState("test"), env: {} },
    );
    expect(result.environmentClass).toBe("test");
    expect(result.tier).toBe("installer-state");
    expect(result.portalDeclaration).toBeUndefined();
  });

  it("falls back to production when nothing can be read at all", async () => {
    const result = await loadEnvironmentClassResolution(
      {
        readConfig: async () => {
          throw new Error("db down");
        },
      },
      {
        readText: async () => {
          throw new Error("ENOENT");
        },
        env: {},
      },
    );
    expect(result.environmentClass).toBe("production");
    expect(result.tier).toBe("default");
    expect(result.declared).toBe(false);
  });
});
