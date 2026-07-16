import { describe, it, expect, vi, beforeEach } from "vitest";

// Spy the recorder without touching prisma.
vi.mock("./cli-pool-status", () => ({
  recordCliWeeklyQuota: vi.fn(async () => {}),
}));

import { collectClaudeCliWeeklyQuota, extractAccessToken } from "./weekly-quota-collector";
import { recordCliWeeklyQuota } from "./cli-pool-status";

const OK_CREDS = JSON.stringify({ claudeAiOauth: { accessToken: "sk-oauth-abc" } });
const OK_USAGE = { seven_day: { utilization: 0.62, resets_at: "2026-07-18T05:00:00Z" } };

function okFetch(body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
}

const ENABLED = { DPF_WEEKLY_QUOTA_COLLECT_ENABLED: "true", DPF_CLAUDE_OAUTH_CREDS_PATH: "/creds.json" } as unknown as NodeJS.ProcessEnv;

beforeEach(() => vi.clearAllMocks());

describe("extractAccessToken", () => {
  it("reads nested claudeAiOauth.accessToken", () => {
    expect(extractAccessToken(OK_CREDS)).toBe("sk-oauth-abc");
  });
  it("reads a flat accessToken / token", () => {
    expect(extractAccessToken(JSON.stringify({ accessToken: "x" }))).toBe("x");
    expect(extractAccessToken(JSON.stringify({ token: "y" }))).toBe("y");
  });
  it("returns null for junk or missing token", () => {
    expect(extractAccessToken("not json")).toBeNull();
    expect(extractAccessToken(JSON.stringify({ other: 1 }))).toBeNull();
  });
});

describe("collectClaudeCliWeeklyQuota — opt-in gating", () => {
  it("is a no-op when the enable flag is unset (default)", async () => {
    const r = await collectClaudeCliWeeklyQuota({ env: {} as NodeJS.ProcessEnv });
    expect(r.collected).toBe(false);
    expect(r.reason).toMatch(/disabled/);
    expect(recordCliWeeklyQuota).not.toHaveBeenCalled();
  });

  it("is a no-op when enabled but no creds path is configured", async () => {
    const r = await collectClaudeCliWeeklyQuota({ env: { DPF_WEEKLY_QUOTA_COLLECT_ENABLED: "true" } as unknown as NodeJS.ProcessEnv });
    expect(r.collected).toBe(false);
    expect(r.reason).toMatch(/no creds path/);
    expect(recordCliWeeklyQuota).not.toHaveBeenCalled();
  });
});

describe("collectClaudeCliWeeklyQuota — happy path + fail-closed", () => {
  it("records the parsed weekly snapshot when enabled + creds + valid response", async () => {
    const fetchImpl = okFetch(OK_USAGE);
    const r = await collectClaudeCliWeeklyQuota({
      env: ENABLED,
      readCreds: async () => OK_CREDS,
      fetchImpl,
      now: new Date("2026-07-16T12:00:00Z"),
    });
    expect(r.collected).toBe(true);
    expect(recordCliWeeklyQuota).toHaveBeenCalledOnce();
    const [adapter, , snap] = vi.mocked(recordCliWeeklyQuota).mock.calls[0]!;
    expect(adapter).toBe("claude-cli");
    expect(snap.utilization).toBeCloseTo(0.62);
    expect(snap.source).toBe("anthropic-oauth-usage");
  });

  it("sends the required OAuth beta + claude-code User-Agent headers", async () => {
    const fetchImpl = okFetch(OK_USAGE);
    await collectClaudeCliWeeklyQuota({ env: ENABLED, readCreds: async () => OK_CREDS, fetchImpl });
    const call = vi.mocked(fetchImpl).mock.calls[0]!;
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-oauth-abc");
    expect(headers["anthropic-beta"]).toBe("oauth-2025-04-20");
    expect(headers["User-Agent"]).toMatch(/^claude-code\//);
  });

  it("fails closed on an HTTP error (records nothing)", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 429 })) as unknown as typeof fetch;
    const r = await collectClaudeCliWeeklyQuota({ env: ENABLED, readCreds: async () => OK_CREDS, fetchImpl });
    expect(r.collected).toBe(false);
    expect(r.reason).toMatch(/HTTP 429/);
    expect(recordCliWeeklyQuota).not.toHaveBeenCalled();
  });

  it("fails closed when the creds file can't be read", async () => {
    const r = await collectClaudeCliWeeklyQuota({
      env: ENABLED,
      readCreds: async () => { throw new Error("ENOENT"); },
      fetchImpl: okFetch(OK_USAGE),
    });
    expect(r.collected).toBe(false);
    expect(r.reason).toMatch(/error:/);
    expect(recordCliWeeklyQuota).not.toHaveBeenCalled();
  });

  it("fails closed when the response carries no weekly window", async () => {
    const r = await collectClaudeCliWeeklyQuota({
      env: ENABLED,
      readCreds: async () => OK_CREDS,
      fetchImpl: okFetch({ five_hour: { utilization: 0.1 } }),
    });
    expect(r.collected).toBe(false);
    expect(r.reason).toMatch(/no weekly window/);
    expect(recordCliWeeklyQuota).not.toHaveBeenCalled();
  });
});
