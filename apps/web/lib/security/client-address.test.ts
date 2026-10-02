import { describe, expect, it } from "vitest";

import { clientAddressKey } from "./client-address";

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

describe("clientAddressKey", () => {
  it("uses the entry the nearest proxy appended, not the client-supplied leftmost one", () => {
    expect(clientAddressKey(headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("a client rotating its own X-Forwarded-For prefix keeps the same key behind a proxy", () => {
    const a = clientAddressKey(headers({ "x-forwarded-for": "1.1.1.1, 203.0.113.7" }));
    const b = clientAddressKey(headers({ "x-forwarded-for": "2.2.2.2, 203.0.113.7" }));
    expect(a).toBe(b);
  });

  it("uses a single entry as-is and ignores empty entries", () => {
    expect(clientAddressKey(headers({ "x-forwarded-for": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientAddressKey(headers({ "x-forwarded-for": "198.51.100.4, " }))).toBe("198.51.100.4");
  });

  it("falls back to X-Real-IP, then to unknown", () => {
    expect(clientAddressKey(headers({ "x-real-ip": " 192.0.2.9 " }))).toBe("192.0.2.9");
    expect(clientAddressKey(headers({}))).toBe("unknown");
  });

  it("caps the key length", () => {
    const long = "a".repeat(200);
    expect(clientAddressKey(headers({ "x-forwarded-for": long }))).toHaveLength(80);
  });
});
