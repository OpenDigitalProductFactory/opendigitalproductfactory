import { describe, expect, it } from "vitest";
import {
  buildLocalFallbackBanner,
  classifyExclusionReason,
  extractLocalFallbackFacts,
  escalationCameOnlyFromHistory,
  type DowngradeCause,
} from "./downgrade-explanation";

// The literal strings `getExclusionReasonV2` (routing/pipeline-v2.ts) returns.
// Kept verbatim so a reword there fails this test instead of silently degrading
// every owner-facing downgrade message back to the catch-all phrasing.
const REAL_REASONS: Array<[string, DowngradeCause]> = [
  ["Context window too small: 24576 < 32000", "context-window"],
  ["rate limit reached: daily quota exhausted", "rate-limit"],
  ["Sensitivity clearance missing for 'restricted'", "clearance"],
  ["Residency policy 'local_only' requires a local provider (Docker Model Runner or Ollama)", "residency"],
  ["Missing required capability: toolUse", "capability"],
  ["Missing required capability: structuredOutput", "capability"],
  ["Missing required capability: image input (imageInput)", "capability"],
  ["Agent requires capability 'webSearch' (EP-AGENT-CAP-002)", "capability"],
  ['modelClass "embedding" does not match required "chat"', "model-class"],
  ["Status is 'disabled'", "provider-off"],
  ["Status is 'unconfigured'", "provider-off"],
];

describe("classifyExclusionReason", () => {
  for (const [reason, expected] of REAL_REASONS) {
    it(`classifies ${JSON.stringify(reason)} as ${expected}`, () => {
      expect(classifyExclusionReason(reason)).toBe(expected);
    });
  }

  it("falls back to unknown for an unrecognized reason rather than guessing", () => {
    expect(classifyExclusionReason("something new nobody mapped yet")).toBe("unknown");
  });

  it("is case-insensitive", () => {
    expect(classifyExclusionReason("CONTEXT WINDOW TOO SMALL: 1 < 2")).toBe("context-window");
  });
});

describe("extractLocalFallbackFacts", () => {
  type M = {
    id: string;
    name: string;
    status: string;
    providerTier: string;
    sensitivityClearance: string[];
  };
  const manifest = (over: Partial<M> = {}): M => ({
    id: "ep-claude",
    name: "Claude / Anthropic (OAuth Subscription)",
    status: "disabled",
    providerTier: "user_configured",
    sensitivityClearance: ["public", "internal", "confidential", "restricted"],
    ...over,
  });

  it("names only user-configured providers that are switched off", () => {
    const facts = extractLocalFallbackFacts({
      manifests: [
        manifest(),
        manifest({ id: "ep-xai", name: "xAI (Grok)", status: "active" }),
        manifest({ id: "ep-local", name: "Docker Model Runner (local)", providerTier: "bundled" }),
      ],
      candidates: [],
      sensitivity: "internal",
    });
    expect(facts.offProviderNames).toEqual(["Claude / Anthropic (OAuth Subscription)"]);
  });

  it("deduplicates a provider that exposes several endpoints", () => {
    const facts = extractLocalFallbackFacts({
      manifests: [manifest({ id: "ep-1" }), manifest({ id: "ep-2" })],
      candidates: [],
      sensitivity: "internal",
    });
    expect(facts.offProviderNames).toEqual(["Claude / Anthropic (OAuth Subscription)"]);
  });

  // The exact live turn: RouteDecisionLog cms6tcwcs07xk01oglygsz21v, sensitivity
  // "restricted", 14 excluded / 1 ranked. anthropic-sub was disabled AND holds
  // clearance ["public"], so telling the owner to reconnect it would have been
  // confidently wrong — reconnecting changes nothing at this data class.
  it("does NOT name a switched-off provider that lacks clearance for this turn", () => {
    const facts = extractLocalFallbackFacts({
      manifests: [
        manifest({ sensitivityClearance: ["public"] }),
        manifest({ id: "ep-codex", name: "OpenAI Codex", status: "active", sensitivityClearance: ["public", "internal", "confidential"] }),
      ],
      candidates: [
        { endpointId: "ep-codex", excluded: true, excludedReason: "Sensitivity clearance missing for 'restricted'" },
      ],
      sensitivity: "restricted",
    });
    expect(facts.offProviderNames).toEqual([]);
    expect(facts.excludedReasons).toEqual(["Sensitivity clearance missing for 'restricted'"]);
  });

  it("still names a switched-off provider that IS cleared for this turn", () => {
    const facts = extractLocalFallbackFacts({
      manifests: [manifest({ sensitivityClearance: ["public"] })],
      candidates: [],
      sensitivity: "public",
    });
    expect(facts.offProviderNames).toEqual(["Claude / Anthropic (OAuth Subscription)"]);
  });

  it("keeps only exclusion reasons belonging to user-configured endpoints", () => {
    const facts = extractLocalFallbackFacts({
      manifests: [manifest({ id: "ep-claude", status: "active" })],
      candidates: [
        { endpointId: "ep-claude", excluded: true, excludedReason: "Context window too small: 1 < 2" },
        { endpointId: "ep-local", excluded: true, excludedReason: "should not surface — bundled tier" },
      ],
      sensitivity: "internal",
    });
    expect(facts.excludedReasons).toEqual(["Context window too small: 1 < 2"]);
  });

  it("ignores candidates that were not excluded, and excluded ones with no reason", () => {
    const facts = extractLocalFallbackFacts({
      manifests: [manifest({ status: "active" })],
      candidates: [
        { endpointId: "ep-claude", excluded: false, excludedReason: "not applied" },
        { endpointId: "ep-claude", excluded: true },
      ],
      sensitivity: "internal",
    });
    expect(facts.excludedReasons).toEqual([]);
  });

  it("returns empty facts when routing had nothing to say", () => {
    expect(
      extractLocalFallbackFacts({ manifests: [], candidates: [], sensitivity: "internal" }),
    ).toEqual({ offProviderNames: [], excludedReasons: [] });
  });
});

