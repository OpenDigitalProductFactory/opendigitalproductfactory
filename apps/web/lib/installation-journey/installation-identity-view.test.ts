import { describe, expect, it } from "vitest";

import {
  ENVIRONMENT_CLASS_CONFIG_KEY,
  type EnvironmentClassResolution,
} from "@/lib/install/environment-class-contract";
import { OPERATING_INTENT_CONFIG_KEY } from "@/lib/install/instance-stance";
import type { InstallationIntentDb } from "@/lib/installation-journey/operating-intent";

import { buildIdentityHeadline, loadInstallationIdentityView } from "./installation-identity-view";

const CONFIRMED_DEV_INTENT = {
  schemaVersion: 1,
  primaryPurpose: "evolve-dpf",
  secondaryPurposes: [],
  relationshipIntents: [],
  pairedProductionInstallationRef: "dpf-prod-acme",
  evidence: [],
  confidence: "high",
  confirmation: {
    status: "confirmed",
    confirmedAt: "2026-08-22T03:37:19.586Z",
    confirmedByPrincipalId: "PRN-1",
  },
};

function configStore(
  rows: Record<string, unknown>,
  links: ReadonlyArray<Record<string, unknown>> = [],
) {
  const store = {
    readConfig: async (key: string) => rows[key] ?? null,
    countBacklogItemsByStatus: async () => 0,
    listFederationLinks: async () => links as never,
  };
  const db: InstallationIntentDb = {
    platformConfig: {
      findUnique: async ({ where }) =>
        where.key in rows ? { value: rows[where.key] } : null,
      upsert: async () => ({}),
    },
  };
  return { store, db };
}

const CONSUMER_HOST = async () => ({
  kind: "consumer" as const,
  installMode: "consumer",
  sourceCapable: false,
  releaseImage: true,
  reason: "consumer-release-install" as const,
});

const stateText = (environmentClass?: string) => async () =>
  JSON.stringify(environmentClass ? { environmentClass } : { installMode: "consumer" });

describe("buildIdentityHeadline", () => {
  const resolution = (
    over: Partial<EnvironmentClassResolution> = {},
  ): EnvironmentClassResolution => ({
    environmentClass: "development",
    tier: "installer-state",
    declared: true,
    ...over,
  });

  it("states the identity when both halves are declared", () => {
    expect(
      buildIdentityHeadline({
        environment: resolution(),
        purpose: "evolve-dpf",
        intentStatus: "valid",
      }),
    ).toBe("This installation is set up for development work. Its job is to safely improve another dpf.");
  });

  it("says plainly that nothing was declared, rather than showing a blank", () => {
    expect(
      buildIdentityHeadline({
        environment: resolution({
          environmentClass: "production",
          tier: "default",
          declared: false,
        }),
        purpose: "operate-organization",
        intentStatus: "missing",
      }),
    ).toBe("Nobody has said what this installation is, so we treat it as production.");
  });

  it("separates a declared environment from an unreadable job", () => {
    expect(
      buildIdentityHeadline({
        environment: resolution({ environmentClass: "test" }),
        purpose: "evolve-dpf",
        intentStatus: "invalid",
      }),
    ).toBe("This installation is set up for test work. Nobody has said what its job is.");
  });
});

