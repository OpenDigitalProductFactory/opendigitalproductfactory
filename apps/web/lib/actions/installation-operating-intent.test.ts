import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCapability: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn((args: unknown) => args),
  count: vi.fn(),
  transaction: vi.fn(),
  revalidatePath: vi.fn(),
  resolvePrincipal: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability: mocks.requireCapability }));
vi.mock("@/lib/identity/principal-linking", () => ({
  resolvePrincipalIdForUser: mocks.resolvePrincipal,
}));
vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile, stat: vi.fn(async () => {
  throw new Error("ENOENT");
}) }));
vi.mock("@dpf/db", () => ({
  prisma: {
    platformConfig: { findUnique: mocks.findUnique, upsert: mocks.upsert },
    backlogItem: { count: mocks.count },
    $transaction: mocks.transaction,
  },
}));

import { ENVIRONMENT_CLASS_CONFIG_KEY } from "@/lib/install/environment-class-contract";
import { OPERATING_INTENT_CONFIG_KEY } from "@/lib/install/instance-stance";

import {
  declareInstallationIdentity,
  previewInstallationIdentityChange,
} from "./installation-operating-intent";

const CONFIRMED_DEV_INTENT = {
  schemaVersion: 1,
  primaryPurpose: "evolve-dpf",
  secondaryPurposes: [],
  relationshipIntents: [],
  pairedProductionInstallationRef: "dpf-prod-acme",
  evidence: [
    {
      source: "installer",
      claim: "Development workspace detected on host",
      observedAt: "2026-08-01T00:00:00.000Z",
    },
  ],
  confidence: "high",
  confirmation: {
    status: "confirmed",
    confirmedAt: "2026-08-02T00:00:00.000Z",
    confirmedByPrincipalId: "PRN-1",
  },
};

const DEV_DECLARATION = {
  primaryPurpose: "evolve-dpf",
  environmentClass: "development",
  pairedProductionInstallationRef: "dpf-prod-acme",
};

/** Seed the PlatformConfig rows and the installer-state file this run should see. */
function seed(options: {
  rows?: Record<string, unknown>;
  installerEnvironmentClass?: string;
  unfinishedItems?: number;
}) {
  const rows = options.rows ?? {};
  mocks.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
    where.key in rows ? { value: rows[where.key] } : null,
  );
  mocks.count.mockResolvedValue(options.unfinishedItems ?? 0);
  mocks.readFile.mockImplementation(async () =>
    JSON.stringify(
      options.installerEnvironmentClass
        ? { environmentClass: options.installerEnvironmentClass }
        : { installMode: "consumer" },
    ),
  );
}

/** The value each key was written with in the single transaction. */
function written(): Record<string, Record<string, unknown>> {
  expect(mocks.transaction).toHaveBeenCalledTimes(1);
  const out: Record<string, Record<string, unknown>> = {};
  for (const call of mocks.upsert.mock.calls) {
    const arg = call[0] as { where: { key: string }; create: { value: Record<string, unknown> } };
    out[arg.where.key] = arg.create.value;
  }
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireCapability.mockResolvedValue({ userId: "user-1" });
  mocks.resolvePrincipal.mockResolvedValue("PRN-1");
  mocks.upsert.mockImplementation((args: unknown) => args);
  mocks.transaction.mockResolvedValue([]);
  delete process.env.DPF_ENVIRONMENT_CLASS;
  seed({});
});

