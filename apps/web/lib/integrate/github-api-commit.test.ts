import { beforeEach, describe, expect, it, vi } from "vitest";

import { createBranchAndPR } from "./github-api-commit";

// Minimal unified-diff shape extractNewFileContent can parse — its regex
// expects exactly one line between "diff --git" and "--- /dev/null", so we
// omit the "index" line (extraneous for this test's purpose, which is the
// API-call shape, not diff-parsing edge cases).
const TINY_DIFF = `diff --git a/hello.txt b/hello.txt
new file mode 100644
--- /dev/null
+++ b/hello.txt
@@ -0,0 +1 @@
+hello world
`;

interface CapturedCall {
  url: string;
  method: string;
  body?: Record<string, unknown>;
}

function setupFetchMock(): { calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    let body: Record<string, unknown> | undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        body = undefined;
      }
    }
    calls.push({ url, method, body });

    // GET base ref → returns a sha
    if (method === "GET" && url.includes("/git/ref/heads/")) {
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ref: "refs/heads/main", object: { sha: "base-sha-abc", type: "commit" } }),
        text: () => Promise.resolve(""),
      } as unknown as Response;
    }
    // POST blobs
    if (method === "POST" && url.endsWith("/git/blobs")) {
      return {
        ok: true,
        status: 201,
        json: () => Promise.resolve({ sha: "blob-sha-1" }),
        text: () => Promise.resolve(""),
      } as unknown as Response;
    }
    // POST trees
    if (method === "POST" && url.endsWith("/git/trees")) {
      return {
        ok: true,
        status: 201,
        json: () => Promise.resolve({ sha: "tree-sha-1" }),
        text: () => Promise.resolve(""),
      } as unknown as Response;
    }
    // POST commits
    if (method === "POST" && url.endsWith("/git/commits")) {
      return {
        ok: true,
        status: 201,
        json: () => Promise.resolve({ sha: "commit-sha-1", html_url: "https://example.com/commit/commit-sha-1" }),
        text: () => Promise.resolve(""),
      } as unknown as Response;
    }
    // POST refs (create branch)
    if (method === "POST" && url.endsWith("/git/refs")) {
      return {
        ok: true,
        status: 201,
        json: () => Promise.resolve({ ref: "refs/heads/test", object: { sha: "commit-sha-1", type: "commit" } }),
        text: () => Promise.resolve(""),
      } as unknown as Response;
    }
    // POST pulls (create PR) — happy path
    if (method === "POST" && url.endsWith("/pulls")) {
      return {
        ok: true,
        status: 201,
        json: () => Promise.resolve({ number: 42, html_url: "https://github.com/base-owner/base-repo/pull/42" }),
        text: () => Promise.resolve(""),
      } as unknown as Response;
    }
    // POST labels
    if (method === "POST" && /\/issues\/\d+\/labels$/.test(url)) {
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
        text: () => Promise.resolve(""),
      } as unknown as Response;
    }

    return {
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(`unexpected url in mock: ${method} ${url}`),
    } as unknown as Response;
  });

  vi.stubGlobal("fetch", fetchMock);
  return { calls };
}

// Prevent the sandbox-workspace read path from polluting the test environment
// by forcing content extraction to come from the diff itself.
vi.mock("@/lib/shared/lazy-node", () => ({
  lazyFsPromises: () => ({
    readFile: vi.fn().mockRejectedValue(new Error("test: no sandbox fs")),
  }),
  lazyPath: () => ({
    resolve: (...segments: string[]) => segments.join("/"),
  }),
}));

