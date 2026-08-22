import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  platformDevConfig: { findUnique: vi.fn() },
  credentialEntry: { findUnique: vi.fn() },
  scheduledJob: { findUnique: vi.fn(), update: vi.fn() },
}));

vi.mock("@dpf/db", () => ({ prisma: db }));

import { classifyRedRun, readLatestReleaseStamp } from "./release-runs-reader";

// The v6.1.0 incident shape: every build/merge job green, verify gate red.
const PUBLISHED_UNVERIFIED_JOBS = [
  { name: "Typecheck gate", conclusion: "success" },
  { name: "Build dpf-portal (amd64)", conclusion: "success" },
  { name: "Merge dpf-portal manifest", conclusion: "success" },
  { name: "E2E install verification (release mode)", conclusion: "failure" },
];

describe("classifyRedRun", () => {
  it("classifies verify-gate-only failure as verify-failed (published unverified)", () => {
    expect(classifyRedRun(PUBLISHED_UNVERIFIED_JOBS)).toBe("verify-failed");
  });

  it("classifies a red build job as publish-failed even when verify also failed", () => {
    expect(
      classifyRedRun([
        { name: "Build dpf-portal (amd64)", conclusion: "failure" },
        { name: "E2E install verification (release mode)", conclusion: "failure" },
      ]),
    ).toBe("publish-failed");
  });

  it("classifies an all-green-but-cancelled-verify run as verify-failed", () => {
    expect(
      classifyRedRun([
        { name: "Build dpf-portal (amd64)", conclusion: "success" },
        { name: "E2E install verification (release mode)", conclusion: "cancelled" },
      ]),
    ).toBe("verify-failed");
  });

  it("treats skipped non-verify jobs as passing", () => {
    expect(
      classifyRedRun([
        { name: "Build dpf-portal (amd64)", conclusion: "success" },
        { name: "signoff", conclusion: "skipped" },
        { name: "E2E install verification (release mode)", conclusion: "failure" },
      ]),
    ).toBe("verify-failed");
  });

  it("falls back to publish-failed when no job explains the red run", () => {
    expect(
      classifyRedRun([{ name: "Build dpf-portal (amd64)", conclusion: "success" }]),
    ).toBe("publish-failed");
  });
});

