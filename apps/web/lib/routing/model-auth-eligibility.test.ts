import { describe, expect, it, vi } from "vitest";

import {
  RUNTIME_REFUSAL_TTL_MS,
  authEligibilityExclusionReason,
  isModelRefusalError,
  readAuthEligibility,
  recordAuthEligibility,
  recordDiscoveredAuthEligibility,
  withAuthEligibility,
  type AuthEligibilityDb,
} from "./model-auth-eligibility";

const now = new Date("2026-09-15T12:00:00.000Z");
const oauth = "oauth2_authorization_code";

describe("readAuthEligibility", () => {
  it("reads the record for the auth method and treats an expired record as absent", () => {
    const overrides = withAuthEligibility({ toolUse: true }, oauth, {
      supported: false, source: "runtime-refusal", learnedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 1000).toISOString(),
    });
    expect(readAuthEligibility(overrides, oauth, now)?.supported).toBe(false);
    expect(readAuthEligibility(overrides, "api_key", now)).toBeNull();
    expect(readAuthEligibility(overrides, oauth, new Date(now.getTime() + 1000))).toBeNull();
    // The admin toolUse override is untouched by the merge.
    expect((overrides as { toolUse: boolean }).toolUse).toBe(true);
  });

  it("tolerates missing or malformed overrides", () => {
    expect(readAuthEligibility(null, oauth)).toBeNull();
    expect(readAuthEligibility({ authEligibility: "nope" }, oauth)).toBeNull();
    expect(readAuthEligibility({ authEligibility: { [oauth]: { supported: "yes" } } }, oauth)).toBeNull();
  });
});

describe("authEligibilityExclusionReason", () => {
  it("prefers a learned verdict over the checked-in seed in both directions", () => {
    // Seed says gpt-5.3-codex is unsupported on a ChatGPT account…
    expect(authEligibilityExclusionReason({
      providerId: "codex", authMethod: oauth, modelId: "gpt-5.3-codex", capabilityOverrides: null, now,
    })).toContain("not supported when Codex uses a ChatGPT account");
    // …but discovery under that account listed it: learned wins.
    const listed = withAuthEligibility(null, oauth, { supported: true, source: "discovery", learnedAt: now.toISOString() });
    expect(authEligibilityExclusionReason({
      providerId: "codex", authMethod: oauth, modelId: "gpt-5.3-codex", capabilityOverrides: listed, now,
    })).toBeNull();
    // And a refusal benches a model the seed knows nothing about.
    const refused = withAuthEligibility(null, oauth, {
      supported: false, source: "runtime-refusal", learnedAt: now.toISOString(), reason: "model_not_found",
    });
    expect(authEligibilityExclusionReason({
      providerId: "codex", authMethod: oauth, modelId: "gpt-5.6-terra", capabilityOverrides: refused, now,
    })).toMatch(/not supported for provider 'codex' under auth 'oauth2_authorization_code' \(learned from runtime-refusal/);
  });

  it("is silent for providers and auth methods the seed does not cover", () => {
    expect(authEligibilityExclusionReason({
      providerId: "anthropic", authMethod: "api_key", modelId: "claude-sonnet-4-6", capabilityOverrides: null, now,
    })).toBeNull();
  });
});

describe("isModelRefusalError", () => {
  it("matches provider refusals of a model, not request-level failures", () => {
    for (const message of [
      "Model 'gpt-5.3-codex' is not supported when Codex uses a ChatGPT account",
      "The model `gpt-5.4` does not exist or you do not have access to it.",
      "{\"error\":{\"code\":\"model_not_found\"}}",
      "Unknown model: claude-3-haiku",
      "unsupported model requested",
      "model gpt-4.5-preview has been deprecated",
    ]) expect(isModelRefusalError(message), message).toBe(true);
    for (const message of [
      "rate limit exceeded, retry after 20s",
      "401 invalid api key",
      "context length exceeded: this model supports at most 200000 tokens",
      "connection reset",
      null, undefined, "",
    ]) expect(isModelRefusalError(message), String(message)).toBe(false);
  });
});

function fakeDb(existing: { id: string; capabilityOverrides: unknown } | null) {
  const update = vi.fn().mockResolvedValue({});
  const create = vi.fn().mockResolvedValue({});
  const db = {
    modelProfile: { findUnique: vi.fn().mockResolvedValue(existing), update },
    modelCapabilityChangeLog: { create },
  } as unknown as AuthEligibilityDb;
  return { db, update, create };
}

describe("recordAuthEligibility", () => {
  it("benches a refused model for a day and audits the change", async () => {
    const { db, update, create } = fakeDb({ id: "mp_1", capabilityOverrides: { toolUse: true } });
    const result = await recordAuthEligibility(db, {
      providerId: "codex", modelId: "gpt-5.3-codex", authMethod: oauth,
      supported: false, source: "runtime-refusal", reason: "model_not_found", now,
    });
    expect(result.changed).toBe(true);
    expect(result.record.expiresAt).toBe(new Date(now.getTime() + RUNTIME_REFUSAL_TTL_MS).toISOString());
    const written = update.mock.calls[0][0].data.capabilityOverrides;
    expect(written.toolUse).toBe(true);
    expect(written.authEligibility[oauth]).toMatchObject({ supported: false, source: "runtime-refusal", reason: "model_not_found" });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
      providerId: "codex", modelId: "gpt-5.3-codex", field: `authEligibility.${oauth}`, source: "runtime-refusal",
      oldValue: null, newValue: expect.objectContaining({ supported: false }),
    }) });
  });

  it("re-learning the same verdict refreshes the record without a new audit row", async () => {
    const prior = withAuthEligibility(null, oauth, { supported: true, source: "discovery", learnedAt: "2026-09-14T00:00:00.000Z" });
    const { db, create } = fakeDb({ id: "mp_1", capabilityOverrides: prior });
    const result = await recordAuthEligibility(db, {
      providerId: "codex", modelId: "gpt-5.5", authMethod: oauth, supported: true, source: "discovery", now,
    });
    expect(result.changed).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("does nothing for a model that has no profile row", async () => {
    const { db, update } = fakeDb(null);
    const result = await recordAuthEligibility(db, {
      providerId: "codex", modelId: "ghost", authMethod: oauth, supported: false, source: "runtime-refusal", now,
    });
    expect(result.changed).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("recordDiscoveredAuthEligibility", () => {
  it("re-admits every listed model, clearing a prior refusal", async () => {
    const refused = withAuthEligibility(null, oauth, { supported: false, source: "runtime-refusal", learnedAt: now.toISOString() });
    const { db, update } = fakeDb({ id: "mp_1", capabilityOverrides: refused });
    const result = await recordDiscoveredAuthEligibility(db, {
      providerId: "codex", authMethod: oauth, modelIds: ["gpt-5.5", "gpt-5.6-terra"], now,
    });
    expect(result.readmitted).toEqual(["gpt-5.5", "gpt-5.6-terra"]);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[0][0].data.capabilityOverrides.authEligibility[oauth]).toMatchObject({ supported: true, source: "discovery" });
  });
});
