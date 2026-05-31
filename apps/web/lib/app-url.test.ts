import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAppBaseUrl } from "./app-url";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveAppBaseUrl", () => {
  it("prefers NEXT_PUBLIC_BASE_URL and strips trailing slashes", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://app.example.com/");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://other.example.com");
    expect(resolveAppBaseUrl()).toBe("https://app.example.com");
  });

  it("falls back to NEXT_PUBLIC_APP_URL when base url unset", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://portal.example.com");
    expect(resolveAppBaseUrl()).toBe("https://portal.example.com");
  });

  it("uses localhost outside production when nothing is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(resolveAppBaseUrl()).toBe("http://localhost:3000");
  });

  it("returns null in production when nothing is configured (no broken localhost link)", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(resolveAppBaseUrl()).toBeNull();
  });
});
