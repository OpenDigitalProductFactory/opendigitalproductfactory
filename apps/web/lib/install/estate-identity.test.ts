// BI-7626A660 / BI-C7151B1B — the server-side estate identity resolver.
//
// The load-bearing case is the LAST one: identity must resolve on an install
// that has never federated and therefore has no device id. That is the state of
// a fresh install, and it is exactly when an agent most needs to know which box
// it is talking to.

import { describe, expect, it, vi } from "vitest";

import {
  ESTATE_IDENTITY_CONFIG_KEY,
  loadEstateNameResolution,
  readInstallEstateName,
  resolveInstallationIdentity,
} from "./estate-identity";

const storeOf = (value: unknown) => ({ readConfig: async () => value });
const failingStore = {
  readConfig: async () => {
    throw new Error("PlatformConfig unreachable");
  },
};

const declaration = (estateName = "Northwind") => ({
  schemaVersion: 1,
  estateName,
  source: "operator",
  declaredAt: "2026-08-25T00:00:00.000Z",
  declaredByPrincipalId: "PRN-1",
});

const installState = (body: Record<string, unknown>) => async () => JSON.stringify(body);

describe("readInstallEstateName", () => {
  it("reads a name the installer recorded", async () => {
    await expect(
      readInstallEstateName({ readText: installState({ estateName: "Northwind" }) }),
    ).resolves.toBe("Northwind");
  });

  it("returns null rather than inventing a name when installer state is silent", async () => {
    await expect(
      readInstallEstateName({ readText: installState({ environmentClass: "development" }) }),
    ).resolves.toBeNull();
  });

  it("returns null when install state is missing or unparseable", async () => {
    await expect(
      readInstallEstateName({
        readText: async () => {
          throw new Error("ENOENT");
        },
      }),
    ).resolves.toBeNull();
    await expect(readInstallEstateName({ readText: async () => "not json" })).resolves.toBeNull();
  });

  it("normalizes a sloppily recorded name", async () => {
    await expect(
      readInstallEstateName({ readText: installState({ estateName: "  Northwind  Group " }) }),
    ).resolves.toBe("Northwind Group");
  });
});

describe("loadEstateNameResolution", () => {
  // BI-CA54ACC8: a store that can read the Organization row supplies the
  // lowest tier; a failing read drops only that tier.
  it("falls back to the organization named at setup, and drops that tier alone when its read fails", async () => {
    const resolved = await loadEstateNameResolution(
      { readConfig: async () => null, readOrganizationName: async () => "Fabrikam" },
      { env: {}, readText: async () => "{}" },
    );
    expect(resolved).toMatchObject({ estateName: "Fabrikam", tier: "organization-name", organizationNameValue: "Fabrikam" });

    const failing = await loadEstateNameResolution(
      { readConfig: async () => declaration(), readOrganizationName: async () => { throw new Error("db down"); } },
      { env: {}, readText: async () => "{}" },
    );
    expect(failing).toMatchObject({ estateName: "Northwind", tier: "portal-declaration" });
    expect(failing.organizationNameValue).toBeUndefined();
  });

  it("resolves the portal declaration when it is the only tier", async () => {
    const resolved = await loadEstateNameResolution(storeOf(declaration()), {
      env: {},
      readText: async () => "{}",
    });
    expect(resolved.estateName).toBe("Northwind");
    expect(resolved.tier).toBe("portal-declaration");
  });

  it("lets installer state beat the portal", async () => {
    const resolved = await loadEstateNameResolution(storeOf(declaration()), {
      env: {},
      readText: installState({ estateName: "FromInstaller" }),
    });
    expect(resolved.estateName).toBe("FromInstaller");
    expect(resolved.tier).toBe("installer-state");
  });

  it("lets the process override beat everything", async () => {
    const resolved = await loadEstateNameResolution(storeOf(declaration()), {
      env: { DPF_ESTATE_NAME: "FromEnv" },
      readText: installState({ estateName: "FromInstaller" }),
    });
    expect(resolved.estateName).toBe("FromEnv");
    expect(resolved.tier).toBe("process-override");
  });

  it("drops only the failed tier when PlatformConfig is unreachable", async () => {
    const resolved = await loadEstateNameResolution(failingStore, {
      env: {},
      readText: installState({ estateName: "FromInstaller" }),
    });
    expect(resolved.estateName).toBe("FromInstaller");
  });

  it("reports unset when every tier is silent", async () => {
    const resolved = await loadEstateNameResolution(storeOf(null), {
      env: {},
      readText: async () => "{}",
    });
    expect(resolved.estateName).toBeNull();
    expect(resolved.tier).toBe("unset");
  });

  it("reads the versioned config key", async () => {
    const readConfig = vi.fn(async () => null);
    await loadEstateNameResolution({ readConfig }, { env: {}, readText: async () => "{}" });
    expect(readConfig).toHaveBeenCalledWith(ESTATE_IDENTITY_CONFIG_KEY);
  });
});

describe("resolveInstallationIdentity", () => {
  it("marks production, and only production", async () => {
    const prod = await resolveInstallationIdentity({
      store: storeOf(declaration()),
      environmentClass: "production",
      env: {},
      readText: async () => "{}",
    });
    expect(prod.isProduction).toBe(true);

    for (const environmentClass of ["development", "test"] as const) {
      const other = await resolveInstallationIdentity({
        store: storeOf(declaration()),
        environmentClass,
        env: {},
        readText: async () => "{}",
      });
      expect(other.isProduction).toBe(false);
    }
  });

  it("carries the short device id when one exists", async () => {
    const identity = await resolveInstallationIdentity({
      store: storeOf(declaration()),
      environmentClass: "development",
      readDeviceId: async () => "did_ab12…9f0c",
      env: {},
      readText: async () => "{}",
    });
    expect(identity.shortDeviceId).toBe("did_ab12…9f0c");
  });

  it("resolves identity on an install that has NEVER federated and has no device id", async () => {
    const identity = await resolveInstallationIdentity({
      store: storeOf(declaration()),
      environmentClass: "development",
      readDeviceId: async () => null,
      env: {},
      readText: async () => "{}",
    });
    expect(identity.estateName).toBe("Northwind");
    expect(identity.environmentClass).toBe("development");
    expect(identity.shortDeviceId).toBeNull();
  });

  it("never lets a failing device-id read break identity resolution", async () => {
    const identity = await resolveInstallationIdentity({
      store: storeOf(declaration()),
      environmentClass: "development",
      readDeviceId: async () => {
        throw new Error("credential decrypt failed");
      },
      env: {},
      readText: async () => "{}",
    });
    expect(identity.estateName).toBe("Northwind");
    expect(identity.shortDeviceId).toBeNull();
  });

  it("still resolves a usable identity when the estate is unnamed", async () => {
    const identity = await resolveInstallationIdentity({
      store: storeOf(null),
      environmentClass: "development",
      env: {},
      readText: async () => "{}",
    });
    expect(identity.estateName).toBeNull();
    expect(identity.isProduction).toBe(false);
  });
});
