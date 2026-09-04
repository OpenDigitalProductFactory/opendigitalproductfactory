import { describe, expect, it } from "vitest";

import {
  bucketExclusionReason,
  dominantExclusion,
  explainExclusion,
  stripEndpointPrefix,
} from "./routing-exclusion-buckets";

// The reason strings below are the verbatim shapes emitted by
// getExclusionReasonV2 (apps/web/lib/routing/pipeline-v2.ts), prefixed with the
// endpoint id exactly as the no-eligible-endpoints branch assembles them. If a
// reason string changes there, these tests are the tripwire.
const ALLOWLIST = "cmq5kqdvu09k55nr0kxu59ohi: Provider 'anthropic-sub' is outside the request allowlist";
const CLEARANCE = "cmrxuec5u016q65m9k5x85ehm: Sensitivity clearance missing for 'restricted'";
const QUALITY = "cmq5wx4hc000b01np38fifi5b: Minimum quality dimensions not met";
const CAPABILITY = "cmq5kqdu909k15nr0jtk38wcl: Agent requires capability 'toolUse' (EP-AGENT-CAP-002)";
const CONTEXT = "cmq5kqdu409jy5nr0akjo4au1: Context window too small: 8192 < 32000";
const STATUS = "cmq5kqdu209jw5nr0o5hhupmw: Status is 'unconfigured'";
const MODEL_CLASS =
  'cmq5kqdvo09k35nr0xixftj36: modelClass "embedding" is not eligible for general-purpose text tasks';

describe("stripEndpointPrefix", () => {
  it("removes the endpoint id prefix", () => {
    expect(stripEndpointPrefix(QUALITY)).toBe("Minimum quality dimensions not met");
  });

  it("leaves a reason with no id prefix untouched", () => {
    expect(stripEndpointPrefix("Minimum quality dimensions not met")).toBe(
      "Minimum quality dimensions not met",
    );
  });

  it("does not truncate a reason whose own text contains a colon", () => {
    // "Context window too small: 8192 < 32000" must keep its numbers after the
    // id is stripped — the head before the FIRST ": " is the id, but the
    // remainder itself contains ": " and must survive.
    expect(stripEndpointPrefix(CONTEXT)).toBe("Context window too small: 8192 < 32000");
  });
});

describe("bucketExclusionReason", () => {
  it("recognises ChatGPT account/model incompatibility", () => {
    expect(bucketExclusionReason(
      "ep-codex: Model 'gpt-5.3-codex' is not supported when Codex uses a ChatGPT account",
    )).toBe("account-model-eligibility");
  });
  it.each([
    [ALLOWLIST, "connection-excluded"],
    [CLEARANCE, "sensitivity-clearance"],
    [QUALITY, "quality-floor"],
    [CAPABILITY, "capability-floor"],
    [CONTEXT, "context-window"],
    [STATUS, "endpoint-status"],
    [MODEL_CLASS, "model-class"],
  ] as const)("classifies %s", (reason, expected) => {
    expect(bucketExclusionReason(reason)).toBe(expected);
  });

  it("classifies a denylist exclusion alongside the allowlist one", () => {
    expect(
      bucketExclusionReason("abc: Provider 'zai' is excluded by the request denylist"),
    ).toBe("connection-excluded");
  });

  it("returns 'other' for an unrecognised reason rather than guessing", () => {
    // A new exclusion reason must NOT be absorbed into a neighbouring bucket —
    // that would render a remediation the operator cannot act on.
    expect(bucketExclusionReason("abc: Some future exclusion nobody has seen")).toBe("other");
  });
});

