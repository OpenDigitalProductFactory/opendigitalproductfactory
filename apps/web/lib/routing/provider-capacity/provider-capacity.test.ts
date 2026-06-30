import { describe, expect, it } from "vitest";

import {
  classifyProviderCapacity,
  parseRetryAfterSeconds,
} from "./index";

const NOW = new Date("2026-06-29T20:00:00.000Z");

describe("provider capacity classification", () => {
  it("maps Z.ai 1113 to a human billing action instead of a retry", () => {
    const result = classifyProviderCapacity({
      providerId: "zai-coding",
      statusCode: 429,
      bodyText: JSON.stringify({
        error: {
          code: "1113",
          message: "Insufficient balance or no resource package. Please recharge.",
        },
      }),
      now: NOW,
    });

    expect(result).toMatchObject({
      state: "billing_action_required",
      action: "add_credits_or_plan",
      providerCode: "1113",
      confidence: "exact",
      isHumanActionRequired: true,
    });
    expect(result.retryAt).toBeUndefined();
    expect(result.safeSummary).toContain("credits");
  });

  it("maps Z.ai timed quota responses to an exact retry time", () => {
    const result = classifyProviderCapacity({
      providerId: "zai",
      statusCode: 429,
      bodyText: JSON.stringify({
        error: {
          code: "1316",
          message: "Quota will refresh later.",
          next_flush_time: "2026-06-29T21:15:00Z",
        },
      }),
      now: NOW,
    });

    expect(result).toMatchObject({
      state: "quota_resets_at",
      action: "retry_at",
      providerCode: "1316",
      confidence: "exact",
      isHumanActionRequired: false,
    });
    expect(result.retryAt?.toISOString()).toBe("2026-06-29T21:15:00.000Z");
  });

  it("parses Retry-After seconds from headers", () => {
    const result = classifyProviderCapacity({
      providerId: "openai",
      statusCode: 429,
      headers: { "retry-after": "120" },
      bodyText: "{}",
      now: NOW,
    });

    expect(result).toMatchObject({
      state: "rate_limited",
      action: "retry_at",
      retryAfterSeconds: 120,
      confidence: "header",
      isHumanActionRequired: false,
    });
    expect(result.retryAt?.toISOString()).toBe("2026-06-29T20:02:00.000Z");
  });

  it("parses epoch reset headers into retry seconds", () => {
    expect(parseRetryAfterSeconds({ "x-ratelimit-reset": "1782763260" }, NOW)).toBe(60);
  });

  it("uses bounded backoff for unknown 429 responses", () => {
    const result = classifyProviderCapacity({
      providerId: "unknown-ai",
      statusCode: 429,
      bodyText: "rate limit",
      now: NOW,
    });

    expect(result).toMatchObject({
      state: "rate_limited",
      action: "retry_with_backoff",
      confidence: "heuristic",
      isHumanActionRequired: false,
    });
    expect(result.retryAt).toBeUndefined();
  });
});
