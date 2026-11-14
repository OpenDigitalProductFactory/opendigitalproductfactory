import { describe, expect, it, vi } from "vitest";
import { readCodeScanningAlerts } from "./code-scanning-reader";
import { readSecretScanningAlerts } from "./secret-scanning-reader";

const repo = { owner: "acme", name: "widgets" };
const codeql = {
  number: 528, state: "open", tool: { name: "CodeQL" },
  rule: { id: "js/polynomial-redos", description: "Polynomial regular expression", severity: "warning", security_severity_level: "high" },
  most_recent_instance: { location: { path: "packages/x/product-mix.ts", start_line: 12 } },
};
const secret = {
  number: 3, state: "open", secret_type: "github_personal_access_token",
  secret_type_display_name: "GitHub Personal Access Token", secret: "ghp_THIS_MUST_NEVER_LEAVE_THE_READER",
  validity: "active", first_location_detected: { path: "scripts/x.sh", start_line: 4 },
};
const next = (path: string) => ({ headers: { link: `<https://api.github.com/repos/acme/widgets/${path}?after=n>; rel="next"` } });

describe("code scanning coverage", () => {
  it("reads open alerts across pages with rule, severity and location", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([codeql]), next("code-scanning/alerts")))
      .mockResolvedValueOnce(new Response("[]"));
    const result = await readCodeScanningAlerts({ repo, token: "t", fetchImpl });
    expect(result).toMatchObject({ ok: true, alerts: [{ number: 528, ruleId: "js/polynomial-redos", severity: "high",
      path: "packages/x/product-mix.ts", startLine: 12, url: "https://github.com/acme/widgets/security/code-scanning/528" }] });
    expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.get("state")).toBe("open");
  });

  it("falls back to rule.severity when the rule has no security severity", async () => {
    const plain = { ...codeql, rule: { id: "js/unused", severity: "note" } };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify([plain])));
    expect(await readCodeScanningAlerts({ repo, token: "t", fetchImpl })).toMatchObject({ ok: true, alerts: [{ severity: "low" }] });
  });

  it.each([401, 403, 404])("reports HTTP %s as unreadable and names the missing permission", async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status }));
    const result = await readCodeScanningAlerts({ repo, token: "t", fetchImpl });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("Code scanning alerts: read") });
  });

  it("refuses malformed, truncated and foreign-host reads", async () => {
    expect(await readCodeScanningAlerts({ repo, token: "t", fetchImpl: vi.fn().mockResolvedValue(new Response('[{"number":1}]')) }))
      .toMatchObject({ ok: false });
    const paged = vi.fn().mockImplementation(async () => new Response(JSON.stringify([codeql]), next("code-scanning/alerts")));
    expect(await readCodeScanningAlerts({ repo, token: "t", fetchImpl: paged, maxPages: 1 }))
      .toMatchObject({ ok: false, error: expect.stringContaining("incomplete") });
    const foreign = vi.fn().mockResolvedValue(new Response(JSON.stringify([codeql]), { headers: { link: '<https://evil.test/x>; rel="next"' } }));
    expect(await readCodeScanningAlerts({ repo, token: "t", fetchImpl: foreign })).toMatchObject({ ok: false });
    expect(foreign).toHaveBeenCalledOnce();
  });

  it("reports a missing controller credential as unreadable", async () => {
    expect(await readCodeScanningAlerts({ repo, token: null, fetchImpl: vi.fn() })).toMatchObject({ ok: false });
  });
});

describe("secret scanning coverage", () => {
  it("keeps type, validity and location but never the secret value", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify([secret])));
    const result = await readSecretScanningAlerts({ repo, token: "t", fetchImpl });
    expect(result).toMatchObject({ ok: true, alerts: [{ number: 3, secretType: "GitHub Personal Access Token",
      validity: "active", path: "scripts/x.sh", startLine: 4 }] });
    expect(JSON.stringify(result)).not.toContain("ghp_THIS_MUST_NEVER_LEAVE_THE_READER");
  });

  it("reports HTTP 403 as unreadable and names the missing permission", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 403 }));
    expect(await readSecretScanningAlerts({ repo, token: "t", fetchImpl }))
      .toMatchObject({ ok: false, error: expect.stringContaining("Secret scanning alerts: read") });
  });
});
