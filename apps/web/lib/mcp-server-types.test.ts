import { describe, expect, it } from "vitest";
import {
  type McpConnectionConfig,
  type HealthCheckResult,
  redactConfig,
  validateConnectionConfig,
} from "./mcp-server-types";

describe("validateConnectionConfig", () => {
  it("accepts valid stdio config", () => {
    const config: McpConnectionConfig = { transport: "stdio", command: "npx", args: ["-y", "stripe-mcp"] };
    expect(validateConnectionConfig(config)).toEqual({ valid: true });
  });

  it("accepts valid sse config", () => {
    const config: McpConnectionConfig = { transport: "sse", url: "https://mcp.stripe.com/sse" };
    expect(validateConnectionConfig(config)).toEqual({ valid: true });
  });

  it("accepts valid http config", () => {
    const config: McpConnectionConfig = { transport: "http", url: "https://mcp.stripe.com/v1" };
    expect(validateConnectionConfig(config)).toEqual({ valid: true });
  });

  it("rejects stdio config without command", () => {
    const config = { transport: "stdio" } as McpConnectionConfig;
    expect(validateConnectionConfig(config)).toEqual({ valid: false, error: expect.stringContaining("command") });
  });

  it("rejects sse/http config without url", () => {
    const config = { transport: "sse" } as McpConnectionConfig;
    expect(validateConnectionConfig(config)).toEqual({ valid: false, error: expect.stringContaining("url") });
  });

  it("rejects unknown transport", () => {
    const config = { transport: "grpc" } as unknown as McpConnectionConfig;
    expect(validateConnectionConfig(config)).toEqual({ valid: false, error: expect.stringContaining("transport") });
  });
});

describe("redactConfig", () => {
  it("redacts sensitive header values", () => {
    const config = {
      transport: "http" as const,
      url: "https://api.stripe.com",
      headers: { Authorization: "Bearer sk_live_xxx", "Content-Type": "application/json" },
    };
    const redacted = redactConfig(config);
    expect(redacted.url).toBe("https://api.stripe.com");
    expect(redacted.headers?.Authorization).toBe("***");
    expect(redacted.headers?.["Content-Type"]).toBe("application/json");
  });

  it("redacts sensitive env values", () => {
    const config = {
      transport: "stdio" as const,
      command: "npx",
      args: ["-y", "stripe-mcp"],
      env: { STRIPE_API_KEY: "sk_live_xxx", NODE_ENV: "production" },
    };
    const redacted = redactConfig(config);
    expect(redacted.command).toBe("npx");
    expect(redacted.env?.STRIPE_API_KEY).toBe("***");
    expect(redacted.env?.NODE_ENV).toBe("production");
  });

  it("returns config unchanged when no sensitive fields", () => {
    const config = { transport: "http" as const, url: "https://example.com" };
    expect(redactConfig(config)).toEqual(config);
  });
});
