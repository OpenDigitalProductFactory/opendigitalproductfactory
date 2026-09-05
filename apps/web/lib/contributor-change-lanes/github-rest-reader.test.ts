// apps/web/lib/contributor-change-lanes/github-rest-reader.test.ts
// Phase 4 of BI-063BDF1B — GitHub REST reader.
//
// Test fakes drive `fetch` so no real network call is made. Covers:
//   - no credential row → state: not-configured, no fetch attempted
//   - happy path: paginated response → all rows parsed, etag written
//   - 304 Not Modified → ok with unchanged: true, no rows
//   - 401 → state: error with actionable message
//   - rate-limit headers captured
//   - parseRepoFromUrl covers https + ssh URL shapes

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  credentialFindUnique: vi.fn(),
  platformDevConfigFindUnique: vi.fn(),
  scheduledJobFindUnique: vi.fn(),
  scheduledJobUpdate: vi.fn(),
  decryptSecret: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    credentialEntry: { findUnique: mocks.credentialFindUnique },
    platformDevConfig: { findUnique: mocks.platformDevConfigFindUnique },
    scheduledJob: {
      findUnique: mocks.scheduledJobFindUnique,
      update: mocks.scheduledJobUpdate,
    },
  },
}));

vi.mock("@/lib/credential-crypto", () => ({
  decryptSecret: mocks.decryptSecret,
}));

import {
  createGithubReadTransport,
  parseRepoFromUrl,
  readGithubPullRequests,
  resolveGithubToken,
} from "./github-rest-reader";

it("creates a GitHub transport isolated from the framework-global fetch", async () => {
  const transport = createGithubReadTransport();
  expect(transport.fetch).not.toBe(globalThis.fetch);
  await expect(transport.close()).resolves.toBeUndefined();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.credentialFindUnique.mockResolvedValue(null);
  mocks.platformDevConfigFindUnique.mockResolvedValue({
    upstreamRemoteUrl: "https://github.com/o/r.git",
  });
  mocks.scheduledJobFindUnique.mockResolvedValue({ metadata: {} });
  mocks.scheduledJobUpdate.mockResolvedValue({});
  mocks.decryptSecret.mockReturnValue("ghp_decrypted_xxxxxxxxx");
});

function makeResponse(
  body: unknown,
  init?: { status?: number; etag?: string; rateLimitRemaining?: string; rateLimitReset?: string },
): Response {
  const headers = new Headers();
  if (init?.etag) headers.set("etag", init.etag);
  if (init?.rateLimitRemaining) headers.set("x-ratelimit-remaining", init.rateLimitRemaining);
  if (init?.rateLimitReset) headers.set("x-ratelimit-reset", init.rateLimitReset);
  const status = init?.status ?? 200;
  // 304 is a null-body status per the Fetch spec — Response constructor rejects a body.
  if (status === 304) {
    return new Response(null, { status, headers });
  }
  return new Response(JSON.stringify(body ?? null), { status, headers });
}

describe("readGithubPullRequests", () => {
  it("returns state: not-configured when no credential row exists", async () => {
    mocks.credentialFindUnique.mockResolvedValueOnce(null);
    const fetchImpl = vi.fn();

    const result = await readGithubPullRequests({ fetchImpl: fetchImpl as never });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state).toBe("not-configured");
      expect(result.error).toContain("contributor MCP readiness card");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns state: not-configured when the row exists but status is not active", async () => {
    mocks.credentialFindUnique.mockResolvedValueOnce({
      secretRef: "enc:xxx",
      status: "revoked",
    });
    const fetchImpl = vi.fn();

    const result = await readGithubPullRequests({ fetchImpl: fetchImpl as never });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.state).toBe("not-configured");
  });

  it("happy path: paginated response parsed, etag persisted to ScheduledJob.metadata", async () => {
    mocks.credentialFindUnique.mockResolvedValueOnce({
      secretRef: "enc:encrypted-token-value",
      status: "active",
    });
    mocks.scheduledJobFindUnique.mockResolvedValue({ metadata: { other: "preserved" } });

    const page1Rows = Array.from({ length: 100 }, (_, i) => makeRawPr(i + 1));
    const page2Rows = [makeRawPr(101)];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        makeResponse(page1Rows, { status: 200, etag: '"new-etag-abc"', rateLimitRemaining: "4998", rateLimitReset: "1748295000" }),
      )
      .mockResolvedValueOnce(makeResponse(page2Rows, { status: 200 }));

    const result = await readGithubPullRequests({ fetchImpl: fetchImpl as never });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toHaveLength(101);
      expect(result.unchanged).toBe(false);
      expect(result.rateLimitRemaining).toBe(4998);
      expect(result.rateLimitResetAt).toBeInstanceOf(Date);
    }
    // First fetch carried no If-None-Match (initial etag from prior run is empty {})
    const firstCallHeaders = fetchImpl.mock.calls[0]?.[1].headers as Record<string, string>;
    expect(firstCallHeaders["If-None-Match"]).toBeUndefined();
    expect(firstCallHeaders.Authorization).toBe("Bearer ghp_decrypted_xxxxxxxxx");
    // Etag persisted to metadata, preserving sibling keys
    expect(mocks.scheduledJobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { metadata: { other: "preserved", githubPrEtag: '"new-etag-abc"' } },
      }),
    );
  });

  it("sends If-None-Match from ScheduledJob.metadata.githubPrEtag on the first page", async () => {
    mocks.credentialFindUnique.mockResolvedValueOnce({
      secretRef: "enc:xxx",
      status: "active",
    });
    mocks.scheduledJobFindUnique.mockResolvedValue({
      metadata: { githubPrEtag: '"prior-etag"' },
    });
    const fetchImpl = vi.fn().mockResolvedValueOnce(makeResponse([]));

    await readGithubPullRequests({ fetchImpl: fetchImpl as never });

    const headers = fetchImpl.mock.calls[0]?.[1].headers as Record<string, string>;
    expect(headers["If-None-Match"]).toBe('"prior-etag"');
  });

  it("304 Not Modified → ok with unchanged: true, no rows, no etag write", async () => {
    mocks.credentialFindUnique.mockResolvedValueOnce({
      secretRef: "enc:xxx",
      status: "active",
    });
    mocks.scheduledJobFindUnique.mockResolvedValue({
      metadata: { githubPrEtag: '"prior"' },
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(null, { status: 304, rateLimitRemaining: "5000" }));

    const result = await readGithubPullRequests({ fetchImpl: fetchImpl as never });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.unchanged).toBe(true);
      expect(result.rows).toHaveLength(0);
      expect(result.rateLimitRemaining).toBe(5000);
    }
    expect(mocks.scheduledJobUpdate).not.toHaveBeenCalled();
  });

  it("401 unauthorized → state: error with actionable message", async () => {
    mocks.credentialFindUnique.mockResolvedValueOnce({
      secretRef: "enc:xxx",
      status: "active",
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeResponse({ message: "Bad credentials" }, { status: 401 }));

    const result = await readGithubPullRequests({ fetchImpl: fetchImpl as never });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state).toBe("error");
      expect(result.error).toContain("401");
      expect(result.error.toLowerCase()).toMatch(/revoked|scope/);
    }
  });

  it("network error caught and returned as state: error", async () => {
    mocks.credentialFindUnique.mockResolvedValueOnce({
      secretRef: "enc:xxx",
      status: "active",
    });
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await readGithubPullRequests({ fetchImpl: fetchImpl as never });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state).toBe("error");
      expect(result.error).toContain("ECONNREFUSED");
    }
  });
});