describe("previewInstallationIdentityChange", () => {
  it("refuses an unknown job without reading anything", async () => {
    const result = await previewInstallationIdentityChange({
      ...DEV_DECLARATION,
      primaryPurpose: "run-the-world",
    });
    expect(result).toMatchObject({ ok: false });
    expect(mocks.requireCapability).not.toHaveBeenCalled();
  });

  it("refuses an environment outside the closed vocabulary", async () => {
    const result = await previewInstallationIdentityChange({
      ...DEV_DECLARATION,
      environmentClass: "staging",
    });
    expect(result).toMatchObject({ ok: false });
  });

  it("requires platform authority", async () => {
    seed({ rows: { [OPERATING_INTENT_CONFIG_KEY]: CONFIRMED_DEV_INTENT } });
    mocks.requireCapability.mockRejectedValue(new Error("forbidden"));
    await expect(previewInstallationIdentityChange(DEV_DECLARATION)).rejects.toThrow("forbidden");
  });

  it("computes the stance change and writes nothing", async () => {
    seed({
      rows: { [OPERATING_INTENT_CONFIG_KEY]: CONFIRMED_DEV_INTENT },
      installerEnvironmentClass: "development",
      unfinishedItems: 7,
    });

    const result = await previewInstallationIdentityChange({
      ...DEV_DECLARATION,
      environmentClass: "production",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.impact.material).toBe(true);
    expect(result.data.impact.changes.map((c) => c.field)).toEqual(["environmentClass"]);
    expect(result.data.impact.stanceDeltas.find((d) => d.stance === "teardown")).toMatchObject({
      from: "Capture work first",
      to: "Never",
      direction: "tightens",
    });
    // Installer state still says development, so the declaration would be shadowed.
    expect(result.data.environmentAfter.environmentClass).toBe("development");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});

describe("declareInstallationIdentity", () => {
  it("refuses a material change that carries no preview token", async () => {
    seed({ rows: { [OPERATING_INTENT_CONFIG_KEY]: CONFIRMED_DEV_INTENT } });

    const result = await declareInstallationIdentity({
      ...DEV_DECLARATION,
      primaryPurpose: "operate-organization",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.kind).toBe("needs-preview");
    if (result.data.kind !== "needs-preview") return;
    expect(result.data.impact.material).toBe(true);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("refuses a token from a different proposed identity", async () => {
    seed({ rows: { [OPERATING_INTENT_CONFIG_KEY]: CONFIRMED_DEV_INTENT } });

    const preview = await previewInstallationIdentityChange({
      ...DEV_DECLARATION,
      environmentClass: "test",
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const result = await declareInstallationIdentity(
      { ...DEV_DECLARATION, primaryPurpose: "grow-channel" },
      preview.data.impact.previewToken,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.kind).toBe("needs-preview");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("writes both records in one transaction when the preview matches", async () => {
    seed({
      rows: { [OPERATING_INTENT_CONFIG_KEY]: CONFIRMED_DEV_INTENT },
      installerEnvironmentClass: "development",
    });

    const next = { ...DEV_DECLARATION, primaryPurpose: "operate-organization" };
    const preview = await previewInstallationIdentityChange(next);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const result = await declareInstallationIdentity(next, preview.data.impact.previewToken);

    expect(result).toMatchObject({
      ok: true,
      data: { kind: "saved", changed: true, confirmationStatus: "confirmed" },
    });
    const values = written();
    expect(values[OPERATING_INTENT_CONFIG_KEY]).toMatchObject({
      schemaVersion: 1,
      primaryPurpose: "operate-organization",
      pairedProductionInstallationRef: "dpf-prod-acme",
      confidence: "high",
      confirmation: { status: "confirmed", confirmedByPrincipalId: "PRN-1" },
    });
    expect(values[ENVIRONMENT_CLASS_CONFIG_KEY]).toMatchObject({
      schemaVersion: 1,
      environmentClass: "development",
      declaredByPrincipalId: "PRN-1",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/workspace");
  });

  it("never writes the installer state file", async () => {
    seed({
      rows: { [OPERATING_INTENT_CONFIG_KEY]: CONFIRMED_DEV_INTENT },
      installerEnvironmentClass: "development",
    });
    const next = { ...DEV_DECLARATION, primaryPurpose: "grow-channel" };
    const preview = await previewInstallationIdentityChange(next);
    if (!preview.ok) throw new Error("preview failed");

    await declareInstallationIdentity(next, preview.data.impact.previewToken);

    const keys = Object.keys(written());
    expect(keys.sort()).toEqual(
      [ENVIRONMENT_CLASS_CONFIG_KEY, OPERATING_INTENT_CONFIG_KEY].sort(),
    );
  });

  it("stores needs-review when a higher authority overrules the declared environment", async () => {
    seed({
      rows: { [OPERATING_INTENT_CONFIG_KEY]: CONFIRMED_DEV_INTENT },
      installerEnvironmentClass: "development",
    });

    const next = { ...DEV_DECLARATION, environmentClass: "production" };
    const preview = await previewInstallationIdentityChange(next);
    if (!preview.ok) throw new Error("preview failed");

    const result = await declareInstallationIdentity(next, preview.data.impact.previewToken);

    expect(result).toMatchObject({
      ok: true,
      data: { kind: "saved", confirmationStatus: "needs-review" },
    });
    const intent = written()[OPERATING_INTENT_CONFIG_KEY] as {
      confidence: string;
      confirmation: { status: string };
      evidence: Array<{ claim: string }>;
    };
    expect(intent.confirmation).toEqual({ status: "needs-review" });
    expect(intent.confidence).toBe("medium");
    expect(intent.evidence.at(-1)?.claim).toContain("development is in force");
  });

  it("keeps superseded evidence and appends the human declaration", async () => {
    seed({
      rows: { [OPERATING_INTENT_CONFIG_KEY]: CONFIRMED_DEV_INTENT },
      installerEnvironmentClass: "development",
    });

    const next = { ...DEV_DECLARATION, primaryPurpose: "participate-community" };
    const preview = await previewInstallationIdentityChange(next);
    if (!preview.ok) throw new Error("preview failed");
    await declareInstallationIdentity(next, preview.data.impact.previewToken);

    const intent = written()[OPERATING_INTENT_CONFIG_KEY] as {
      evidence: Array<{ source: string; claim: string }>;
    };
    expect(intent.evidence[0]).toMatchObject({ source: "installer" });
    expect(intent.evidence.at(-1)).toMatchObject({ source: "human" });
    expect(intent.evidence.at(-1)?.claim).toContain("Its main job");
  });

  it("does not rewrite a confirmed record that already matches", async () => {
    seed({
      rows: {
        [OPERATING_INTENT_CONFIG_KEY]: CONFIRMED_DEV_INTENT,
        [ENVIRONMENT_CLASS_CONFIG_KEY]: {
          schemaVersion: 1,
          environmentClass: "development",
          declaredAt: "2026-08-02T00:00:00.000Z",
          declaredByPrincipalId: "PRN-1",
        },
      },
      installerEnvironmentClass: "development",
    });

    const result = await declareInstallationIdentity(DEV_DECLARATION);

    expect(result).toMatchObject({
      ok: true,
      data: { kind: "saved", changed: false, confirmationStatus: "confirmed" },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("confirms a suggestion without needing a preview token", async () => {
    seed({
      rows: {
        [OPERATING_INTENT_CONFIG_KEY]: {
          ...CONFIRMED_DEV_INTENT,
          confidence: "medium",
          confirmation: { status: "suggested" },
        },
      },
      installerEnvironmentClass: "development",
    });

    const result = await declareInstallationIdentity(DEV_DECLARATION);

    expect(result).toMatchObject({
      ok: true,
      data: { kind: "saved", changed: true, confirmationStatus: "confirmed" },
    });
    expect(written()[OPERATING_INTENT_CONFIG_KEY]).toMatchObject({
      confirmation: { status: "confirmed" },
    });
  });

  it("clears the pairing when the reference is emptied", async () => {
    seed({
      rows: { [OPERATING_INTENT_CONFIG_KEY]: CONFIRMED_DEV_INTENT },
      installerEnvironmentClass: "development",
    });

    const next = { ...DEV_DECLARATION, pairedProductionInstallationRef: "  " };
    const preview = await previewInstallationIdentityChange(next);
    if (!preview.ok) throw new Error("preview failed");
    await declareInstallationIdentity(next, preview.data.impact.previewToken);

    expect(written()[OPERATING_INTENT_CONFIG_KEY]).not.toHaveProperty(
      "pairedProductionInstallationRef",
    );
  });
});