// End-to-end on the founder's real turn: the banner must explain the data class,
// never send them to reconnect a provider that could not have served it.
describe("the reported restricted-class turn (BI-CD13D818)", () => {
  it("explains the clearance excluder and gives no reconnect advice", () => {
    const banner = buildLocalFallbackBanner(
      extractLocalFallbackFacts({
        manifests: [
          { id: "ep-claude", name: "Claude / Anthropic (OAuth Subscription)", status: "disabled", providerTier: "user_configured", sensitivityClearance: ["public"] },
          { id: "ep-codex", name: "OpenAI Codex", status: "active", providerTier: "user_configured", sensitivityClearance: ["public", "internal", "confidential"] },
          { id: "ep-local", name: "Docker Model Runner (local)", status: "active", providerTier: "bundled", sensitivityClearance: ["public", "internal", "confidential", "restricted"] },
        ],
        candidates: [
          { endpointId: "ep-codex", excluded: true, excludedReason: "Sensitivity clearance missing for 'restricted'" },
        ],
        sensitivity: "restricted",
      }),
    );
    expect(banner).toContain("isn't cleared for this data sensitivity");
    expect(banner).not.toContain("Reconnect");
    expect(banner).not.toContain("Claude");
  });
});

describe("buildLocalFallbackBanner", () => {
  it("names a switched-off provider and the fix instead of claiming it is active", () => {
    const banner = buildLocalFallbackBanner({
      excludedReasons: ["Status is 'disabled'"],
      offProviderNames: ["Claude / Anthropic (OAuth Subscription)"],
    });
    expect(banner).toContain("Claude / Anthropic (OAuth Subscription) is switched off");
    expect(banner).toContain("Platform > AI > Providers");
    // The precise regression: the old copy asserted the provider was active.
    expect(banner).not.toContain("is active");
  });

  it("pluralizes when several providers are off", () => {
    const banner = buildLocalFallbackBanner({
      excludedReasons: [],
      offProviderNames: ["Claude", "Z.ai"],
    });
    expect(banner).toContain("Claude and Z.ai are switched off");
    expect(banner).toContain("Reconnect them");
  });

  it("reports the real excluder when every provider is available but ineligible", () => {
    const banner = buildLocalFallbackBanner({
      excludedReasons: ["Context window too small: 24576 < 32000"],
      offProviderNames: [],
    });
    expect(banner).toContain("stayed available");
    expect(banner).toContain("longer than its context window");
    // No guessing: the old copy said "usually because…".
    expect(banner).not.toContain("usually because");
  });

  it("combines distinct causes without repeating one", () => {
    const banner = buildLocalFallbackBanner({
      excludedReasons: [
        "Context window too small: 24576 < 32000",
        "Context window too small: 8192 < 32000",
        "Missing required capability: toolUse",
      ],
      offProviderNames: [],
    });
    expect(banner).toContain("longer than its context window");
    expect(banner).toContain("needed a capability it doesn't offer");
    expect(banner.match(/context window/g)).toHaveLength(1);
  });

  it("drops the catch-all phrase once a specific cause is known", () => {
    const banner = buildLocalFallbackBanner({
      excludedReasons: ["Context window too small: 1 < 2", "brand new unmapped reason"],
      offProviderNames: [],
    });
    expect(banner).toContain("longer than its context window");
    expect(banner).not.toContain("wasn't eligible for this request");
  });

  it("degrades honestly when routing recorded no reason at all", () => {
    const banner = buildLocalFallbackBanner({ excludedReasons: [], offProviderNames: [] });
    expect(banner).toContain("none was eligible for this request");
  });

  it("always states which model ran and the local-quality caveat", () => {
    for (const input of [
      { excludedReasons: [], offProviderNames: [] },
      { excludedReasons: ["Missing required capability: toolUse"], offProviderNames: [] },
      { excludedReasons: [], offProviderNames: ["Claude"] },
    ]) {
      const banner = buildLocalFallbackBanner(input);
      expect(banner).toContain("This turn ran on the bundled local model.");
      expect(banner).toContain("Local output can be less reliable");
    }
  });

  it("never asserts both that a provider is available and that it is switched off", () => {
    const banner = buildLocalFallbackBanner({
      excludedReasons: ["Status is 'disabled'"],
      offProviderNames: ["Claude"],
    });
    expect(banner).not.toContain("stayed available");
  });

  // An `unconfigured` endpoint can be excluded by status while a DIFFERENT
  // configured provider is active, so offProviderNames is empty. Describing it as
  // "stayed available, but it isn't switched on" would reintroduce exactly the
  // self-contradiction this module exists to remove.
  it("never says 'available, but not switched on' for an unconfigured endpoint", () => {
    const banner = buildLocalFallbackBanner({
      excludedReasons: ["Status is 'unconfigured'"],
      offProviderNames: [],
    });
    expect(banner).toContain("none was eligible for this request");
    expect(banner).not.toContain("isn't switched on");
  });

  it("still reports the real cause when an off endpoint sits alongside a named reason", () => {
    const banner = buildLocalFallbackBanner({
      excludedReasons: ["Status is 'unconfigured'", "Context window too small: 1 < 2"],
      offProviderNames: [],
    });
    expect(banner).toContain("longer than its context window");
    expect(banner).not.toContain("isn't switched on");
  });
});

