import { describe, it, expect } from "vitest";
import { buildCatalogHash, diffExcludingOverrides, catalogEntryToProfileFields, resolveKnownProviderModelsPath } from "./reconcile-catalog-capabilities";
import type { KnownModel } from "../../../apps/web/lib/routing/known-provider-models";
import { KNOWN_PROVIDER_MODELS } from "../../../apps/web/lib/routing/known-provider-models";
import { EMPTY_CAPABILITIES } from "../../../apps/web/lib/routing/model-card-types";

const sampleModel: KnownModel = {
  modelId: "gpt-5.3-codex",
  friendlyName: "GPT-5.3 Codex",
  summary: "Test model",
  qualityTier: "frontier",
  capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, streaming: true },
  maxContextTokens: 128000,
  maxOutputTokens: 8192,
  inputModalities: ["text"],
  outputModalities: ["text"],
  modelClass: "chat",
  modelFamily: "gpt-5",
  capabilityCategory: "advanced",
  costTier: "premium",
  bestFor: ["tool-use"],
  avoidFor: [],
  defaultStatus: "active",
  scores: { reasoning: 80, codegen: 80, toolFidelity: 80, instructionFollowingScore: 75, structuredOutputScore: 75, conversational: 70, contextRetention: 70 },
};

describe("buildCatalogHash", () => {
  it("produces consistent hash for same input", () => {
    const h1 = buildCatalogHash(sampleModel);
    const h2 = buildCatalogHash(sampleModel);
    expect(h1).toBe(h2);
  });

  it("produces different hash when capability changes", () => {
    const changed = { ...sampleModel, capabilities: { ...sampleModel.capabilities, toolUse: false } };
    expect(buildCatalogHash(sampleModel)).not.toBe(buildCatalogHash(changed));
  });
});

describe("diffExcludingOverrides", () => {
  it("returns changed fields excluding those in capabilityOverrides", () => {
    const profile = { supportsToolUse: false, toolFidelity: 10 };
    const entry = { supportsToolUse: true, toolFidelity: 80 };
    const overrides = { supportsToolUse: false }; // admin pinned this
    const diff = diffExcludingOverrides(profile as any, entry as any, overrides);
    expect(diff).toEqual({ toolFidelity: 80 }); // toolUse excluded, toolFidelity included
  });

  it("returns all changed fields when capabilityOverrides is null", () => {
    const profile = { supportsToolUse: false, toolFidelity: 10 };
    const entry = { supportsToolUse: true, toolFidelity: 80 };
    const diff = diffExcludingOverrides(profile as any, entry as any, null);
    expect(diff).toEqual({ supportsToolUse: true, toolFidelity: 80 });
  });

  it("returns empty object when nothing changed", () => {
    const profile = { supportsToolUse: true, toolFidelity: 80 };
    const entry = { supportsToolUse: true, toolFidelity: 80 };
    const diff = diffExcludingOverrides(profile as any, entry as any, null);
    expect(diff).toEqual({});
  });

  // BI-E552BB73. A nulled capability inside the blob must register as drift.
  // The routing hard filter drops any endpoint whose capabilities.streaming is
  // not exactly `true` on a sync call, so this specific divergence silently made
  // all 8 zai-coding models unroutable and left the Build Studio plan phase with
  // no eligible provider.
  it("detects a nulled capability inside the capabilities blob", () => {
    const profile = {
      capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, streaming: null },
    };
    const entry = {
      capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, streaming: true },
    };
    const diff = diffExcludingOverrides(profile as any, entry as any, null);
    expect(diff).toHaveProperty("capabilities");
    expect((diff.capabilities as Record<string, unknown>).streaming).toBe(true);
  });

  // Postgres jsonb re-orders object keys on write (by length, then bytewise), so
  // the stored blob never comes back in the source order of the catalog literal.
  // Comparing raw JSON.stringify would therefore report `capabilities` as changed
  // on EVERY run and write a changelog entry at every boot. Compare canonically.
  it("does not report drift when only key order differs (jsonb round-trip)", () => {
    const profile = {
      capabilities: { streaming: true, toolUse: true, thinking: false },
    };
    const entry = {
      capabilities: { toolUse: true, thinking: false, streaming: true },
    };
    const diff = diffExcludingOverrides(profile as any, entry as any, null);
    expect(diff).toEqual({});
  });

  it("still honours capabilityOverrides for a drifted capabilities blob", () => {
    const profile = {
      capabilities: { ...EMPTY_CAPABILITIES, streaming: null },
    };
    const entry = {
      capabilities: { ...EMPTY_CAPABILITIES, streaming: true },
    };
    const diff = diffExcludingOverrides(profile as any, entry as any, {
      capabilities: true,
    });
    expect(diff).toEqual({});
  });
});

