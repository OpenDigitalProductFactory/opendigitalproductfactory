// apps/web/lib/release-health/release-runs-reader.ts
// BI-3630773C (EP-FULL-OBS) — release verification health surfacing.
//
// Reads the latest release stamp's outcome from the GitHub Actions API.
// A "stamp" is a vX.Y.Z tag push, which triggers the Publish Docker Images
// workflow (.github/workflows/publish-image.yml). That workflow publishes
// images FIRST and runs the E2E install verification gate AFTER — so a red
// run can mean a published-but-unverified release. Distinguishing the two
// failure shapes requires looking at the run's jobs, not just its
// conclusion.
//
// Auth is optional: the upstream repo is public, so unauthenticated reads
// work within GitHub's anonymous rate budget (60/hr — two requests per
// 15-minute poll fits comfortably). When the operator has bound the
// "github-pr-sync" credential (Contributor MCP card), its token is reused
// for the higher budget.

import {
  resolveGithubToken,
  resolveRepoIdentity,
} from "@/lib/contributor-change-lanes/github-rest-reader";

// Workflow file paths are the stable identifiers — run names and display
// titles change; the paths do not.
const PUBLISH_WORKFLOW_PATH = "publish-image.yml";
// Manual-dispatch twin of the publish workflow's verify job. A green
// release-mode run of this workflow that is NEWER than a red stamp is
// superseding evidence: the published release images install green even
// though the stamp run itself stays red forever (re-runs of a tag run
// execute the tag's stale workflow definition, so operators re-verify via
// dispatch instead — exactly the v6.1.0 recovery path).
const DISPATCH_VERIFY_WORKFLOW_PATH = "install-verification.yml";
const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+/;
// The verify job inside the publish workflow; matched by prefix so a
// rename like "(release mode)" → "(release)" doesn't silently reclassify.
const VERIFY_JOB_PREFIX = "E2E install verification";

export type ReleaseStampStatus =
  | "in-progress"
  | "verified"
  | "verify-failed"
  | "publish-failed";

export type ReleaseStampSnapshot = {
  tag: string;
  /** Immutable source revision baked into every image for this release. */
  headSha: string | null;
  runId: number;
  runUrl: string;
  status: ReleaseStampStatus;
  /** Raw workflow-run conclusion ("success" | "failure" | ...), null while running. */
  runConclusion: string | null;
  /** ISO timestamp of the run's last update on GitHub's side. */
  runUpdatedAt: string | null;
};

export type ReleaseRunsResult =
  | { ok: true; latest: ReleaseStampSnapshot | null }
  | { ok: false; error: string };

export type ReleaseRunsDeps = {
  /** Injection point so tests don't fetch real URLs. */
  fetchImpl?: typeof fetch;
};

type RawWorkflowRun = {
  id?: number;
  head_branch?: string | null;
  head_sha?: string | null;
  event?: string;
  status?: string | null;
  conclusion?: string | null;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
};

type RawJob = {
  name?: string;
  conclusion?: string | null;
};

/**
 * Latest release stamp and its publish/verify outcome, or `latest: null`
 * when no vX.Y.Z run exists yet (fresh fork, never stamped).
 */
export async function readLatestReleaseStamp(
  deps: ReleaseRunsDeps = {},
): Promise<ReleaseRunsResult> {
  const { prisma } = await import("@dpf/db");
  const fetchImpl = deps.fetchImpl ?? fetch;

  const repo = await resolveRepoIdentity(prisma);
  const token = await resolveGithubToken(prisma);

  const runsRes = await githubGet(
    fetchImpl,
    token,
    `https://api.github.com/repos/${repo.owner}/${repo.name}/actions/workflows/${PUBLISH_WORKFLOW_PATH}/runs?per_page=10`,
  );
  if (!runsRes.ok) return runsRes;

  const runs = (runsRes.json as { workflow_runs?: RawWorkflowRun[] })
    .workflow_runs;
  const latest = (runs ?? []).find(
    (r) =>
      r.event === "push" &&
      typeof r.head_branch === "string" &&
      RELEASE_TAG_PATTERN.test(r.head_branch) &&
      typeof r.id === "number",
  );
  if (!latest) return { ok: true, latest: null };

  const base: Omit<ReleaseStampSnapshot, "status"> = {
    tag: latest.head_branch as string,
    headSha: latest.head_sha ?? null,
    runId: latest.id as number,
    runUrl:
      latest.html_url ??
      `https://github.com/${repo.owner}/${repo.name}/actions/runs/${latest.id}`,
    runConclusion: latest.conclusion ?? null,
    runUpdatedAt: latest.updated_at ?? null,
  };

  if (latest.status !== "completed") {
    return { ok: true, latest: { ...base, status: "in-progress" } };
  }
  if (latest.conclusion === "success") {
    return { ok: true, latest: { ...base, status: "verified" } };
  }

  // Red run — fetch jobs to tell "publish failed" from "published but the
  // verify gate failed". On jobs-fetch failure return the error rather than
  // guessing: the runner keeps the previous state and retries next tick.
  const jobsRes = await githubGet(
    fetchImpl,
    token,
    `https://api.github.com/repos/${repo.owner}/${repo.name}/actions/runs/${latest.id}/jobs?per_page=100`,
  );
  if (!jobsRes.ok) return jobsRes;

  const jobs = ((jobsRes.json as { jobs?: RawJob[] }).jobs ?? []).map((j) => ({
    name: j.name ?? "",
    conclusion: j.conclusion ?? null,
  }));
  let status: ReleaseStampStatus = classifyRedRun(jobs);

  // A red verify gate can be superseded by a later green release-mode run
  // of the manual-dispatch verification workflow. Best-effort: any failure
  // in this check leaves the stamp verify-failed (alerting too much beats
  // silently clearing a real failure).
  if (
    status === "verify-failed" &&
    (await hasSupersedingDispatchVerification(
      fetchImpl,
      token,
      repo,
      latest.created_at ?? null,
    ))
  ) {
    status = "verified";
  }

  return { ok: true, latest: { ...base, status } };
}

