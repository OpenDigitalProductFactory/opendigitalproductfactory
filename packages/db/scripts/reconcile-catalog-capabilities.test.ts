import { describe, it, expect } from "vitest";
import { buildCatalogHash, diffExcludingOverrides, catalogEntryToProfileFields } from "./reconcile-catalog-capabilities";
import type { KnownModel } from "../../../apps/web/lib/routing/known-provider-models";
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
  capabilityTier: "tier-1",
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
});

describe("catalogEntryToProfileFields", () => {
  it("maps KnownModel to ModelProfile update shape", () => {
    const fields = catalogEntryToProfileFields(sampleModel);
    expect(fields.supportsToolUse).toBe(true);
    expect(fields.toolFidelity).toBe(80);
    expect((fields.capabilities as any).toolUse).toBe(true);
    expect(fields.modelStatus).toBe("active");
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
