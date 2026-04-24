import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock Next.js server-action plumbing so the module can import cleanly in a
// pure-node test environment. validateGitHubToken itself is a pure fetch
// wrapper — it doesn't touch auth / prisma / revalidatePath — but the file's
// top-level "use server" + imports need to be silenceable.
vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: "test-user-1" } }),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    platformDevConfig: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    credentialEntry: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/permissions", () => ({
  can: vi.fn().mockReturnValue(true),
}));

vi.mock("@/lib/platform-dev-policy", () => ({
  getPlatformDevPolicyState: vi.fn(),
}));

import { validateGitHubToken } from "./platform-dev-config";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function userResponse(body: { login?: string }, extraHeaders: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    headers: new Headers({
      "X-OAuth-Scopes": "",
      ...extraHeaders,
    }),
  } as unknown as Response;
}

function repoResponse(status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
    headers: new Headers(),
  } as unknown as Response;
}

function mockFetchByUrl(handler: (url: string) => Response | Promise<Response>) {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url);
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("validateGitHubToken — back-compat single-arg form", () => {
  it("accepts a raw string token and returns username", async () => {
    mockFetchByUrl(() =>
      userResponse({ login: "octocat" }, { "X-OAuth-Scopes": "public_repo" }),
    );

    const result = await validateGitHubToken("ghp_abc");

    expect(result.valid).toBe(true);
    expect(result.username).toBe("octocat");
  });

  it("returns valid:false with error message on 401", async () => {
    mockFetchByUrl(() => ({
      ok: false,
      status: 401,
      json: async () => ({}),
      headers: new Headers(),
    }) as unknown as Response);

    const result = await validateGitHubToken("ghp_bad");

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/invalid or expired/i);
  });
});

describe("validateGitHubToken — prefix-based auth method detection", () => {
  it("detects oauth-device from gho_ prefix", async () => {
    mockFetchByUrl(() =>
      userResponse({ login: "alice" }, { "X-OAuth-Scopes": "public_repo" }),
    );

    const result = await validateGitHubToken({ token: "gho_xxx", authMethod: "auto" });

    expect(result.valid).toBe(true);
    expect(result.authMethod).toBe("oauth-device");
  });

  it("detects fine-grained-pat from github_pat_ prefix", async () => {
    mockFetchByUrl((url) => {
      if (url.includes("/user")) {
        return userResponse({ login: "alice" }, {});
      }
      return repoResponse(200);
    });

    const result = await validateGitHubToken({ token: "github_pat_xyz", authMethod: "auto" });

    expect(result.valid).toBe(true);
    expect(result.authMethod).toBe("fine-grained-pat");
  });

  it("detects classic-pat from ghp_ prefix", async () => {
    mockFetchByUrl(() =>
      userResponse({ login: "alice" }, { "X-OAuth-Scopes": "public_repo" }),
    );

    const result = await validateGitHubToken({ token: "ghp_classic", authMethod: "auto" });

    expect(result.valid).toBe(true);
    expect(result.authMethod).toBe("classic-pat");
  });

  it("rejects unknown prefixes (e.g. ghs_ app install)", async () => {
    mockFetchByUrl(() => userResponse({ login: "ignored" }, {}));

    const result = await validateGitHubToken({ token: "ghs_appinstall", authMethod: "auto" });

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Token format not recognized/i);
  });
});

describe("validateGitHubToken — scope validation (classic PAT)", () => {
  it("accepts public_repo when required scope is public_repo", async () => {
    mockFetchByUrl(() =>
      userResponse({ login: "alice" }, { "X-OAuth-Scopes": "public_repo" }),
    );

    const result = await validateGitHubToken({
      token: "ghp_a",
      requiredScope: "public_repo",
    });

    expect(result.valid).toBe(true);
  });

  it("accepts repo as superset of public_repo", async () => {
    mockFetchByUrl(() =>
      userResponse({ login: "alice" }, { "X-OAuth-Scopes": "repo" }),
    );

    const result = await validateGitHubToken({
      token: "ghp_a",
      requiredScope: "public_repo",
    });

    expect(result.valid).toBe(true);
  });

  it("rejects read:user when public_repo is required", async () => {
    mockFetchByUrl(() =>
      userResponse({ login: "alice" }, { "X-OAuth-Scopes": "read:user" }),
    );

    const result = await validateGitHubToken({
      token: "ghp_a",
      requiredScope: "public_repo",
    });

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/scope/i);
    expect(result.error).toMatch(/public_repo/i);
  });
});

