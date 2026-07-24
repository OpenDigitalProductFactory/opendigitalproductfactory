import { describe, expect, it } from "vitest";
import { sanitizeStorefrontReturnTo } from "./return-to";

describe("sanitizeStorefrontReturnTo", () => {
  it("accepts a path scoped to the storefront's own booking/inquiry/order route", () => {
    expect(sanitizeStorefrontReturnTo("/s/bistro/book/itm-42", "bistro")).toBe(
      "/s/bistro/book/itm-42",
    );
    expect(sanitizeStorefrontReturnTo("/s/bistro", "bistro")).toBe("/s/bistro");
  });

  it("rejects absent input", () => {
    expect(sanitizeStorefrontReturnTo(undefined, "bistro")).toBeNull();
    expect(sanitizeStorefrontReturnTo(null, "bistro")).toBeNull();
    expect(sanitizeStorefrontReturnTo("/s/bistro/book/itm-42", undefined)).toBeNull();
  });

  it("rejects an absolute URL (open-redirect vector)", () => {
    expect(sanitizeStorefrontReturnTo("https://evil.example/phish", "bistro")).toBeNull();
    expect(sanitizeStorefrontReturnTo("http://evil.example", "bistro")).toBeNull();
  });

  it("rejects a protocol-relative URL", () => {
    expect(sanitizeStorefrontReturnTo("//evil.example", "bistro")).toBeNull();
  });

  it("rejects a backslash-based scheme trick", () => {
    expect(sanitizeStorefrontReturnTo("/\\evil.example", "bistro")).toBeNull();
  });

  it("rejects an encoded protocol-relative trick", () => {
    expect(sanitizeStorefrontReturnTo("/%2F%2Fevil.example", "bistro")).toBeNull();
  });

  it("rejects a path outside this storefront's own scope", () => {
    expect(sanitizeStorefrontReturnTo("/s/other-org/book/itm-1", "bistro")).toBeNull();
    expect(sanitizeStorefrontReturnTo("/portal", "bistro")).toBeNull();
    expect(sanitizeStorefrontReturnTo("/workspace/settings", "bistro")).toBeNull();
  });

  it("rejects the auth pages themselves to avoid a redirect loop", () => {
    expect(sanitizeStorefrontReturnTo("/s/bistro/sign-in", "bistro")).toBeNull();
    expect(sanitizeStorefrontReturnTo("/s/bistro/sign-up", "bistro")).toBeNull();
    expect(sanitizeStorefrontReturnTo("/s/bistro/sign-in?returnTo=x", "bistro")).toBeNull();
  });
});
