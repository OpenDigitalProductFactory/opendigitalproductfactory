// BI-7626A660 / BI-C7151B1B — the estate identity contract.
//
// The badge tests carry the load-bearing invariant: production renders NOTHING.
// Everything else about this feature is presentation; that one is a safety
// property, because a badge that could be wrong about production is worse than
// no badge at all.

import { describe, expect, it } from "vitest";

import {
  ESTATE_IDENTITY_CONFIG_KEY,
  ESTATE_NAME_ENV_VAR,
  ESTATE_NAME_MAX_LENGTH,
  ESTATE_NAME_SOURCES,
  formatInstallationBadge,
  formatInstallationTitle,
  formatMcpServerName,
  isEstateNameSource,
  isValidEstateName,
  normalizeEstateName,
  parsePortalEstateIdentityDeclaration,
  resolveEstateNamePrecedence,
  slugifyEstateName,
  type PortalEstateIdentityDeclarationV1,
} from "./estate-identity-contract";

const declaration = (
  overrides: Partial<PortalEstateIdentityDeclarationV1> = {},
): PortalEstateIdentityDeclarationV1 => ({
  schemaVersion: 1,
  estateName: "Northwind",
  source: "operator",
  declaredAt: "2026-08-25T00:00:00.000Z",
  declaredByPrincipalId: "PRN-1",
  ...overrides,
});

describe("estate name grammar", () => {
  it("accepts ordinary operator-typed names", () => {
    for (const name of ["Northwind", "Northwind Group", "acme-2", "A", "a.b_c-d"]) {
      expect(isValidEstateName(name)).toBe(true);
    }
  });

  it("refuses names that would not survive a slug or a TXT record", () => {
    for (const name of ["", " ", "-leading", ".leading", "has/slash", "has:colon", "emoji😀"]) {
      expect(isValidEstateName(name)).toBe(false);
    }
  });

  it("refuses a name one character over the limit and accepts one at it", () => {
    const atLimit = "N".repeat(ESTATE_NAME_MAX_LENGTH);
    expect(isValidEstateName(atLimit)).toBe(true);
    expect(isValidEstateName(`${atLimit}N`)).toBe(false);
  });

  it("collapses whitespace rather than rejecting a double-spaced name", () => {
    expect(normalizeEstateName("  Northwind   Group  ")).toBe("Northwind Group");
  });

  it("converges an empty field and a malformed one on the same no-name state", () => {
    expect(normalizeEstateName("")).toBeNull();
    expect(normalizeEstateName("   ")).toBeNull();
    expect(normalizeEstateName("/nope")).toBeNull();
    expect(normalizeEstateName(undefined)).toBeNull();
    expect(normalizeEstateName(42)).toBeNull();
  });

  it("slugifies to a machine-safe label", () => {
    expect(slugifyEstateName("Northwind Group")).toBe("northwind-group");
    expect(slugifyEstateName("A.B_C")).toBe("a-b-c");
  });
});

describe("estate name source vocabulary", () => {
  it("is closed", () => {
    for (const source of ESTATE_NAME_SOURCES) expect(isEstateNameSource(source)).toBe(true);
    expect(isEstateNameSource("guessed")).toBe(false);
    expect(isEstateNameSource(undefined)).toBe(false);
  });

  it("keeps discovered-peer in the vocabulary, because pre-fill is a real origin", () => {
    expect(isEstateNameSource("discovered-peer")).toBe(true);
  });
});

describe("parsing a stored declaration", () => {
  it("round-trips a well-formed row", () => {
    expect(parsePortalEstateIdentityDeclaration(declaration())).toEqual(declaration());
  });

  it("degrades a corrupt row to no declaration instead of throwing", () => {
    for (const raw of [
      null,
      undefined,
      [],
      "string",
      { ...declaration(), schemaVersion: 2 },
      { ...declaration(), estateName: "" },
      { ...declaration(), estateName: "has/slash" },
      { ...declaration(), source: "invented" },
      { ...declaration(), declaredAt: "not-a-date" },
      { ...declaration(), declaredByPrincipalId: "  " },
    ]) {
      expect(parsePortalEstateIdentityDeclaration(raw)).toBeNull();
    }
  });

  it("normalizes the stored name on the way in", () => {
    const parsed = parsePortalEstateIdentityDeclaration(
      declaration({ estateName: "  Northwind   Group " }),
    );
    expect(parsed?.estateName).toBe("Northwind Group");
  });
});