describe("loadInstallationIdentityView", () => {
  it("composes the identity in force with its stance rationales", async () => {
    const { store, db } = configStore({
      [OPERATING_INTENT_CONFIG_KEY]: CONFIRMED_DEV_INTENT,
    });

    const view = await loadInstallationIdentityView(db, store, {
      readText: stateText("development"),
      env: {},
    });

    expect(view.headline).toBe("This installation is set up for development work. Its job is to safely improve another dpf.");
    expect(view.detail).toBe("Paired with dpf-prod-acme. The installer set the environment.");
    expect(view.confirmationStatus).toBe("confirmed");
    expect(view.declaration).toEqual({
      primaryPurpose: "evolve-dpf",
      environmentClass: "development",
      pairedProductionInstallationRef: "dpf-prod-acme",
    });
    expect(view.stances.map((row) => row.stance)).toEqual([
      "credentials",
      "teardown",
      "sourceAuthority",
      "peerWrite",
      "workSync",
    ]);
    const peer = view.stances.find((row) => row.stance === "peerWrite");
    expect(peer).toMatchObject({ valueLabel: "Read only", intent: "warning" });
    expect(peer?.rationale).toContain("never mutate a record it owns");
    // A declared peer with no established link cannot carry work, so the row
    // reports that rather than claiming the backlog is mirrored.
    const workSync = view.stances.find((row) => row.stance === "workSync");
    expect(workSync).toMatchObject({ valueLabel: "Nowhere to mirror", intent: "warning" });
    expect(workSync?.rationale).toContain("no established federation link");
  });

  it("reports the resolved class, not the class a portal declaration asked for", async () => {
    const { store, db } = configStore({
      [OPERATING_INTENT_CONFIG_KEY]: CONFIRMED_DEV_INTENT,
      [ENVIRONMENT_CLASS_CONFIG_KEY]: {
        schemaVersion: 1,
        environmentClass: "development",
        declaredAt: "2026-08-22T12:00:00.000Z",
        declaredByPrincipalId: "PRN-1",
      },
    });

    const view = await loadInstallationIdentityView(db, store, {
      readText: stateText("production"),
      env: {},
    });

    expect(view.declaration.environmentClass).toBe("production");
    expect(view.environment.shadowedPortalDeclaration).toMatchObject({
      declaredClass: "development",
      winningTier: "installer-state",
    });
    expect(view.detail).toContain("The installer set production, and that wins.");
    // Production overrides the paired-development read-only brake.
    expect(view.stances.find((row) => row.stance === "teardown")).toMatchObject({
      valueLabel: "Never",
      intent: "danger",
    });
  });

  it("treats a missing record as needing review and keeps every brake on", async () => {
    const { store, db } = configStore({});

    const view = await loadInstallationIdentityView(db, store, {
      readText: stateText(),
      env: {},
    });

    expect(view.intentStatus).toBe("missing");
    expect(view.confirmationStatus).toBe("needs-review");
    expect(view.environment.declared).toBe(false);
    expect(view.headline).toContain("Nobody has said what this installation is");
    expect(view.detail).toBeNull();
    expect(view.stances.find((row) => row.stance === "credentials")?.valueLabel).toBe(
      "Operator only",
    );
  });

  it("marks a corrupt record invalid instead of silently defaulting", async () => {
    const { store, db } = configStore({
      [OPERATING_INTENT_CONFIG_KEY]: { schemaVersion: 1, primaryPurpose: "not-a-purpose" },
    });

    const view = await loadInstallationIdentityView(db, store, {
      readText: stateText("test"),
      env: {},
    });

    expect(view.intentStatus).toBe("invalid");
    expect(view.confirmationStatus).toBe("needs-review");
  });

  it("shows the source brake a consumer install carries", async () => {
    const { store, db } = configStore({
      [OPERATING_INTENT_CONFIG_KEY]: CONFIRMED_DEV_INTENT,
    });

    const view = await loadInstallationIdentityView(db, store, {
      readText: stateText("development"),
      env: {},
      // Source authority follows the host, not the purpose: a consumer runtime
      // install has none even when its declared job is to improve DPF.
      readHostProfile: CONSUMER_HOST,
    });

    expect(view.stances.find((row) => row.stance === "sourceAuthority")?.valueLabel).toBe(
      "Not here",
    );
  });

  it("mirrors work once a same-organization link backs the declared peer", async () => {
    const { store, db } = configStore({ [OPERATING_INTENT_CONFIG_KEY]: CONFIRMED_DEV_INTENT }, [
      {
        linkId: "FL-0001",
        linkState: "active",
        relationshipPreset: "same-organization",
        peerLabel: "dpf-prod-acme",
        revokedAt: null,
        quarantinedAt: null,
      },
    ]);

    const view = await loadInstallationIdentityView(db, store, {
      readText: stateText("development"),
      env: {},
    });

    const workSync = view.stances.find((row) => row.stance === "workSync");
    expect(workSync).toMatchObject({
      valueLabel: "Mirrored to the organization",
      intent: "neutral",
    });
    expect(workSync?.rationale).toContain("only this side may change");
  });
});
