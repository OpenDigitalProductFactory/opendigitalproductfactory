import { describe, it, expect } from "vitest";
import {
  normalizeUtmValue,
  applyUtm,
  buildTrackedLinks,
} from "./utm";

describe("normalizeUtmValue", () => {
  it("lowercases and joins spaces with underscores", () => {
    expect(normalizeUtmValue("Summer Push")).toBe("summer_push");
  });

  it("collapses runs of disallowed characters to a single underscore", () => {
    expect(normalizeUtmValue("Q3 — owner/operators!!")).toBe("q3_owner_operators");
  });

  it("preserves hyphens and dots", () => {
    expect(normalizeUtmValue("linkedin-personal.social")).toBe("linkedin-personal.social");
  });

  it("trims leading and trailing separators", () => {
    expect(normalizeUtmValue("  _hello_  ")).toBe("hello");
  });

  it("returns empty string for all-symbol input", () => {
    expect(normalizeUtmValue("!!!")).toBe("");
  });
});

describe("applyUtm", () => {
  it("appends normalized utm params to a bare URL", () => {
    const url = applyUtm("https://example.com/offer", {
      source: "LinkedIn",
      medium: "Social",
      campaign: "Summer Push",
    });
    expect(url).toBe(
      "https://example.com/offer?utm_source=linkedin&utm_medium=social&utm_campaign=summer_push",
    );
  });

  it("preserves an existing query string", () => {
    const url = applyUtm("https://example.com/offer?ref=abc", {
      source: "newsletter",
      medium: "email",
      campaign: "launch",
    });
    expect(url).toContain("ref=abc");
    expect(url).toContain("utm_source=newsletter");
  });

  it("preserves the hash fragment and keeps utm before it", () => {
    const url = applyUtm("https://example.com/p#section", {
      source: "x",
      medium: "social",
      campaign: "c",
    });
    expect(url).toBe(
      "https://example.com/p?utm_source=x&utm_medium=social&utm_campaign=c#section",
    );
  });

  it("overwrites existing utm params (idempotent re-tagging)", () => {
    const once = applyUtm("https://example.com", {
      source: "linkedin",
      medium: "social",
      campaign: "v1",
    })!;
    const twice = applyUtm(once, {
      source: "linkedin",
      medium: "social",
      campaign: "v2",
    })!;
    expect(twice).toContain("utm_campaign=v2");
    expect(twice).not.toContain("v1");
    // No duplicate utm_campaign keys.
    expect(twice.match(/utm_campaign=/g)?.length).toBe(1);
  });

  it("includes optional term and content when provided", () => {
    const url = applyUtm("https://example.com", {
      source: "google",
      medium: "cpc",
      campaign: "brand",
      term: "Digital Factory",
      content: "Post A",
    })!;
    expect(url).toContain("utm_term=digital_factory");
    expect(url).toContain("utm_content=post_a");
  });

  it("returns null for a non-http(s) URL", () => {
    expect(applyUtm("ftp://example.com", { source: "s", medium: "m", campaign: "c" })).toBeNull();
    expect(applyUtm("javascript:alert(1)", { source: "s", medium: "m", campaign: "c" })).toBeNull();
    expect(applyUtm("not a url", { source: "s", medium: "m", campaign: "c" })).toBeNull();
  });
});

describe("buildTrackedLinks", () => {
  it("tags a single baseUrl", () => {
    const result = buildTrackedLinks({
      baseUrl: "https://example.com/book",
      source: "linkedin",
      medium: "social",
      campaign: "owner_operators",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.links).toHaveLength(1);
    expect(result.links[0].trackedUrl).toContain("utm_campaign=owner_operators");
    expect(result.links[0].sourceUrl).toBe("https://example.com/book");
  });

  it("tags multiple links each with its own content", () => {
    const result = buildTrackedLinks({
      links: [
        { url: "https://example.com/a", content: "post_a" },
        { url: "https://example.com/b", content: "post_b" },
      ],
      source: "linkedin",
      medium: "social",
      campaign: "c",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.links).toHaveLength(2);
    expect(result.links[0].trackedUrl).toContain("utm_content=post_a");
    expect(result.links[1].trackedUrl).toContain("utm_content=post_b");
  });

  it("falls back to the default content for links that omit their own", () => {
    const result = buildTrackedLinks({
      links: [{ url: "https://example.com/a" }],
      source: "s",
      medium: "m",
      campaign: "c",
      content: "footer_cta",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.links[0].trackedUrl).toContain("utm_content=footer_cta");
  });

  it("fails when required UTM fields are missing", () => {
    const result = buildTrackedLinks({
      baseUrl: "https://example.com",
      source: "",
      medium: "social",
      campaign: "",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("missing-required-params");
    expect(result.message).toContain("source");
    expect(result.message).toContain("campaign");
  });

  it("fails when neither baseUrl nor links is provided", () => {
    const result = buildTrackedLinks({ source: "s", medium: "m", campaign: "c" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("no-target-url");
  });

  it("skips invalid URLs but returns the valid ones", () => {
    const result = buildTrackedLinks({
      links: [
        { url: "https://good.com" },
        { url: "ftp://bad.com" },
      ],
      source: "s",
      medium: "m",
      campaign: "c",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.links).toHaveLength(1);
    expect(result.links[0].sourceUrl).toBe("https://good.com");
    expect(result.message).toContain("Skipped 1 invalid");
  });

  it("fails when all URLs are invalid", () => {
    const result = buildTrackedLinks({
      links: [{ url: "not-a-url" }],
      source: "s",
      medium: "m",
      campaign: "c",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("no-valid-urls");
  });
});