describe("validateGitHubToken — expiry (fine-grained PAT)", () => {
  it("populates expiresAt when header present, valid without requireNonExpired", async () => {
    const future = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(); // +60d
    mockFetchByUrl((url) => {
      if (url.includes("/user")) {
        return userResponse(
          { login: "alice" },
          { "github-authentication-token-expiration": future },
        );
      }
      return repoResponse(200);
    });

    const result = await validateGitHubToken({ token: "github_pat_ok" });

    expect(result.valid).toBe(true);
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  it("rejects tokens expiring in <30 days when requireNonExpired is set", async () => {
    const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(); // +10d
    mockFetchByUrl((url) => {
      if (url.includes("/user")) {
        return userResponse(
          { login: "alice" },
          { "github-authentication-token-expiration": soon },
        );
      }
      return repoResponse(200);
    });

    const result = await validateGitHubToken({
      token: "github_pat_soon",
      requireNonExpired: true,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/expires/i);
  });

  it("still populates expiresAt even when requireNonExpired is false", async () => {
    const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    mockFetchByUrl((url) => {
      if (url.includes("/user")) {
        return userResponse(
          { login: "alice" },
          { "github-authentication-token-expiration": soon },
        );
      }
      return repoResponse(200);
    });

    const result = await validateGitHubToken({
      token: "github_pat_soon",
      requireNonExpired: false,
    });

    expect(result.valid).toBe(true);
    expect(result.expiresAt).toBeInstanceOf(Date);
  });
});

describe("validateGitHubToken — owner mismatch", () => {
  it("rejects when token owner doesn't match expectedOwner", async () => {
    mockFetchByUrl((url) => {
      if (url.includes("/user")) {
        return userResponse(
          { login: "jane" },
          { "X-OAuth-Scopes": "public_repo" },
        );
      }
      return repoResponse(200);
    });

    const result = await validateGitHubToken({
      token: "ghp_a",
      expectedOwner: "jane-dev",
    });

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/owner/i);
  });

  it("allows mismatch when machineUser opt-out is set", async () => {
    mockFetchByUrl((url) => {
      if (url.includes("/user")) {
        return userResponse(
          { login: "bot-account" },
          { "X-OAuth-Scopes": "public_repo" },
        );
      }
      return repoResponse(200);
    });

    const result = await validateGitHubToken({
      token: "ghp_a",
      expectedOwner: "jane-dev",
      machineUser: true,
    });

    expect(result.valid).toBe(true);
  });
});

describe("validateGitHubToken — per-repo probe (fine-grained PAT)", () => {
  it("probes the fork repo when expectedOwner is set (200 → valid)", async () => {
    const calls: string[] = [];
    mockFetchByUrl((url) => {
      calls.push(url);
      if (url.includes("/user")) {
        return userResponse({ login: "jane-dev" }, {});
      }
      return repoResponse(200);
    });

    const result = await validateGitHubToken({
      token: "github_pat_fg",
      expectedOwner: "jane-dev",
    });

    expect(result.valid).toBe(true);
    expect(calls.some((u) => u.includes("/repos/jane-dev/opendigitalproductfactory"))).toBe(true);
  });

  it("probes the fork repo when expectedOwner is set (404 → invalid)", async () => {
    mockFetchByUrl((url) => {
      if (url.includes("/user")) {
        return userResponse({ login: "jane-dev" }, {});
      }
      return repoResponse(404);
    });

    const result = await validateGitHubToken({
      token: "github_pat_fg",
      expectedOwner: "jane-dev",
    });

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/fork/i);
  });

  it("probes upstream repo when expectedOwner is not set", async () => {
    const calls: string[] = [];
    mockFetchByUrl((url) => {
      calls.push(url);
      if (url.includes("/user")) {
        return userResponse({ login: "alice" }, {});
      }
      return repoResponse(200);
    });

    const result = await validateGitHubToken({ token: "github_pat_fg" });

    expect(result.valid).toBe(true);
    expect(
      calls.some((u) =>
        u.includes("/repos/OpenDigitalProductFactory/opendigitalproductfactory"),
      ),
    ).toBe(true);
  });
});
