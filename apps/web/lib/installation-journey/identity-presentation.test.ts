import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  INSTALLATION_ENVIRONMENT_CLASSES,
  INSTALLATION_OPERATING_PURPOSES,
} from "@dpf/db/installation-operating-intent";

import {
  CONFIRMATION_PRESENTATION,
  ENVIRONMENT_OPTIONS,
  PURPOSE_OPTIONS,
  normalizeIdentityDeclaration,
} from "./identity-presentation";

describe("option lists", () => {
  // The panel is a client component, so this module cannot read the closed
  // vocabularies at runtime — `@dpf/db/installation-operating-intent` imports
  // `crypto`. These two assertions are what stops that decoupling from silently
  // becoming a missing option the operator can never pick.
  it("offers every operating purpose, in vocabulary order", () => {
    expect(PURPOSE_OPTIONS.map((option) => option.value)).toEqual([
      ...INSTALLATION_OPERATING_PURPOSES,
    ]);
  });

  it("offers every environment class, in vocabulary order", () => {
    expect(ENVIRONMENT_OPTIONS.map((option) => option.value)).toEqual([
      ...INSTALLATION_ENVIRONMENT_CLASSES,
    ]);
  });

  it("gives every option words an operator can read", () => {
    for (const option of [...PURPOSE_OPTIONS, ...ENVIRONMENT_OPTIONS]) {
      expect(option.label.trim().length).toBeGreaterThan(0);
      expect(option.label).not.toBe(option.value);
    }
  });

  it("presents every confirmation status", () => {
    expect(Object.keys(CONFIRMATION_PRESENTATION).sort()).toEqual([
      "confirmed",
      "needs-review",
      "suggested",
    ]);
  });
});

describe("client-safety of the presentation contract", () => {
  // The regression this file exists for: importing a label out of
  // `identity-change-impact` (node:crypto) or `installation-identity-view`
  // (node:fs/promises) pulled the filesystem into the client chunk and failed
  // the production build with "the chunking context does not support external
  // modules (request: node:fs/promises)". Typecheck and vitest both passed.
  const source = readFileSync(new URL("./identity-presentation.ts", import.meta.url), "utf8");

  it("imports no Node built-in", () => {
    expect(source).not.toMatch(/from\s+["'](?:node:)?(?:fs|crypto|path|os|child_process)/);
  });

  it("imports its server siblings for types only, never for a value", () => {
    const valueImports = [
      ...source.matchAll(/^import\s+(?!type\b)([\s\S]*?)from\s+["']([^"']+)["']/gm),
    ];
    const serverish = valueImports.filter(([, , specifier]) =>
      /identity-change-impact|installation-identity-view|instance-stance|environment-class$|host-profile/.test(
        specifier,
      ),
    );
    expect(serverish.map(([, , specifier]) => specifier)).toEqual([]);
  });

  it("takes only erased type imports from the operating-intent contract", () => {
    // That module imports `crypto` for its fingerprint helper.
    const match = source.match(
      /^import\s+([\s\S]*?)from\s+["']@dpf\/db\/installation-operating-intent["']/m,
    );
    expect(match, "expected an import from the operating-intent contract").toBeTruthy();
    expect(match?.[1]).toMatch(/^type\s/);
  });
});

describe("normalizeIdentityDeclaration", () => {
  const base = {
    primaryPurpose: "evolve-dpf" as const,
    environmentClass: "development" as const,
    pairedProductionInstallationRef: null,
  };

  it("turns a blank pairing into null", () => {
    expect(
      normalizeIdentityDeclaration({ ...base, pairedProductionInstallationRef: "   " })
        .pairedProductionInstallationRef,
    ).toBeNull();
  });

  it("trims a supplied pairing", () => {
    expect(
      normalizeIdentityDeclaration({ ...base, pairedProductionInstallationRef: " peer " })
        .pairedProductionInstallationRef,
    ).toBe("peer");
  });
});
