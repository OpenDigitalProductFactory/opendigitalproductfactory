import type { AdpEnvironment } from "./token-client.js";

export interface AdpRuntimeConfig {
  apiBaseUrl: string;
  tokenEndpointUrl: string;
  harnessSessionId: string | null;
}

export function getAdpRuntimeConfig(environment: AdpEnvironment): AdpRuntimeConfig {
  return {
    apiBaseUrl: process.env.ADP_API_BASE_URL?.trim() || getDefaultApiBaseUrl(environment),
    tokenEndpointUrl:
      process.env.ADP_TOKEN_ENDPOINT_URL?.trim() || getDefaultTokenEndpointUrl(environment),
    harnessSessionId: process.env.DPF_INTEGRATION_TEST_SESSION_ID?.trim() || null,
  };
}

export function getHarnessRequestHeaders(sessionId = process.env.DPF_INTEGRATION_TEST_SESSION_ID): Record<string, string> {
  const normalized = sessionId?.trim();
  if (!normalized) return {};

  return {
    "X-DPF-Harness-Session": normalized,
  };
}

export function isHarnessTransport(url: string): boolean {
  return url.startsWith("http://");
}

function getDefaultApiBaseUrl(environment: AdpEnvironment): string {
  return environment === "production" ? "https://api.adp.com" : "https://api.sandbox.adp.com";
}

function getDefaultTokenEndpointUrl(environment: AdpEnvironment): string {
  if (environment === "production") return "https://accounts.api.adp.com/auth/oauth/v2/token";
  return "https://accounts.sandbox.api.adp.com/auth/oauth/v2/token";
}
