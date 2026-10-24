import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  GitHubForgeAdapter,
  classifyGitHubFailure,
  parseGitHubRepositoryUrl,
} from "./github-adapter";

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? null,
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("parseGitHubRepositoryUrl", () => {
  it("parses GitHub HTTPS, SSH, and ssh:// repository URLs through one helper", () => {
    expect(parseGitHubRepositoryUrl("https://github.com/acme/portal.git")).toEqual({
      forge: "github",
      owner: "acme",
      repo: "portal",
    });
    expect(parseGitHubRepositoryUrl("git@github.com:acme/portal.git")).toEqual({
      forge: "github",
      owner: "acme",
      repo: "portal",
    });
    expect(parseGitHubRepositoryUrl("ssh://git@github.com/acme/portal.git")).toEqual({
      forge: "github",
      owner: "acme",
      repo: "portal",
    });
  });

  it("rejects non-GitHub and malformed URLs without guessing a forge", () => {
    expect(parseGitHubRepositoryUrl("https://gitlab.com/acme/portal.git")).toBeNull();
    expect(parseGitHubRepositoryUrl("not a remote")).toBeNull();
    expect(parseGitHubRepositoryUrl(null)).toBeNull();
  });
});

describe("classifyGitHubFailure", () => {
  it("classifies TLS, EOF, DNS, and abort failures as retryable connectivity problems", () => {
    expect(classifyGitHubFailure(new TypeError("Client network socket disconnected before secure TLS connection was established"))).toMatchObject({
      category: "retryable",
      retryable: true,
      freshness: "unavailable",
    });
    expect(classifyGitHubFailure(new Error("read ECONNRESET / unexpected EOF"))).toMatchObject({
      category: "retryable",
      retryable: true,
    });
  });

  it("classifies API statuses without collapsing policy and connectivity failures", () => {
    expect(classifyGitHubFailure(response(401, { message: "Bad credentials" }))).toMatchObject({
      category: "unauthorized",
      retryable: false,
      status: 401,
    });
    expect(classifyGitHubFailure(response(429, { message: "rate limited" }, { "retry-after": "30" }))).toMatchObject({
      category: "retryable",
      retryable: true,
      status: 429,
      retryAfterSeconds: 30,
    });
    expect(classifyGitHubFailure(response(422, { message: "Validation Failed" }))).toMatchObject({
      category: "policy-rejected",
      retryable: false,
      status: 422,
    });
  });
});

describe("GitHubForgeAdapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("advertises GitHub as an external adapter, not the bundled local integration core", () => {
    const adapter = new GitHubForgeAdapter({ token: "ghp_test" });

    expect(adapter.capabilities()).toMatchObject({
      adapter: "github",
      integrationAuthority: "external-forge-adapter",
      supportedEgressClasses: ["own-repo", "public-hive", "release-distribution"],
    });
  });

  it("creates an issue through normalized adapter output", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      response(201, { number: 42, html_url: "https://github.com/acme/portal/issues/42" }),
    );
    const adapter = new GitHubForgeAdapter({ token: "ghp_test" });

    const result = await adapter.createIssue({
      repository: { forge: "github", owner: "acme", repo: "portal" },
      title: "Saved local evidence should publish later",
      body: "Network-tolerant issue projection.",
      labels: ["hive:submitted"],
      egressClass: "public-hive",
    });

    expect(result).toEqual({
      ok: true,
      remote: {
        adapter: "github",
        id: "42",
        number: 42,
        url: "https://github.com/acme/portal/issues/42",
      },
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/portal/issues",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          title: "Saved local evidence should publish later",
          body: "Network-tolerant issue projection.",
          labels: ["hive:submitted"],
        }),
      }),
    );
  });
});

describe("GitHubForgeAdapter.closeIssue", () => {
  const repository = { forge: "github" as const, owner: "acme", repo: "portal" };
  const issue = (state: string) => ({ number: 42, html_url: "https://github.com/acme/portal/issues/42", state });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("comments, then closes with the given reason", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null });
      if (init.method === "PATCH") return response(200, issue("closed"));
      if (init.method === "POST") return response(201, { id: 1 });
      return response(200, issue("open"));
    }));
    const adapter = new GitHubForgeAdapter({ token: "ghp_test" });
    const result = await adapter.closeIssue({ repository, number: 42, comment: "Resolved.", reason: "not_planned", egressClass: "public-hive" });
    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ outcome: "closed", remote: { number: 42 } });
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST", "PATCH"]);
    expect(calls[1]).toMatchObject({ url: "https://api.github.com/repos/acme/portal/issues/42/comments", body: { body: "Resolved." } });
    expect(calls[2].body).toEqual({ state: "closed", state_reason: "not_planned" });
  });

  it("is idempotent: an already-closed issue is neither commented on nor patched", async () => {
    const fetchMock = vi.fn(async () => response(200, issue("closed")));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new GitHubForgeAdapter({ token: "ghp_test" });
    const result = await adapter.closeIssue({ repository, number: 42, comment: "again", reason: "completed", egressClass: "public-hive" });
    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ outcome: "already-closed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a 404 as not-found without patching", async () => {
    const fetchMock = vi.fn(async () => response(404, { message: "Not Found" }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new GitHubForgeAdapter({ token: "ghp_test" });
    const result = await adapter.closeIssue({ repository, number: 42, comment: null, reason: "completed", egressClass: "public-hive" });
    expect(result).toMatchObject({ ok: false, category: "not-found", status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("skips the comment call when no comment is given", async () => {
    const methods: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      methods.push(init.method ?? "GET");
      return response(200, issue(init.method === "PATCH" ? "closed" : "open"));
    }));
    const adapter = new GitHubForgeAdapter({ token: "ghp_test" });
    await adapter.closeIssue({ repository, number: 42, comment: null, reason: "completed", egressClass: "public-hive" });
    expect(methods).toEqual(["GET", "PATCH"]);
  });
});