describe("catalogEntryToProfileFields", () => {
  it("maps KnownModel to ModelProfile update shape", () => {
    const fields = catalogEntryToProfileFields(sampleModel);
    expect(fields.supportsToolUse).toBe(true);
    expect(fields.toolFidelity).toBe(80);
    expect((fields.capabilities as any).toolUse).toBe(true);
    expect(fields.modelStatus).toBe("active");
  });

  // Regression: the create path requires the non-nullable ModelProfile.capabilityCategory
  // column. A pre-#318 mapping emitted `capabilityTier` (renamed away) and omitted
  // capabilityCategory, which Prisma rejects on create — crashing catalog reconciliation
  // the first time a brand-new catalog model is seen (e.g. zai/glm-5.2).
  it("emits capabilityCategory (not the renamed capabilityTier) so create() satisfies the schema", () => {
    const fields = catalogEntryToProfileFields(sampleModel) as Record<string, unknown>;
    expect(fields.capabilityCategory).toBe("advanced");
    expect(fields).not.toHaveProperty("capabilityTier");
  });
});

describe("resolveKnownProviderModelsPath", () => {
  it("resolves the packaged app source path when the repo app path is not present", () => {
    const scriptDir = "C:\\app\\packages\\db\\scripts";
    const packagedRoot = "C:\\app\\apps\\web-src";
    const packagedCatalog = "C:\\app\\apps\\web-src\\lib\\routing\\known-provider-models.ts";

    const resolved = resolveKnownProviderModelsPath({
      scriptDir,
      packagedWebSourceRoot: packagedRoot,
      exists: (candidate) => candidate === packagedCatalog,
    });

    expect(resolved).toBe(packagedCatalog);
  });

  it("resolves Linux-style packaged app source paths independent of the test host OS", () => {
    const scriptDir = "/app/packages/db/scripts";
    const packagedRoot = "/app/apps/web-src";
    const packagedCatalog = "/app/apps/web-src/lib/routing/known-provider-models.ts";

    const resolved = resolveKnownProviderModelsPath({
      scriptDir,
      packagedWebSourceRoot: packagedRoot,
      exists: (candidate) => candidate === packagedCatalog,
    });

    expect(resolved).toBe(packagedCatalog);
  });
});

describe("admin row-level protection", () => {
  it("diffExcludingOverrides returns empty when profileSource=admin and overrides=null (full row protection)", () => {
    // Spec §5.2: if profileSource="admin" AND capabilityOverrides IS NULL, treat as fully protected.
    // The reconcile loop checks this BEFORE calling diffExcludingOverrides, but we test the
    // convention here so the integration path is clearly documented.
    const profile = { supportsToolUse: false, toolFidelity: 10 };
    const entry = { supportsToolUse: true, toolFidelity: 80 };
    // When overrides is null AND the caller passes it as a full-row guard sentinel,
    // the calling code skips entirely — but if it mistakenly calls diffExcludingOverrides
    // with null overrides on an admin row, this test confirms all fields would be returned
    // (i.e., the guard must be in the loop, not in diffExcludingOverrides itself).
    const diff = diffExcludingOverrides(profile as any, entry as any, null);
    expect(diff).toEqual({ supportsToolUse: true, toolFidelity: 80 });
    // The reconcile loop (not this helper) is responsible for skipping admin+null rows.
  });
});

// Catalog-integrity guard — the whole point of "bulletproof": every model that ships
// in KNOWN_PROVIDER_MODELS must map to a create-ready ModelProfile shape. Adding a new
// model (e.g. Sonnet 5), or editing one during a retire/deprecate, that omits a
// required column or uses a bad status now fails CI with a per-model message, instead
// of surfacing as a boot-time PrismaClientValidationError on the create path.
describe("catalog integrity — every KNOWN_PROVIDER_MODELS entry is create-ready", () => {
  const allEntries: Array<{ providerId: string; modelId: string; model: KnownModel }> =
    Object.entries(KNOWN_PROVIDER_MODELS).flatMap(([providerId, models]) =>
      (models as KnownModel[]).map((model) => ({ providerId, modelId: model.modelId, model })),
    );

  it("has at least one catalog model", () => {
    expect(allEntries.length).toBeGreaterThan(0);
  });

  // Required, non-nullable ModelProfile columns that catalogEntryToProfileFields supplies.
  const REQUIRED_STRING_COLUMNS = ["capabilityCategory", "costTier", "friendlyName", "summary", "modelClass"] as const;
  const VALID_MODEL_STATUSES = ["active", "retired", "disabled"];

  it.each(allEntries)("$providerId/$modelId maps to a valid profile shape", ({ providerId, modelId, model }) => {
    const label = `${providerId}/${modelId}`;
    const fields = catalogEntryToProfileFields(model) as Record<string, unknown>;

    for (const col of REQUIRED_STRING_COLUMNS) {
      const value = fields[col];
      expect(typeof value, `${label} — column '${col}' must be a string`).toBe("string");
      expect((value as string).length, `${label} — column '${col}' must be non-empty`).toBeGreaterThan(0);
    }
    // Retire/deprecate path: defaultStatus drives modelStatus; must land on a known value.
    expect(VALID_MODEL_STATUSES, `${label} — modelStatus`).toContain(fields.modelStatus);
    // Hashing must be deterministic and never throw (used for idempotent reconcile).
    expect(() => buildCatalogHash(model)).not.toThrow();
  });
});
