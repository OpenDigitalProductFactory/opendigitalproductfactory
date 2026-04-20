import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockReadFile, mockBuild } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockReadFile: vi.fn(),
  mockBuild: { findUnique: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("node:fs/promises", () => ({ readFile: mockReadFile }));
vi.mock("@dpf/db", () => ({ prisma: { featureBuild: mockBuild } }));

// Import under test AFTER mocks are registered
import { GET } from "./route";

const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

beforeEach(() => {
  mockAuth.mockReset();
  mockReadFile.mockReset();
  mockBuild.findUnique.mockReset();
});

async function call(buildId: string, fileName: string) {
  const params = Promise.resolve({ buildId, fileName });
  return GET(new Request("http://localhost/ignored"), { params });
}

describe("GET /api/build/:buildId/evidence/:fileName", () => {
  it("returns 400 when buildId contains path-traversal characters", async () => {
    const res = await call("../../etc", "0.png");
    expect(res.status).toBe(400);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("returns 400 when fileName is not a bare .png name", async () => {
    const res = await call("FB-ABC", "../../etc/passwd");
    expect(res.status).toBe(400);
  });

  it("returns 400 when fileName exceeds 64 chars", async () => {
    const longName = `${"a".repeat(70)}.png`;
    const res = await call("FB-ABC", longName);
    expect(res.status).toBe(400);
  });

  it("returns 401 when there's no session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await call("FB-ABC", "0.png");
    expect(res.status).toBe(401);
  });

  it("returns 404 when the build doesn't exist", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", isSuperuser: false } });
    mockBuild.findUnique.mockResolvedValue(null);
    const res = await call("FB-ABC", "0.png");
    expect(res.status).toBe(404);
  });

  it("returns 403 when the caller does not own the build", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", isSuperuser: false } });
    mockBuild.findUnique.mockResolvedValue({ createdById: "u2" });
    const res = await call("FB-ABC", "0.png");
    expect(res.status).toBe(403);
  });

  it("returns 200 with image/png when the caller owns the build", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", isSuperuser: false } });
    mockBuild.findUnique.mockResolvedValue({ createdById: "u1" });
    mockReadFile.mockResolvedValue(pngBytes);
    const res = await call("FB-ABC", "0.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
  });

  it("returns 404 when the file is missing on disk", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", isSuperuser: false } });
    mockBuild.findUnique.mockResolvedValue({ createdById: "u1" });
    mockReadFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    const res = await call("FB-ABC", "0.png");
    expect(res.status).toBe(404);
  });

  it("lets superusers read any build's evidence", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin", isSuperuser: true } });
    mockBuild.findUnique.mockResolvedValue({ createdById: "someone-else" });
    mockReadFile.mockResolvedValue(pngBytes);
    const res = await call("FB-ABC", "0.png");
    expect(res.status).toBe(200);
  });
});
