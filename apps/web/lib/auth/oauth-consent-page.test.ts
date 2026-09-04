import { describe, it, expect } from "vitest";

import { renderConsentPage, renderConsentRefusal, htmlResponse } from "./oauth-consent-page";
import type { PublicScope } from "./oauth-scope-map";

const base = {
  clientName: "Claude Code",
  selfAsserted: false,
  installationName: "Second Chance Animal Rescue",
  actingUser: "owner@example.com",
  scopes: ["dpf.read", "dpf.work"] as PublicScope[],
  resource: "http://127.0.0.1:3000/api/mcp/v1",
  redirectUri: "http://127.0.0.1:49152/callback",
  hiddenParams: [["client_id", "abc"]] as Array<[string, string]>,
};

describe("consent rendering", () => {
  it("names the client, the installation and the acting human", () => {
    const html = renderConsentPage(base);
    expect(html).toContain("Claude Code");
    expect(html).toContain("Second Chance Animal Rescue");
    expect(html).toContain("owner@example.com");
  });

  it("renders one pre-ticked checkbox per requested scope, with plain-language copy", () => {
    const html = renderConsentPage(base);
    expect(html).toContain('value="dpf.read" checked');
    expect(html).toContain('value="dpf.work" checked');
    expect(html).toContain("Read your platform");
    expect(html).toContain("Do governed work");
    // The internal grant vocabulary must never reach a consent screen.
    expect(html).not.toContain("registry_read");
    expect(html).not.toContain("backlog_write");
  });

  it("shows the resource and redirect so the human can see where this goes", () => {
    const html = renderConsentPage(base);
    expect(html).toContain("http://127.0.0.1:3000/api/mcp/v1");
    expect(html).toContain("http://127.0.0.1:49152/callback");
  });

  it("marks a self-registered client as self-asserted, and does not otherwise", () => {
    expect(renderConsentPage({ ...base, selfAsserted: true })).toContain("registered itself");
    expect(renderConsentPage(base)).not.toContain("registered itself");
  });

  it("echoes hidden params so the POST re-derives the same request", () => {
    expect(renderConsentPage(base)).toContain('name="client_id" value="abc"');
  });

  it("ESCAPES a hostile client name — a DCR client picks its own", () => {
    const html = renderConsentPage({
      ...base,
      clientName: '<script>alert(1)</script>"onerror="x',
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    // The attribute-breaking quote must not survive either.
    expect(html).not.toContain('"onerror="x');
  });

  it("escapes hostile redirect and resource values", () => {
    const html = renderConsentPage({
      ...base,
      redirectUri: 'http://127.0.0.1/cb"><img src=x onerror=alert(1)>',
    });
    expect(html).not.toContain("<img src=x");
  });

  it("escapes a hostile hidden param name and value", () => {
    const html = renderConsentPage({
      ...base,
      hiddenParams: [['x" onfocus="evil', '"><script>bad()</script>']],
    });
    expect(html).not.toContain("<script>bad()</script>");
    expect(html).not.toContain('onfocus="evil');
  });

  it("renders a refusal with no form and no granted permission", () => {
    const html = renderConsentRefusal("Not valid", "Because reasons.");
    expect(html).toContain("Not valid");
    expect(html).toContain("Because reasons.");
    expect(html).not.toContain("<form");
    expect(html).toContain("no permission was granted");
  });

  it("is theme-aware without loading external CSS or inventing a palette", () => {
    const html = renderConsentPage(base);
    // System colors + color-scheme: the browser supplies the user's real
    // light/dark values, so this cannot drift from the platform palette
    // because it never duplicates it.
    expect(html).toContain("color-scheme:light dark");
    expect(html).toContain("CanvasText");
    expect(html).not.toContain("<link");
    expect(html).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});

describe("consent response headers", () => {
  it("refuses caching and framing", async () => {
    const res = htmlResponse(renderConsentPage(base));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  it("carries the requested status", () => {
    expect(htmlResponse(renderConsentRefusal("a", "b"), 400).status).toBe(400);
  });
});
