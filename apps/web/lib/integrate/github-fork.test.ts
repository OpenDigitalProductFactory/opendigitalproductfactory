import { beforeEach, describe, expect, it, vi } from "vitest";

import { createForkAndWait, forkExistsAndIsFork, syncForkFromUpstream } from "./github-fork";

const UPSTREAM = { owner: "OpenDigitalProductFactory", repo: "opendigitalproductfactory" };

function okJson<T>(body: T): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function errResponse(status: number, text = ""): Response {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(text),
    json: () => Promise.resolve({}),
  } as unknown as Response;
}

describe("forkExistsAndIsFork", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("returns {exists: true, isFork: true} when GitHub returns a fork of the upstream", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      okJson({ fork: true, parent: { full_name: `${UPSTREAM.owner}/${UPSTREAM.repo}` } }),
    );

    const result = await forkExistsAndIsFork({
      owner: "jane-dev",
      repo: UPSTREAM.repo,
      upstreamOwner: UPSTREAM.owner,
      upstreamRepo: UPSTREAM.repo,
      token: "ghp_test",
    });

    expect(result.exists).toBe(true);
    expect(result.isFork).toBe(true);
    expect(result.parentFullName).toBe(`${UPSTREAM.owner}/${UPSTREAM.repo}`);
  });

  it("matches upstream case-insensitively", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      okJson({ fork: true, parent: { full_name: "opendigitalproductfactory/opendigitalproductfactory" } }),
    );

    const result = await forkExistsAndIsFork({
      owner: "jane-dev",
      repo: UPSTREAM.repo,
      upstreamOwner: "OpenDigitalProductFactory",
      upstreamRepo: "opendigitalproductfactory",
      token: "ghp_test",
    });

    expect(result.isFork).toBe(true);
  });

  it("returns {exists: true, isFork: false} when repo exists but is not a fork", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(okJson({ fork: false }));

    const result = await forkExistsAndIsFork({
      owner: "jane-dev",
      repo: UPSTREAM.repo,
      upstreamOwner: UPSTREAM.owner,
      upstreamRepo: UPSTREAM.repo,
      token: "ghp_test",
    });

    expect(result.exists).toBe(true);
    expect(result.isFork).toBe(false);
  });

  it("returns {exists: true, isFork: false} when it IS a fork but of a different upstream", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      okJson({ fork: true, parent: { full_name: "some-other-org/some-other-repo" } }),
    );

    const result = await forkExistsAndIsFork({
      owner: "jane-dev",
      repo: UPSTREAM.repo,
      upstreamOwner: UPSTREAM.owner,
      upstreamRepo: UPSTREAM.repo,
      token: "ghp_test",
    });

    expect(result.exists).toBe(true);
    expect(result.isFork).toBe(false);
    expect(result.parentFullName).toBe("some-other-org/some-other-repo");
  });

  it("returns {exists: false} on 404", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(errResponse(404, "Not Found"));

    const result = await forkExistsAndIsFork({
      owner: "jane-dev",
      repo: UPSTREAM.repo,
      upstreamOwner: UPSTREAM.owner,
      upstreamRepo: UPSTREAM.repo,
      token: "ghp_test",
    });

    expect(result.exists).toBe(false);
    expect(result.isFork).toBe(false);
  });

  it("throws on 401 (auth failure)", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(errResponse(401, "Bad credentials"));

    await expect(
      forkExistsAndIsFork({
        owner: "jane-dev",
        repo: UPSTREAM.repo,
        upstreamOwner: UPSTREAM.owner,
        upstreamRepo: UPSTREAM.repo,
        token: "ghp_bad",
      }),
    ).rejects.toThrow(/401/);
  });

  it("throws on 403 (forbidden)", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(errResponse(403, "Forbidden"));

    await expect(
      forkExistsAndIsFork({
        owner: "jane-dev",
        repo: UPSTREAM.repo,
        upstreamOwner: UPSTREAM.owner,
        upstreamRepo: UPSTREAM.repo,
        token: "ghp_test",
      }),
    ).rejects.toThrow(/403/);
  });
});