describe("precedence", () => {
  it("prefers the process override over everything", () => {
    const resolved = resolveEstateNamePrecedence({
      processOverride: "FromEnv",
      installerState: "FromInstaller",
      portalDeclaration: declaration(),
    });
    expect(resolved.estateName).toBe("FromEnv");
    expect(resolved.tier).toBe("process-override");
  });

  it("prefers installer state over a portal declaration", () => {
    const resolved = resolveEstateNamePrecedence({
      installerState: "FromInstaller",
      portalDeclaration: declaration(),
    });
    expect(resolved.estateName).toBe("FromInstaller");
    expect(resolved.tier).toBe("installer-state");
  });

  it("uses the portal declaration when no higher tier spoke", () => {
    const resolved = resolveEstateNamePrecedence({ portalDeclaration: declaration() });
    expect(resolved.estateName).toBe("Northwind");
    expect(resolved.tier).toBe("portal-declaration");
  });

  it("reports unset rather than inventing a default name", () => {
    const resolved = resolveEstateNamePrecedence({});
    expect(resolved.estateName).toBeNull();
    expect(resolved.tier).toBe("unset");
  });

  it("reports a shadowed declaration so an operator learns why theirs is not in force", () => {
    const resolved = resolveEstateNamePrecedence({
      installerState: "FromInstaller",
      portalDeclaration: declaration({ estateName: "Northwind" }),
    });
    expect(resolved.shadowedPortalDeclaration).toEqual({
      declaredName: "Northwind",
      winningTier: "installer-state",
      winningName: "FromInstaller",
    });
  });

  it("treats an echo of the winning value as agreement, not drift", () => {
    const resolved = resolveEstateNamePrecedence({
      installerState: "Northwind",
      portalDeclaration: declaration({ estateName: "Northwind" }),
    });
    expect(resolved.shadowedPortalDeclaration).toBeUndefined();
  });

  it("ignores a malformed higher tier and falls through to the next", () => {
    const resolved = resolveEstateNamePrecedence({
      processOverride: "has/slash",
      portalDeclaration: declaration(),
    });
    expect(resolved.tier).toBe("portal-declaration");
    expect(resolved.estateName).toBe("Northwind");
  });
});

describe("badge", () => {
  it("renders NOTHING on production, whatever the estate is named", () => {
    expect(
      formatInstallationBadge({ estateName: "Northwind", environmentClass: "production" }),
    ).toBeNull();
    expect(
      formatInstallationBadge({ estateName: null, environmentClass: "production" }),
    ).toBeNull();
  });

  it("names the estate and the role on a non-production install", () => {
    expect(
      formatInstallationBadge({ estateName: "Northwind", environmentClass: "development" }),
    ).toBe("NORTHWIND DEV");
    expect(formatInstallationBadge({ estateName: "Northwind", environmentClass: "test" })).toBe(
      "NORTHWIND TEST",
    );
  });

  it("falls back to the role alone when nobody has named the installation", () => {
    expect(formatInstallationBadge({ estateName: null, environmentClass: "development" })).toBe(
      "DEV",
    );
  });

  it("never emits a bare estate name with no role", () => {
    for (const environmentClass of ["development", "test"] as const) {
      const badge = formatInstallationBadge({ estateName: "Northwind", environmentClass });
      expect(badge).toMatch(/ (DEV|TEST)$/);
    }
  });
});

describe("MCP server identity", () => {
  it("gives two installs of one estate different server names", () => {
    const dev = formatMcpServerName({ estateName: "Northwind", environmentClass: "development" });
    const prod = formatMcpServerName({ estateName: "Northwind", environmentClass: "production" });
    expect(dev).toBe("dpf-northwind-dev");
    expect(prod).toBe("dpf-northwind-prod");
    expect(dev).not.toBe(prod);
  });

  it("still distinguishes by role when the estate is unnamed", () => {
    expect(formatMcpServerName({ estateName: null, environmentClass: "development" })).toBe(
      "dpf-dev",
    );
    expect(formatMcpServerName({ estateName: null, environmentClass: "production" })).toBe(
      "dpf-prod",
    );
  });

  it("degrades to the role when a name slugifies to nothing", () => {
    expect(formatMcpServerName({ estateName: "...", environmentClass: "development" })).toBe(
      "dpf-dev",
    );
  });

  it("titles the installation for a human reader", () => {
    expect(
      formatInstallationTitle({ estateName: "Northwind", environmentClass: "development" }),
    ).toBe("Northwind DEV");
    expect(formatInstallationTitle({ estateName: null, environmentClass: "test" })).toBe(
      "Unnamed DPF TEST",
    );
  });
});

describe("contract constants", () => {
  it("keys the record under a versioned PlatformConfig key", () => {
    expect(ESTATE_IDENTITY_CONFIG_KEY).toBe("installation.estate-identity.v1");
  });

  it("names the process override consistently with the environment-class one", () => {
    expect(ESTATE_NAME_ENV_VAR).toBe("DPF_ESTATE_NAME");
  });
});
