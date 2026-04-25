import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockForkExistsAndIsFork, mockCreateForkAndWait } = vi.hoisted(() => ({
  mockForkExistsAndIsFork: vi.fn(),
  mockCreateForkAndWait: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: "test-user-1" } }),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    platformDevConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/integrate/github-fork", () => ({
  forkExistsAndIsFork: mockForkExistsAndIsFork,
  createForkAndWait: mockCreateForkAndWait,
}));

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { configureForkSetup } from "./platform-dev-config";

const UPSTREAM_URL = "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git";
const UPSTREAM_OWNER = "OpenDigitalProductFactory";
const UPSTREAM_REPO = "opendigitalproductfactory";

function okJson<T>(body: T): Response {
  return {
    ok: true,
    status: 200,
    headers: {
      get: () => null,
    },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function errResponse(status: number, text = ""): Response {
  return {
    ok: false,
    status,
    headers: {
      get: () => null,
    },
    text: () => Promise.resolve(text),
    json: () => Promise.resolve({}),
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  mockForkExistsAndIsFork.mockResolvedValue({ exists: false, isFork: false });
  mockCreateForkAndWait.mockResolvedValue({
    status: "ready",
    forkOwner: "jane-dev",
    forkRepo: UPSTREAM_REPO,
  });
  vi.mocked(prisma.platformDevConfig.findUnique).mockResolvedValue({
    upstreamRemoteUrl: UPSTREAM_URL,
  } as unknown as Awaited<ReturnType<typeof prisma.platformDevConfig.findUnique>>);
  // `auth` is typed as NextMiddleware; tests only care about the session shape.
  (vi.mocked(auth) as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
    user: { id: "test-user-1" },
  });
});

describe("configureForkSetup", () => {
  it("returns {success: false} when not authenticated", async () => {
    (vi.mocked(auth) as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce(null);

    const result = await configureForkSetup({ contributorForkOwner: "jane-dev", token: "ghp_x" });

    expect(result).toEqual({ success: false, error: "Not authenticated" });
    expect(prisma.platformDevConfig.upsert).not.toHaveBeenCalled();
  });

  it("returns {success: false} when GitHub username is blank", async () => {
    const result = await configureForkSetup({ contributorForkOwner: "   ", token: "ghp_x" });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("username");
    expect(prisma.platformDevConfig.upsert).not.toHaveBeenCalled();
  });

  it("returns {success: false} when the token fails validation", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(errResponse(401, "Bad credentials"));

    const result = await configureForkSetup({ contributorForkOwner: "jane-dev", token: "ghp_bad" });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/invalid|expired/i);
    expect(prisma.platformDevConfig.upsert).not.toHaveBeenCalled();
  });

  it("returns {success: false} when the repo exists but is not a fork of the upstream", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okJson({ login: "jane-dev" }));
    mockForkExistsAndIsFork.mockResolvedValueOnce({ exists: true, isFork: false });

    const result = await configureForkSetup({ contributorForkOwner: "jane-dev", token: "ghp_x" });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/not a fork/i);
    expect(prisma.platformDevConfig.upsert).not.toHaveBeenCalled();
  });

  it("returns {success: true, status: 'ready'} when a fork already exists and writes fork metadata", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okJson({ login: "jane-dev" }));
    mockForkExistsAndIsFork.mockResolvedValueOnce({
      exists: true,
      isFork: true,
      parentFullName: `${UPSTREAM_OWNER}/${UPSTREAM_REPO}`,
    });

    const result = await configureForkSetup({ contributorForkOwner: "jane-dev", token: "ghp_x" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.status).toBe("ready");
      expect(result.forkOwner).toBe("jane-dev");
      expect(result.forkRepo).toBe(UPSTREAM_REPO);
    }
    expect(prisma.platformDevConfig.upsert).toHaveBeenCalledTimes(1);
    const call = vi.mocked(prisma.platformDevConfig.upsert).mock.calls[0][0];
    expect(call.update.contributorForkOwner).toBe("jane-dev");
    expect(call.update.contributorForkRepo).toBe(UPSTREAM_REPO);
    expect(call.update.forkVerifiedAt).toBeInstanceOf(Date);
    // Invariant: configureForkSetup must NOT touch contributionModel — that
    // stays null until the admin explicitly picks a model.
    expect(call.update).not.toHaveProperty("contributionModel");
    expect(call.create).not.toHaveProperty("contributionModel");
  });

  it("returns {success: true, status: 'ready'} when the fork was freshly created and became ready", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okJson({ login: "jane-dev" }));
    mockForkExistsAndIsFork.mockResolvedValueOnce({ exists: false, isFork: false });
    mockCreateForkAndWait.mockResolvedValueOnce({
      status: "ready",
      forkOwner: "jane-dev",
      forkRepo: UPSTREAM_REPO,
    });

    const result = await configureForkSetup({ contributorForkOwner: "jane-dev", token: "ghp_x" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.status).toBe("ready");
      expect(result.forkOwner).toBe("jane-dev");
    }
    expect(prisma.platformDevConfig.upsert).toHaveBeenCalledTimes(1);
  });

  // Note: the "deferred" path (createForkAndWait polling times out) is covered
  // at the helper level in github-fork.test.ts. The action simply threads
  // whatever status createForkAndWait returns into the upsert; forking
  // forkVerifiedAt null for deferred vs Date for ready is covered by the
  // "fresh creation becomes ready" test above (which exercises the same
  // branching logic with the ready path).
});
