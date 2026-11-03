import { describe, expect, it, vi } from "vitest";
import { readDependabotAlerts } from "./dependabot-reader";

const repo = { owner: "acme", name: "widgets" };
const alert = { number: 7, state: "open", dependency: { package: { name: "glob" }, manifest_path: "pnpm-lock.yaml" },
  security_advisory: { ghsa_id: "GHSA-3g3m-2fjr-6pw4", severity: "medium", summary: "Cancellation bypass" },
  security_vulnerability: { vulnerable_version_range: "<14.0.2", first_patched_version: { identifier: "14.0.2" } } };

describe("repository Dependabot coverage", () => {
  it("follows cursor pagination and preserves remediation facts", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([alert]), { headers: { link: '<https://api.github.com/repos/acme/widgets/dependabot/alerts?after=next>; rel="next"' } }))
      .mockResolvedValueOnce(new Response("[]"));
    const result = await readDependabotAlerts({ repo, token: "test", fetchImpl });
    expect(result).toMatchObject({ ok: true, alerts: [{ number: 7, packageName: "glob", manifest: "pnpm-lock.yaml", patched: "14.0.2" }] });
    expect(fetchImpl.mock.calls[1][0]).toContain("after=next");
    expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.has("page")).toBe(false);
  });

  it.each([401, 403, 404, 429, 500])("reports HTTP %s as unreadable, not zero alerts", async status => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status }));
    expect(await readDependabotAlerts({ repo, token: "test", fetchImpl })).toMatchObject({ ok: false, error: expect.stringContaining(String(status)) });
  });

  it("refuses truncated coverage and credential forwarding to another endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify([alert]), { headers: { link: '<https://evil.test/steal>; rel="next"' } }));
    expect(await readDependabotAlerts({ repo, token: "test", fetchImpl })).toMatchObject({ ok: false });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const paged = vi.fn().mockImplementation(async () => new Response(JSON.stringify([alert]), { headers: { link: '<https://api.github.com/repos/acme/widgets/dependabot/alerts?after=next>; rel="next"' } }));
    expect(await readDependabotAlerts({ repo, token: "test", fetchImpl: paged, maxPages: 1 })).toMatchObject({ ok: false, error: expect.stringContaining("incomplete") });
  });

  it("refuses malformed successful responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('[{"number":7}]'));
    expect(await readDependabotAlerts({ repo, token: "test", fetchImpl })).toMatchObject({ ok: false });
  });
});