/**
 * True when a release-mode run of install-verification.yml completed green
 * AFTER the (red) stamp run started. Release mode is detected from the job
 * name — the workflow's single job renders as
 * "Linux E2E Install (ubuntu-latest, release)" — because workflow_dispatch
 * inputs are not exposed on the runs API.
 */
async function hasSupersedingDispatchVerification(
  fetchImpl: typeof fetch,
  token: string | null,
  repo: { owner: string; name: string },
  stampCreatedAt: string | null,
): Promise<boolean> {
  if (!stampCreatedAt) return false;
  const stampMs = Date.parse(stampCreatedAt);
  if (Number.isNaN(stampMs)) return false;

  const runsRes = await githubGet(
    fetchImpl,
    token,
    `https://api.github.com/repos/${repo.owner}/${repo.name}/actions/workflows/${DISPATCH_VERIFY_WORKFLOW_PATH}/runs?status=success&per_page=10`,
  );
  if (!runsRes.ok) return false;

  const candidates = (
    (runsRes.json as { workflow_runs?: RawWorkflowRun[] }).workflow_runs ?? []
  ).filter(
    (r) =>
      typeof r.id === "number" &&
      typeof r.created_at === "string" &&
      Date.parse(r.created_at) > stampMs,
  );

  // Newest-first from the API; one jobs fetch on the most recent candidate
  // keeps the rate budget flat. A dev-mode run there simply returns false.
  const newest = candidates[0];
  if (!newest) return false;

  const jobsRes = await githubGet(
    fetchImpl,
    token,
    `https://api.github.com/repos/${repo.owner}/${repo.name}/actions/runs/${newest.id}/jobs?per_page=100`,
  );
  if (!jobsRes.ok) return false;

  const jobs = (jobsRes.json as { jobs?: RawJob[] }).jobs ?? [];
  return jobs.some(
    (j) =>
      (j.name ?? "").includes("release") && j.conclusion === "success",
  );
}

/**
 * Pure classifier for a completed-red run's jobs. "verify-failed" only when
 * every job EXCEPT the verify gate succeeded (or was skipped) — i.e. the
 * images are published and the install verification alone is red. Anything
 * else red means the publish itself did not complete.
 */
export function classifyRedRun(
  jobs: Array<{ name: string; conclusion: string | null }>,
): Extract<ReleaseStampStatus, "verify-failed" | "publish-failed"> {
  let verifyFailed = false;
  for (const job of jobs) {
    const passed = job.conclusion === "success" || job.conclusion === "skipped";
    if (job.name.startsWith(VERIFY_JOB_PREFIX)) {
      if (!passed) verifyFailed = true;
      continue;
    }
    if (!passed) return "publish-failed";
  }
  return verifyFailed ? "verify-failed" : "publish-failed";
}

async function githubGet(
  fetchImpl: typeof fetch,
  token: string | null,
  url: string,
): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "dpf-release-health",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetchImpl(url, { method: "GET", headers });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        error: `GitHub release-run read failed: HTTP ${res.status} ${body.slice(0, 200)}`,
      };
    }
    return { ok: true, json: await res.json() };
  } catch (err) {
    return {
      ok: false,
      error: (err as Error).message ?? "fetch failed",
    };
  }
}