describe("dominantExclusion", () => {
  it("returns null for no exclusions — 'nothing excluded' is not a cause", () => {
    expect(dominantExclusion([])).toBeNull();
  });

  it("names the most common bucket and reports the total", () => {
    const result = dominantExclusion([ALLOWLIST, ALLOWLIST, ALLOWLIST, QUALITY]);
    expect(result).not.toBeNull();
    expect(result!.bucket).toBe("connection-excluded");
    expect(result!.count).toBe(3);
    expect(result!.total).toBe(4);
  });

  it("reproduces the live finance-coworker failure: clearance dominates", () => {
    // Observed on the live install for sensitivity=restricted, residency=local_only:
    // 22 clearance, 8 quality, 4 capability.
    const reasons = [
      ...Array.from({ length: 22 }, () => CLEARANCE),
      ...Array.from({ length: 8 }, () => QUALITY),
      ...Array.from({ length: 4 }, () => CAPABILITY),
    ];
    const result = dominantExclusion(reasons)!;
    expect(result.bucket).toBe("sensitivity-clearance");
    expect(result.count).toBe(22);
    expect(result.total).toBe(34);
    expect(result.breakdown.map((b) => b.bucket)).toEqual([
      "sensitivity-clearance",
      "quality-floor",
      "capability-floor",
    ]);
  });

  it("reproduces the live build-phase failure: a disabled connection dominates", () => {
    // Observed pre-fix: 10 anthropic-sub + 2 codex allowlist exclusions, 3 quality.
    const reasons = [
      ...Array.from({ length: 12 }, () => ALLOWLIST),
      ...Array.from({ length: 3 }, () => QUALITY),
    ];
    const result = dominantExclusion(reasons)!;
    expect(result.bucket).toBe("connection-excluded");
    expect(result.count).toBe(12);
  });

  it("breaks a tie toward the more actionable cause", () => {
    // Equal counts: a switched-off connection is a more actionable statement
    // than "quality floor", so it must win rather than depending on input order.
    const fromQualityFirst = dominantExclusion([QUALITY, ALLOWLIST])!;
    const fromAllowlistFirst = dominantExclusion([ALLOWLIST, QUALITY])!;
    expect(fromQualityFirst.bucket).toBe("connection-excluded");
    expect(fromAllowlistFirst.bucket).toBe("connection-excluded");
  });

  it("carries a verbatim sample reason for technical disclosure", () => {
    const result = dominantExclusion([CLEARANCE])!;
    expect(result.sampleReason).toBe("Sensitivity clearance missing for 'restricted'");
  });
});

describe("explainExclusion", () => {
  it("never tells the operator to activate a provider for a disabled connection", () => {
    // The whole point: "Activate a provider…" is the hardcoded guess this
    // module replaces. On the live install it sent an owner to a page where
    // every provider already read "active".
    const explanation = explainExclusion(dominantExclusion([ALLOWLIST, ALLOWLIST])!);
    expect(explanation.remediation.toLowerCase()).not.toContain("activate a provider");
    expect(explanation.remediation.toLowerCase()).toContain("connection");
  });

  it("names the data class when explaining a clearance block", () => {
    const explanation = explainExclusion(dominantExclusion([CLEARANCE])!, {
      sensitivity: "restricted",
    });
    expect(explanation.message).toContain('"restricted"');
  });

  it("flags widening clearance as a deliberate off-machine decision", () => {
    const explanation = explainExclusion(dominantExclusion([CLEARANCE])!, {
      sensitivity: "restricted",
    });
    expect(explanation.remediation).toMatch(/off your machine/i);
  });

  it("points a quality-floor block at measurement before capability", () => {
    // An unprofiled model carries placeholder scores; telling the owner to buy a
    // better model when the current one was never measured is the wrong advice.
    const explanation = explainExclusion(dominantExclusion([QUALITY])!);
    expect(explanation.remediation).toMatch(/measured|unprofiled|endpoint tests/i);
  });

  it("surfaces the verbatim reason when the bucket is unrecognised", () => {
    const explanation = explainExclusion(dominantExclusion(["abc: Brand new reason"])!);
    expect(explanation.remediation).toContain("Brand new reason");
  });

  it("gives every bucket a destination or an explicit null", () => {
    for (const reason of [ALLOWLIST, CLEARANCE, QUALITY, CAPABILITY, CONTEXT, STATUS, MODEL_CLASS]) {
      const explanation = explainExclusion(dominantExclusion([reason])!);
      expect(explanation.href === null || explanation.href.startsWith("/")).toBe(true);
      expect(explanation.message.length).toBeGreaterThan(0);
      expect(explanation.remediation.length).toBeGreaterThan(0);
    }
  });
});
