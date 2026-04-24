import { afterEach, describe, expect, it } from "vitest";

import {
  getAdpRuntimeConfig,
  getHarnessRequestHeaders,
  isHarnessTransport,
} from "./runtime-config.js";

describe("runtime-config", () => {
  const originalApiBaseUrl = process.env.ADP_API_BASE_URL;
  const originalTokenEndpointUrl = process.env.ADP_TOKEN_ENDPOINT_URL;
  const originalSessionId = process.env.DPF_INTEGRATION_TEST_SESSION_ID;

  afterEach(() => {
    restore("ADP_API_BASE_URL", originalApiBaseUrl);
    restore("ADP_TOKEN_ENDPOINT_URL", originalTokenEndpointUrl);
    restore("DPF_INTEGRATION_TEST_SESSION_ID", originalSessionId);
  });

  it("uses the default ADP endpoints when no overrides are configured", () => {
    delete process.env.ADP_API_BASE_URL;
    delete process.env.ADP_TOKEN_ENDPOINT_URL;

    expect(getAdpRuntimeConfig("sandbox")).toEqual({
      apiBaseUrl: "https://api.sandbox.adp.com",
      tokenEndpointUrl: "https://accounts.sandbox.api.adp.com/auth/oauth/v2/token",
      harnessSessionId: null,
    });
  });

  it("uses configured override URLs and exposes the harness session id", () => {
    process.env.ADP_API_BASE_URL = "http://integration-test-harness:8700/adp-api";
    process.env.ADP_TOKEN_ENDPOINT_URL = "http://integration-test-harness:8700/adp-token";
    process.env.DPF_INTEGRATION_TEST_SESSION_ID = "test-run-42";

    expect(getAdpRuntimeConfig("production")).toEqual({
      apiBaseUrl: "http://integration-test-harness:8700/adp-api",
      tokenEndpointUrl: "http://integration-test-harness:8700/adp-token",
      harnessSessionId: "test-run-42",
    });
  });

  it("treats http override URLs as relaxed harness transport", () => {
    expect(isHarnessTransport("http://integration-test-harness:8700/adp-api")).toBe(true);
    expect(isHarnessTransport("https://api.adp.com")).toBe(false);
  });

  it("returns request headers only when a harness session id is configured", () => {
    delete process.env.DPF_INTEGRATION_TEST_SESSION_ID;
    expect(getHarnessRequestHeaders()).toEqual({});

    process.env.DPF_INTEGRATION_TEST_SESSION_ID = "session-abc";
    expect(getHarnessRequestHeaders()).toEqual({
      "X-DPF-Harness-Session": "session-abc",
    });
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
