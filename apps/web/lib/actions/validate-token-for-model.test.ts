import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { validateGitHubTokenForModel } from "./platform-dev-config";

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

describe("validateGitHubTokenForModel — maintainer-direct", () => {
  it("returns valid when the token has push access to upstream", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(okJson({ login: "mark" })); // /user
    fetchMock.mockResolvedValueOnce(okJson({ permissions: { push: true } })); // /repos/...

    const result = await validateGitHubTokenForModel({
      token: "ghp_x",
      model: "maintainer-direct",
      upstreamOwner: "OpenDigitalProductFactory",
      upstreamRepo: "opendigitalproductfactory",
    });

    expect(result.valid).toBe(true);
    expect(result.username).toBe("mark");
  });

  it("returns invalid when the token has no push permission on upstream", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(okJson({ login: "mark" }));
    fetchMock.mockResolvedValueOnce(okJson({ permissions: { push: false } }));

    const result = await validateGitHubTokenForModel({
      token: "ghp_x",
      model: "maintainer-direct",
      upstreamOwner: "OpenDigitalProductFactory",
      upstreamRepo: "opendigitalproductfactory",
    });

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/push access/i);
  });

  it("returns invalid when the token cannot read upstream at all (private repo or revoked)", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(okJson({ login: "mark" }));
    fetchMock.mockResolvedValueOnce(errResponse(404));

    const result = await validateGitHubTokenForModel({
      token: "ghp_x",
      model: "maintainer-direct",
      upstreamOwner: "OpenDigitalProductFactory",
      upstreamRepo: "opendigitalproductfactory",
    });

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/cannot read/i);
  });

  it("returns invalid when upstreamOwner/upstreamRepo are missing", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(okJson({ login: "mark" }));

    const result = await validateGitHubTokenForModel({
      token: "ghp_x",
      model: "maintainer-direct",
    });

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/upstreamOwner/);
  });
});

describe("validateGitHubTokenForModel — fork-pr", () => {
  it("returns valid when token owner matches fork owner", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okJson({ login: "jane-dev" }));

    const result = await validateGitHubTokenForModel({
      token: "ghp_x",
      model: "fork-pr",
      expectedOwner: "jane-dev",
    });

    expect(result.valid).toBe(true);
    expect(result.username).toBe("jane-dev");
  });

  it("is case-insensitive on owner match", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okJson({ login: "Jane-Dev" }));

    const result = await validateGitHubTokenForModel({
      token: "ghp_x",
      model: "fork-pr",
      expectedOwner: "jane-dev",
    });

    expect(result.valid).toBe(true);
  });

  it("returns invalid when token owner does not match fork owner and machineUser is false", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okJson({ login: "someone-else" }));

    const result = await validateGitHubTokenForModel({
      token: "ghp_x",
      model: "fork-pr",
      expectedOwner: "jane-dev",
      machineUser: false,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/does not match fork owner/i);
  });

  it("returns valid when token owner does not match but machineUser=true", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okJson({ login: "dpf-bot" }));

    const result = await validateGitHubTokenForModel({
      token: "ghp_x",
      model: "fork-pr",
      expectedOwner: "jane-dev",
      machineUser: true,
    });

    expect(result.valid).toBe(true);
    expect(result.username).toBe("dpf-bot");
  });

  it("returns invalid when expectedOwner is missing and machineUser is not true", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okJson({ login: "jane-dev" }));

    const result = await validateGitHubTokenForModel({
      token: "ghp_x",
      model: "fork-pr",
    });

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/expectedOwner|machineUser/);
  });
});

describe("validateGitHubTokenForModel — basic token failure", () => {
  it("returns invalid short-circuit when the /user call fails", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(errResponse(401, "Bad credentials"));

    const result = await validateGitHubTokenForModel({
      token: "ghp_bad",
      model: "fork-pr",
      expectedOwner: "jane-dev",
    });

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/invalid|expired/i);
    // Only one fetch call — the /user check — because we short-circuit.
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
  });
});