describe("readLatestReleaseStamp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.platformDevConfig.findUnique.mockResolvedValue(null);
    db.credentialEntry.findUnique.mockResolvedValue(null);
  });

  function runsResponse(runs: unknown[]) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ workflow_runs: runs }),
    } as unknown as Response;
  }

  function jobsResponse(jobs: unknown[]) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ jobs }),
    } as unknown as Response;
  }

  const greenRun = {
    id: 100,
    head_sha: "a".repeat(40),
    head_branch: "v6.1.0",
    event: "push",
    status: "completed",
    conclusion: "success",
    html_url: "https://github.com/o/r/actions/runs/100",
    created_at: "2026-06-10T01:38:00Z",
    updated_at: "2026-06-10T02:00:00Z",
  };

  it("returns the latest v-tag run as verified on success, without a jobs fetch", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(runsResponse([greenRun]));
    const result = await readLatestReleaseStamp({ fetchImpl });
    expect(result).toEqual({
      ok: true,
      latest: {
        tag: "v6.1.0",
        headSha: "a".repeat(40),
        runId: 100,
        runUrl: "https://github.com/o/r/actions/runs/100",
        status: "verified",
        runConclusion: "success",
        runUpdatedAt: "2026-06-10T02:00:00Z",
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // No credential bound — request must go out unauthenticated.
    const headers = fetchImpl.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("skips non-release runs (branch pushes, workflow_dispatch) when finding the stamp", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      runsResponse([
        { ...greenRun, id: 102, head_branch: "main", event: "push" },
        { ...greenRun, id: 101, head_branch: "v6.0.0", event: "workflow_dispatch" },
        { ...greenRun, id: 100 },
      ]),
    );
    const result = await readLatestReleaseStamp({ fetchImpl });
    expect(result.ok && result.latest?.runId).toBe(100);
  });

  it("returns latest: null when no release stamp exists", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(runsResponse([]));
    const result = await readLatestReleaseStamp({ fetchImpl });
    expect(result).toEqual({ ok: true, latest: null });
  });

  it("reports in-progress runs without fetching jobs", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      runsResponse([{ ...greenRun, status: "in_progress", conclusion: null }]),
    );
    const result = await readLatestReleaseStamp({ fetchImpl });
    expect(result.ok && result.latest?.status).toBe("in-progress");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("classifies a red run via its jobs (verify-failed shape)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        runsResponse([{ ...greenRun, conclusion: "failure" }]),
      )
      .mockResolvedValueOnce(jobsResponse(PUBLISHED_UNVERIFIED_JOBS))
      // Superseding-dispatch check: no green dispatch runs exist.
      .mockResolvedValueOnce(runsResponse([]));
    const result = await readLatestReleaseStamp({ fetchImpl });
    expect(result.ok && result.latest?.status).toBe("verify-failed");
    expect(String(fetchImpl.mock.calls[1]![0])).toContain("/actions/runs/100/jobs");
    expect(String(fetchImpl.mock.calls[2]![0])).toContain(
      "/actions/workflows/install-verification.yml/runs",
    );
  });

  it("upgrades verify-failed to verified when a newer green release-mode dispatch run exists", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        runsResponse([{ ...greenRun, conclusion: "failure" }]),
      )
      .mockResolvedValueOnce(jobsResponse(PUBLISHED_UNVERIFIED_JOBS))
      .mockResolvedValueOnce(
        runsResponse([
          { id: 555, created_at: "2026-06-10T02:30:00Z", status: "completed", conclusion: "success" },
        ]),
      )
      .mockResolvedValueOnce(
        jobsResponse([
          { name: "Linux E2E Install (ubuntu-latest, release)", conclusion: "success" },
        ]),
      );
    const result = await readLatestReleaseStamp({ fetchImpl });
    expect(result.ok && result.latest?.status).toBe("verified");
  });

  it("does not let a dev-mode dispatch run supersede a red verify gate", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        runsResponse([{ ...greenRun, conclusion: "failure" }]),
      )
      .mockResolvedValueOnce(jobsResponse(PUBLISHED_UNVERIFIED_JOBS))
      .mockResolvedValueOnce(
        runsResponse([
          { id: 555, created_at: "2026-06-10T02:30:00Z", status: "completed", conclusion: "success" },
        ]),
      )
      .mockResolvedValueOnce(
        jobsResponse([
          { name: "Linux E2E Install (ubuntu-latest, dev)", conclusion: "success" },
        ]),
      );
    const result = await readLatestReleaseStamp({ fetchImpl });
    expect(result.ok && result.latest?.status).toBe("verify-failed");
  });

  it("ignores dispatch runs that predate the red stamp", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        runsResponse([{ ...greenRun, conclusion: "failure" }]),
      )
      .mockResolvedValueOnce(jobsResponse(PUBLISHED_UNVERIFIED_JOBS))
      .mockResolvedValueOnce(
        runsResponse([
          { id: 444, created_at: "2026-06-09T00:00:00Z", status: "completed", conclusion: "success" },
        ]),
      );
    const result = await readLatestReleaseStamp({ fetchImpl });
    expect(result.ok && result.latest?.status).toBe("verify-failed");
    // No jobs fetch for a too-old candidate.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("keeps verify-failed when the superseding check itself errors (best-effort)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        runsResponse([{ ...greenRun, conclusion: "failure" }]),
      )
      .mockResolvedValueOnce(jobsResponse(PUBLISHED_UNVERIFIED_JOBS))
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "boom",
      } as unknown as Response);
    const result = await readLatestReleaseStamp({ fetchImpl });
    expect(result.ok && result.latest?.status).toBe("verify-failed");
  });

  it("propagates API errors instead of guessing a status", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => "rate limited",
    } as unknown as Response);
    const result = await readLatestReleaseStamp({ fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("HTTP 403");
  });

  it("sends the bound github-pr-sync token when one is active", async () => {
    db.credentialEntry.findUnique.mockResolvedValue({
      secretRef: "plain-token",
      status: "active",
    });
    const fetchImpl = vi.fn().mockResolvedValueOnce(runsResponse([greenRun]));
    await readLatestReleaseStamp({ fetchImpl });
    const headers = fetchImpl.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer plain-token");
  });
});