describe("createForkAndWait", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("returns {status: 'ready', forkOwner, forkRepo} when fork becomes available within polling window", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    // 1) POST /forks -> 202 with the pending fork info
    fetchMock.mockResolvedValueOnce(okJson({ owner: { login: "jane-dev" }, name: UPSTREAM.repo }));
    // 2) First GET /repos/jane-dev/repo -> 404 (fork not ready yet)
    fetchMock.mockResolvedValueOnce(errResponse(404));
    // 3) Second GET -> 200 with parent matching upstream (fork ready)
    fetchMock.mockResolvedValueOnce(
      okJson({ fork: true, parent: { full_name: `${UPSTREAM.owner}/${UPSTREAM.repo}` } }),
    );

    const result = await createForkAndWait({
      upstreamOwner: UPSTREAM.owner,
      upstreamRepo: UPSTREAM.repo,
      token: "ghp_test",
      pollIntervalMs: 1, // keep the test fast
      maxAttempts: 5,
    });

    expect(result.status).toBe("ready");
    expect(result.forkOwner).toBe("jane-dev");
    expect(result.forkRepo).toBe(UPSTREAM.repo);
  });

  it("returns {status: 'deferred'} when fork is still not ready after maxAttempts", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(okJson({ owner: { login: "jane-dev" }, name: UPSTREAM.repo }));
    // Every subsequent GET returns 404 — fork never materializes
    fetchMock.mockResolvedValue(errResponse(404));

    const result = await createForkAndWait({
      upstreamOwner: UPSTREAM.owner,
      upstreamRepo: UPSTREAM.repo,
      token: "ghp_test",
      pollIntervalMs: 1,
      maxAttempts: 3,
    });

    expect(result.status).toBe("deferred");
    expect(result.forkOwner).toBe("jane-dev");
  });

  it("throws actionable error on POST /forks 401", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(errResponse(401, "Bad credentials"));

    await expect(
      createForkAndWait({
        upstreamOwner: UPSTREAM.owner,
        upstreamRepo: UPSTREAM.repo,
        token: "ghp_bad",
        pollIntervalMs: 1,
        maxAttempts: 2,
      }),
    ).rejects.toThrow(/401/);
  });

  it("throws actionable error on POST /forks 403", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      errResponse(403, "This organization does not allow forking"),
    );

    await expect(
      createForkAndWait({
        upstreamOwner: UPSTREAM.owner,
        upstreamRepo: UPSTREAM.repo,
        token: "ghp_test",
        pollIntervalMs: 1,
        maxAttempts: 2,
      }),
    ).rejects.toThrow(/403/);
  });
});

describe("syncForkFromUpstream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("resolves on 200 success", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(okJson({ message: "Successfully fetched and fast-forwarded" }));

    await expect(
      syncForkFromUpstream({
        forkOwner: "jane-dev",
        forkRepo: UPSTREAM.repo,
        branch: "main",
        token: "ghp_test",
      }),
    ).resolves.toBeUndefined();

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/repos/jane-dev/opendigitalproductfactory/merge-upstream");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init!.body as string)).toEqual({ branch: "main" });
  });

  it("throws an actionable conflict error on 409", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      errResponse(409, "merge conflict"),
    );

    await expect(
      syncForkFromUpstream({
        forkOwner: "jane-dev",
        forkRepo: UPSTREAM.repo,
        branch: "main",
        token: "ghp_test",
      }),
    ).rejects.toThrow(/merge-upstream conflict/i);
  });

  it("throws with status and body on other non-ok responses", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      errResponse(422, "unprocessable"),
    );

    await expect(
      syncForkFromUpstream({
        forkOwner: "jane-dev",
        forkRepo: UPSTREAM.repo,
        branch: "main",
        token: "ghp_test",
      }),
    ).rejects.toThrow(/422/);
  });
});
