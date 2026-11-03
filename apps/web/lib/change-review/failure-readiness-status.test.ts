import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ room: vi.fn(), token: vi.fn(), repo: vi.fn(), verdict: vi.fn(), fetch: vi.fn(), close: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { workroom: { findUnique: mocks.room } } }));
vi.mock("@/lib/contributor-change-lanes/github-rest-reader", () => ({ resolveGithubToken: mocks.token, resolveRepoIdentity: mocks.repo,
  createGithubReadTransport: () => ({ fetch: mocks.fetch, close: mocks.close }) }));
vi.mock("./failure-readiness-publication", () => ({ checkWorkroomFailureReadiness: mocks.verdict }));
import { isWorkroomStatusPublishable, publishFailureReadinessStatus } from "./failure-readiness-status";
const sha = "a".repeat(40);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.room.mockResolvedValue({ headSha: sha, repositoryFullName: "owner/repo" });
  mocks.repo.mockResolvedValue({ owner: "owner", name: "repo" });
  mocks.token.mockResolvedValue("test-credential");
  mocks.verdict.mockResolvedValue({ mayPublish: true, sourceHeadSha: sha, reason: "Executed evidence independently reviewed" });
  mocks.fetch.mockResolvedValue({ ok: true, body: { cancel: vi.fn() } });
});
describe("GitHub failure readiness publication", () => {
  it("publishes only to the final source commit", async () => {
    await publishFailureReadinessStatus("room");
    expect(mocks.fetch).toHaveBeenCalledWith(`https://api.github.com/repos/owner/repo/statuses/${sha}`, expect.objectContaining({ body: expect.stringContaining('"state":"success"') }));
  });
  it("publishes a refusal without implying owner approval", async () => {
    mocks.verdict.mockResolvedValue({ mayPublish: false, reason: "Internal review recovery required" });
    await publishFailureReadinessStatus("room");
    expect(mocks.fetch.mock.calls[0][1].body).toContain('"state":"failure"');
  });
  it("does not publish if the room changes during validation", async () => {
    mocks.verdict.mockResolvedValue({ mayPublish: true, sourceHeadSha: "b".repeat(40), reason: "Newer change reviewed" });
    await expect(publishFailureReadinessStatus("room")).rejects.toThrow("changed");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("preserves credential and repository boundaries", async () => {
    mocks.token.mockResolvedValue(null);
    await expect(publishFailureReadinessStatus("room")).rejects.toThrow("unavailable");
    mocks.room.mockResolvedValue({ headSha: sha, repositoryFullName: "peer/repo" });
    await expect(publishFailureReadinessStatus("room")).rejects.toThrow("mismatch");
  });
  it("retries a lost status response on the same commit without reviewer inference", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("response lost"));
    await expect(publishFailureReadinessStatus("room")).rejects.toThrow("response lost");
    await publishFailureReadinessStatus("room");
    expect(mocks.fetch.mock.calls[0][0]).toBe(mocks.fetch.mock.calls[1][0]);
    expect(mocks.close).toHaveBeenCalledTimes(2);
  });
});

describe("re-running the Failure Readiness check after publication", () => {
  const runsUrl = `https://api.github.com/repos/owner/repo/actions/runs?head_sha=${sha}&status=failure&per_page=100`;
  const run = (id: number, path: string, event = "pull_request") => ({ id, path, event });
  function respond(runs: unknown[], rerunOk = true) {
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url === runsUrl) return { ok: true, json: async () => ({ workflow_runs: runs }), body: { cancel: vi.fn() } };
      if (url.endsWith("/rerun-failed-jobs")) return { ok: rerunOk, status: rerunOk ? 201 : 403, body: { cancel: vi.fn() } };
      return { ok: true, body: { cancel: vi.fn() } };
    });
  }
  it("re-runs only the failed pull-request Failure Readiness runs for the published commit", async () => {
    respond([run(1, ".github/workflows/failure-readiness.yml"), run(2, ".github/workflows/ci.yml"), run(3, ".github/workflows/failure-readiness.yml", "merge_group")]);
    expect(await publishFailureReadinessStatus("room")).toEqual({ rerunRunIds: [1] });
    const reruns = mocks.fetch.mock.calls.filter(([url]) => String(url).endsWith("/rerun-failed-jobs"));
    expect(reruns.map(([url]) => url)).toEqual(["https://api.github.com/repos/owner/repo/actions/runs/1/rerun-failed-jobs"]);
    expect(reruns[0][1]).toMatchObject({ method: "POST" });
  });
  it("does not re-run after publishing a failure verdict", async () => {
    mocks.verdict.mockResolvedValue({ mayPublish: false, reason: "Internal review recovery required" });
    respond([run(1, ".github/workflows/failure-readiness.yml")]);
    expect(await publishFailureReadinessStatus("room")).toEqual({ rerunRunIds: [] });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps the published status when the re-run is refused, and says so", async () => {
    respond([run(1, ".github/workflows/failure-readiness.yml")], false);
    expect(await publishFailureReadinessStatus("room")).toMatchObject({ rerunRunIds: [], rerunError: expect.stringContaining("403") });
  });
});

describe("isWorkroomStatusPublishable", () => {
  it("is publishable only with an immutable commit and a repository", async () => {
    expect(await isWorkroomStatusPublishable("room")).toEqual({ publishable: true });
    mocks.room.mockResolvedValue({ headSha: null, repositoryFullName: "owner/repo" });
    expect(await isWorkroomStatusPublishable("room")).toMatchObject({ publishable: false, reason: expect.stringContaining("no immutable source commit") });
    mocks.room.mockResolvedValue({ headSha: sha, repositoryFullName: null });
    expect(await isWorkroomStatusPublishable("room")).toMatchObject({ publishable: false, reason: expect.stringContaining("not bound to a repository") });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
