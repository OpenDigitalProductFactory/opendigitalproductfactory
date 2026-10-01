// BI-8A562681 (S4, design §12.4.5): dynamic client registration is allowed on
// loopback and on the install's configured canonical origin, and refused on
// every other host. Registration still grants nothing without consent; this
// pins only who may register, which is the security boundary.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isDcrEnabled } from "./oauth-policy";

const ENV_KEYS = ["DPF_OAUTH_DCR", "PUBLIC_URL", "PUBLIC_URL_ALIASES"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("isDcrEnabled — loopback", () => {
  it.each([
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "https://localhost",
    "http://[::1]:3000",
  ])("allows %s with no canonical origin configured", (origin) => {
    expect(isDcrEnabled(origin)).toBe(true);
  });

  it("refuses a missing or malformed origin", () => {
    expect(isDcrEnabled(null)).toBe(false);
    expect(isDcrEnabled("not a url")).toBe(false);
  });
});

describe("isDcrEnabled — configured canonical origin", () => {
  it("allows the PUBLIC_URL origin", () => {
    process.env.PUBLIC_URL = "https://dpf.example.lan";
    expect(isDcrEnabled("https://dpf.example.lan")).toBe(true);
  });

  it("matches the origin case-insensitively and treats the default port as no port", () => {
    process.env.PUBLIC_URL = "https://DPF.example.lan/";
    expect(isDcrEnabled("https://dpf.example.lan:443")).toBe(true);
  });

  it("allows a host listed in PUBLIC_URL_ALIASES on the canonical scheme", () => {
    process.env.PUBLIC_URL = "https://dpf.example.lan";
    process.env.PUBLIC_URL_ALIASES = "dpf-alt.example.lan:8443, other.example.lan";
    expect(isDcrEnabled("https://dpf-alt.example.lan:8443")).toBe(true);
    expect(isDcrEnabled("https://other.example.lan")).toBe(true);
  });

  it("still allows loopback when a canonical origin is configured", () => {
    process.env.PUBLIC_URL = "https://dpf.example.lan";
    expect(isDcrEnabled("http://127.0.0.1:3000")).toBe(true);
  });
});

describe("isDcrEnabled — refused", () => {
  it("refuses a non-loopback origin when no canonical origin is configured", () => {
    expect(isDcrEnabled("https://dpf.example.lan")).toBe(false);
  });

  it("refuses an origin that is not the configured canonical origin", () => {
    process.env.PUBLIC_URL = "https://dpf.example.lan";
    expect(isDcrEnabled("https://evil.example.com")).toBe(false);
  });

  it("refuses the canonical host on a different port", () => {
    process.env.PUBLIC_URL = "https://dpf.example.lan";
    expect(isDcrEnabled("https://dpf.example.lan:8443")).toBe(false);
  });

  it("refuses the canonical host on a different scheme", () => {
    process.env.PUBLIC_URL = "https://dpf.example.lan";
    expect(isDcrEnabled("http://dpf.example.lan")).toBe(false);
  });

  it("refuses a canonical origin configured over plain http (OAuth 2.1: https except loopback)", () => {
    process.env.PUBLIC_URL = "http://dpf.example.lan";
    expect(isDcrEnabled("http://dpf.example.lan")).toBe(false);
  });

  it("refuses a host that is only a suffix or prefix of the canonical host", () => {
    process.env.PUBLIC_URL = "https://dpf.example.lan";
    expect(isDcrEnabled("https://dpf.example.lan.evil.com")).toBe(false);
    expect(isDcrEnabled("https://evildpf.example.lan")).toBe(false);
  });

  it("refuses an alias host on a scheme other than the canonical one", () => {
    process.env.PUBLIC_URL = "https://dpf.example.lan";
    process.env.PUBLIC_URL_ALIASES = "dpf-alt.example.lan";
    expect(isDcrEnabled("http://dpf-alt.example.lan")).toBe(false);
  });

  it("ignores a malformed PUBLIC_URL instead of widening", () => {
    process.env.PUBLIC_URL = "::not a url::";
    expect(isDcrEnabled("https://dpf.example.lan")).toBe(false);
  });
});

describe("isDcrEnabled — operator override", () => {
  it("DPF_OAUTH_DCR=0 refuses even loopback and the canonical origin", () => {
    process.env.DPF_OAUTH_DCR = "0";
    process.env.PUBLIC_URL = "https://dpf.example.lan";
    expect(isDcrEnabled("http://127.0.0.1:3000")).toBe(false);
    expect(isDcrEnabled("https://dpf.example.lan")).toBe(false);
  });

  it("DPF_OAUTH_DCR=1 allows regardless of origin", () => {
    process.env.DPF_OAUTH_DCR = "1";
    expect(isDcrEnabled("https://anything.example.com")).toBe(true);
  });
});
