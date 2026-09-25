import { describe, it, expect } from "vitest";

import { renderConsentPage, renderConsentRefusal, htmlResponse } from "./oauth-consent-page";
import type { PublicScope } from "./oauth-scope-map";

const assistant = {
  kind: "resolved" as const,
  selected: { agentId: "AGT-EXT-CLAUDE", displayName: "Claude Code (external CLI)" },
  candidates: [
    { agentId: "AGT-EXT-CLAUDE", displayName: "Claude Code (external CLI)" },
    { agentId: "AGT-EXT-CODEX", displayName: "Codex (external CLI)" },
  ],
};

const base = {
  assistant,
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
  it("lets a person cancel without selecting an assistant", () => {
    expect(renderConsentPage(base)).toContain('name="decision" value="deny" formnovalidate');
  });
  it("does not echo a client-supplied coworker or default as a hidden identity", () => {
    const html = renderConsentPage({ ...base, hiddenParams: [["acting_coworker", "impersonated"], ["default_coworker", "forged"]],
      assistant: { ...assistant, candidates: [{ agentId: "AGT-EXT-CODEX", displayName: '<img src=x onerror="evil">' }] } });
    expect(html).not.toContain("impersonated");
    expect(html).not.toContain('value="forged"');
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("does not verify the app's name or grant access to a workroom");
  });

  // BI-05E0EA33: one Connect action, no role decision in the default flow.
  it("states the resolved assistant as a consequence and offers Change as a closed disclosure", () => {
    const html = renderConsentPage(base);
    expect(html).toContain('It will work as <strong class="who default" data-agent="AGT-EXT-CLAUDE">Claude Code (external CLI)</strong>');
    expect(html).toMatch(/<details[^>]*>\s*<summary>Change<\/summary>/);
    expect(html).not.toMatch(/<details[^>]*open[^>]*>\s*<summary>Change/);
    expect(html).toContain('name="default_coworker" value="AGT-EXT-CLAUDE"');
    expect(html).toMatch(/<option value="AGT-EXT-CLAUDE" selected>/);
    expect(html).not.toContain("Choose the assistant you authorize");
  });
  it("keeps the consequence line naming whichever assistant is picked under Change", () => {
    // Live finding 2026-09-25: the line kept naming the default while the
    // picker showed another assistant. The page has no script; CSS follows the
    // selected option.
    const html = renderConsentPage(base);
    expect(html).toContain('<strong class="who" data-agent="AGT-EXT-CODEX">Codex (external CLI)</strong>');
    expect(html).toContain('form:has(select[name="acting_coworker"] option[value="AGT-EXT-CODEX"]:checked) .who[data-agent="AGT-EXT-CODEX"]{display:inline}');
    expect(html).toContain('option:checked:not([value="AGT-EXT-CLAUDE"])) .who.default{display:none}');
  });
  it("leaves an agent id that is not a plain token out of the stylesheet", () => {
    const html = renderConsentPage({ ...base, assistant: { ...assistant,
      candidates: [...assistant.candidates, { agentId: 'X"]{} body{display:none', displayName: "Odd" }] } });
    const style = html.match(/<style>\.who\{[^<]*<\/style>/)?.[0] ?? "";
    expect(style).toContain("AGT-EXT-CODEX");
    expect(style).not.toContain("body{display:none");
  });
  it("renders one primary Connect button named for the client and no Approve button", () => {
    const html = renderConsentPage(base);
    expect(html).toContain('value="approve">Connect Claude Code</button>');
    expect(html).not.toContain(">Approve<");
  });
  it("binds a single eligible assistant as a hidden field with no disclosure", () => {
    const html = renderConsentPage({ ...base, assistant: { kind: "single", selected: assistant.selected, candidates: [assistant.selected] } });
    expect(html).toContain('type="hidden" name="acting_coworker" value="AGT-EXT-CLAUDE"');
    expect(html).not.toContain("<summary>Change</summary>");
  });
  it("asks for an explicit choice, least authority first, when candidates differ in authority", () => {
    const html = renderConsentPage({ ...base, assistant: { kind: "choice", selected: assistant.candidates[0],
      candidates: [{ ...assistant.candidates[0], detail: "13 permissions" }, { ...assistant.candidates[1], detail: "14 permissions" }] } });
    expect(html).toContain("differ in what they can do");
    expect(html.indexOf("13 permissions")).toBeLessThan(html.indexOf("14 permissions"));
    // Nothing is chosen for the person: a required select behind an empty placeholder, no default field.
    expect(html).toMatch(/<select name="acting_coworker"[^>]*required[^>]*><option value="" selected disabled>/);
    expect(html).not.toMatch(/<option value="AGT-[^"]*" selected>/);
    expect(html).not.toContain('name="default_coworker"');
  });
  it("gives Enter nothing to submit: the form's first submit button is disabled", () => {
    const html = renderConsentPage(base);
    const form = html.slice(html.indexOf("<form"));
    const firstSubmit = form.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? "";
    expect(firstSubmit).toContain("disabled");
    expect(form).toContain('name="decision" value="approve"');
  });
  it("says why nothing was connected when Connect came without a choice", () => {
    const html = renderConsentPage({ ...base, choiceNotice: true });
    expect(html).toContain("Choose which assistant this connection works as. Nothing was connected.");
  });
  it("lists permissions plainly by default and keeps the checkboxes behind Adjust permissions", () => {
    const html = renderConsentPage(base);
    expect(html).toContain("<summary>Adjust permissions</summary>");
    expect(html.indexOf("<li>")).toBeLessThan(html.indexOf('type="checkbox"'));
  });
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