describe("parseRepoFromUrl", () => {
  it("parses https URLs with .git suffix", () => {
    expect(parseRepoFromUrl("https://github.com/owner/repo.git")).toEqual({
      owner: "owner",
      name: "repo",
    });
  });

  it("parses https URLs without .git suffix", () => {
    expect(parseRepoFromUrl("https://github.com/owner/repo")).toEqual({
      owner: "owner",
      name: "repo",
    });
  });

  it("parses ssh-style URLs", () => {
    expect(parseRepoFromUrl("git@github.com:owner/repo.git")).toEqual({
      owner: "owner",
      name: "repo",
    });
  });

  it("returns null for non-github URLs", () => {
    expect(parseRepoFromUrl("https://gitlab.com/owner/repo")).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(parseRepoFromUrl("garbage")).toBeNull();
  });
});

function makeRawPr(n: number) {
  return {
    number: n,
    html_url: `https://github.com/o/r/pull/${n}`,
    title: `PR ${n}`,
    head: { ref: `feat/branch-${n}` },
    state: "open",
    draft: false,
    mergeable_state: "CLEAN",
  };
}


// BI-69BBC446. resolveGithubToken read exactly one credential row,
// "github-pr-sync", which nothing in the product writes — the Contributor MCP
// card its comment named does not exist. So it returned null on every install,
// callers fell back to unauthenticated requests, and against a private repo
// those fail. That killed repository provenance, and with it plan-coverage
// receipts, spec-approval baselines and independent design review — while an
// active "hive-contribution" credential sat one row away.
describe("resolveGithubToken credential chain", () => {
  function prismaWith(rows: Record<string, { secretRef: string; status: string } | null>) {
    return {
      credentialEntry: {
        findUnique: vi.fn(async ({ where }: { where: { providerId: string } }) =>
          rows[where.providerId] ?? null),
      },
    } as never;
  }

  it("prefers the dedicated github-pr-sync credential when one exists", async () => {
    const token = await resolveGithubToken(prismaWith({
      "github-pr-sync": { secretRef: "dedicated-token", status: "active" },
      "hive-contribution": { secretRef: "hive-token", status: "active" },
    }));
    expect(token).toBe("dedicated-token");
  });

  it("falls back to hive-contribution when github-pr-sync is absent", async () => {
    const token = await resolveGithubToken(prismaWith({
      "hive-contribution": { secretRef: "hive-token", status: "active" },
    }));
    expect(token).toBe("hive-token");
  });

  it("falls back to git-backup when neither of the first two is active", async () => {
    const token = await resolveGithubToken(prismaWith({
      "hive-contribution": { secretRef: "stale", status: "revoked" },
      "git-backup": { secretRef: "backup-token", status: "active" },
    }));
    expect(token).toBe("backup-token");
  });

  it("returns null when the store genuinely holds nothing usable", async () => {
    const previous = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    try {
      expect(await resolveGithubToken(prismaWith({}))).toBeNull();
    } finally {
      if (previous !== undefined) process.env.GITHUB_TOKEN = previous;
    }
  });
});