// BI-706530B2. Sensitivity is recomputed over the whole payload every turn and
// history is resent every turn, so one triggering message restricts every later
// turn in that thread for as long as the thread lives. Observed live: a user
// typed "accounting, payroll, CRM, backup" while asking about SaaS spend, and
// the thread routed local-only from then on with nothing saying why.
describe("escalationCameOnlyFromHistory", () => {
  const at = (index: number) => ({ path: `messages[${index}].content` });

  it("is true when the only evidence is several turns back", () => {
    expect(escalationCameOnlyFromHistory([at(0), at(2)], 5)).toBe(true);
  });

  it("is false when the latest message is itself sensitive", () => {
    // Not "history" — a new thread would behave identically, so offering one
    // would be worse than saying nothing.
    expect(escalationCameOnlyFromHistory([at(0), at(4)], 5)).toBe(false);
  });

  it("is false with no evidence at all", () => {
    expect(escalationCameOnlyFromHistory([], 5)).toBe(false);
    expect(escalationCameOnlyFromHistory(undefined, 5)).toBe(false);
  });

  it("is false on a first turn, where there is no history to blame", () => {
    expect(escalationCameOnlyFromHistory([at(0)], 1)).toBe(false);
  });

  it("ignores prompt and non-message evidence", () => {
    // Prompt provenance is handled by BI-463BE12A; a new thread would carry the
    // same prompt, so it must not drive this hint.
    expect(escalationCameOnlyFromHistory(
      [{ path: "systemPrompt.instruction[0]" }, { path: "systemPrompt" }],
      5,
    )).toBe(false);
    expect(escalationCameOnlyFromHistory(
      [{ path: "systemPrompt" }, at(1)],
      5,
    )).toBe(true);
  });

  it("reads tool-call argument paths on an earlier message as history", () => {
    expect(escalationCameOnlyFromHistory(
      [{ path: "messages[1].toolCalls[0].arguments.discipline" }],
      4,
    )).toBe(true);
  });
});

describe("buildLocalFallbackBanner names the action that works", () => {
  const base = { excludedReasons: ["Sensitivity clearance missing for 'restricted'"], offProviderNames: [] };

  it("tells the owner a new conversation clears it", () => {
    const banner = buildLocalFallbackBanner({ ...base, historicalOnly: true });

    expect(banner).toMatch(/earlier in this conversation/);
    expect(banner).toMatch(/Starting a new conversation clears it/);
  });

  it("stays quiet when the current message is the cause", () => {
    const banner = buildLocalFallbackBanner({ ...base, historicalOnly: false });

    expect(banner).not.toMatch(/new conversation/);
  });

  it("is unchanged for the switched-off-provider case", () => {
    const banner = buildLocalFallbackBanner({
      excludedReasons: [],
      offProviderNames: ["Claude"],
      historicalOnly: true,
    });

    expect(banner).toMatch(/switched off/);
  });
});
