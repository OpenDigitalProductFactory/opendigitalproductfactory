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

  it("lifts resets_in_seconds from a usage-limit body into an exact retry time", () => {
    const result = classifyProviderCapacity({
      providerId: "chatgpt",
      statusCode: 429,
      bodyText: JSON.stringify({
        error: {
          type: "usage_limit_reached",
          message: "The usage limit has been reached",
          resets_at: Math.floor(NOW.getTime() / 1000) + 515_899,
          resets_in_seconds: 515_899,
        },
      }),
      now: NOW,
    });

    expect(result).toMatchObject({
      state: "rate_limited",
      action: "retry_at",
      retryAfterSeconds: 515_899,
      confidence: "exact",
      isHumanActionRequired: false,
    });
    expect(result.retryAt?.getTime()).toBe(NOW.getTime() + 515_899_000);
  });

  it("lifts an epoch resets_at when resets_in_seconds is absent", () => {
    const resetsAt = Math.floor(NOW.getTime() / 1000) + 3600;
    const result = classifyProviderCapacity({
      providerId: "chatgpt",
      statusCode: 429,
      bodyText: JSON.stringify({ error: { type: "usage_limit_reached", resets_at: resetsAt } }),
      now: NOW,
    });
    expect(result.action).toBe("retry_at");
    expect(result.retryAt?.getTime()).toBe(resetsAt * 1000);
  });

  it("maps an Anthropic usage-limit 400 to a quota that resets at the stated time", () => {
    // Live body (2026-10-27): every Anthropic call failed this way for 10 days while
    // it was classified "unknown", so routing kept choosing the provider.
    const result = classifyProviderCapacity({
      providerId: "anthropic",
      statusCode: 400,
      bodyText: JSON.stringify({
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.",
        },
      }),
      now: NOW,
    });

    expect(result).toMatchObject({
      state: "quota_resets_at",
      action: "retry_at",
      confidence: "exact",
      isHumanActionRequired: false,
    });
    expect(result.retryAt?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(result.retryAfterSeconds).toBe(Math.ceil((Date.parse("2026-11-01T00:00:00.000Z") - NOW.getTime()) / 1000));
    expect(result.safeSummary).toContain("usage limit");
  });

  it("keeps an Anthropic usage-limit 400 without a parseable reset time as a quota hold", () => {
    const result = classifyProviderCapacity({
      providerId: "anthropic",
      statusCode: 400,
      bodyText: JSON.stringify({
        type: "error",
        error: { type: "invalid_request_error", message: "You have reached your specified API usage limits." },
      }),
      now: NOW,
    });

    expect(result.state).toBe("rate_limited");
    expect(result.retryAt).toBeUndefined();
  });

  it("leaves an ordinary Anthropic invalid_request_error unclassified", () => {
    const result = classifyProviderCapacity({
      providerId: "anthropic",
      statusCode: 400,
      bodyText: JSON.stringify({
        type: "error",
        error: { type: "invalid_request_error", message: "messages: text content blocks must be non-empty" },
      }),
      now: NOW,
    });

    expect(result.state).toBe("unknown");
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