describe("createBranchAndPR head/base split", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens a same-repo PR with bare branchName when headOwner === baseOwner", async () => {
    const { calls } = setupFetchMock();

    const result = await createBranchAndPR({
      headOwner: "upstream-org",
      headRepo: "upstream-repo",
      baseOwner: "upstream-org",
      baseRepo: "upstream-repo",
      baseBranch: "main",
      branchName: "feat/tiny",
      commitMessage: "feat: tiny",
      diff: TINY_DIFF,
      prTitle: "feat: tiny",
      prBody: "body",
      labels: ["ai-contributed"],
      token: "ghp_test",
    });

    const prPost = calls.find((c) => c.method === "POST" && c.url.endsWith("/pulls"));
    expect(prPost, "PR POST must happen").toBeDefined();
    expect(prPost!.url).toBe("https://api.github.com/repos/upstream-org/upstream-repo/pulls");
    expect(prPost!.body!.head).toBe("feat/tiny"); // bare branch name for same-repo
    expect(prPost!.body!.base).toBe("main");

    expect(result.prUrl).toBe("https://github.com/base-owner/base-repo/pull/42");
    expect(result.prNumber).toBe(42);
  });

  it("opens a cross-repo PR with '<headOwner>:<branchName>' when headOwner !== baseOwner", async () => {
    const { calls } = setupFetchMock();

    const result = await createBranchAndPR({
      headOwner: "jane-dev",
      headRepo: "opendigitalproductfactory",
      baseOwner: "OpenDigitalProductFactory",
      baseRepo: "opendigitalproductfactory",
      baseBranch: "main",
      branchName: "dpf/a1b2c3d4/feat-tiny",
      commitMessage: "feat: tiny",
      diff: TINY_DIFF,
      prTitle: "feat: tiny",
      prBody: "body",
      labels: ["ai-contributed"],
      token: "ghp_test",
    });

    const prPost = calls.find((c) => c.method === "POST" && c.url.endsWith("/pulls"));
    expect(prPost, "PR POST must happen").toBeDefined();
    // PR POST target is the BASE repo (upstream), not the head repo (fork).
    expect(prPost!.url).toBe(
      "https://api.github.com/repos/OpenDigitalProductFactory/opendigitalproductfactory/pulls",
    );
    expect(prPost!.body!.head).toBe("jane-dev:dpf/a1b2c3d4/feat-tiny");
    expect(prPost!.body!.base).toBe("main");

    expect(result.prUrl).toBe("https://github.com/base-owner/base-repo/pull/42");
  });

  it("creates blobs / tree / commit / ref on the HEAD repo (not base) in cross-repo mode", async () => {
    const { calls } = setupFetchMock();

    await createBranchAndPR({
      headOwner: "jane-dev",
      headRepo: "opendigitalproductfactory",
      baseOwner: "OpenDigitalProductFactory",
      baseRepo: "opendigitalproductfactory",
      baseBranch: "main",
      branchName: "dpf/a1b2c3d4/feat-tiny",
      commitMessage: "feat: tiny",
      diff: TINY_DIFF,
      prTitle: "feat: tiny",
      prBody: "body",
      labels: [],
      token: "ghp_test",
    });

    const headRepoBase = "https://api.github.com/repos/jane-dev/opendigitalproductfactory";

    expect(calls.find((c) => c.method === "GET" && c.url === `${headRepoBase}/git/ref/heads/main`), "base ref read from HEAD repo").toBeDefined();
    expect(calls.find((c) => c.method === "POST" && c.url === `${headRepoBase}/git/blobs`), "blob POST to HEAD").toBeDefined();
    expect(calls.find((c) => c.method === "POST" && c.url === `${headRepoBase}/git/trees`), "tree POST to HEAD").toBeDefined();
    expect(calls.find((c) => c.method === "POST" && c.url === `${headRepoBase}/git/commits`), "commit POST to HEAD").toBeDefined();
    expect(calls.find((c) => c.method === "POST" && c.url === `${headRepoBase}/git/refs`), "ref POST to HEAD").toBeDefined();
  });

  it("POSTs labels to the BASE repo's issue (not the HEAD repo's)", async () => {
    const { calls } = setupFetchMock();

    await createBranchAndPR({
      headOwner: "jane-dev",
      headRepo: "opendigitalproductfactory",
      baseOwner: "OpenDigitalProductFactory",
      baseRepo: "opendigitalproductfactory",
      baseBranch: "main",
      branchName: "dpf/a1b2c3d4/feat-tiny",
      commitMessage: "feat: tiny",
      diff: TINY_DIFF,
      prTitle: "feat: tiny",
      prBody: "body",
      labels: ["ai-contributed", "build-studio"],
      token: "ghp_test",
    });

    const labelPost = calls.find((c) => c.method === "POST" && /\/issues\/\d+\/labels$/.test(c.url));
    expect(labelPost, "label POST must happen when labels are provided").toBeDefined();
    expect(labelPost!.url).toBe(
      "https://api.github.com/repos/OpenDigitalProductFactory/opendigitalproductfactory/issues/42/labels",
    );
    expect(labelPost!.body!.labels).toEqual(["ai-contributed", "build-studio"]);
  });
});
