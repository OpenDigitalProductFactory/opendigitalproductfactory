import { spawnSync } from "node:child_process";

/**
 * BI-E2669F37. Local convergence-impact used to see commit messages only.
 * CI also sees the pull request body, so a stale Convergence-Impact-Decision
 * there passed pregate and failed Policy Guards.
 *
 * No open pull request, or gh itself failing, is a skip. It is not a preflight
 * failure: a branch with no PR still has to be able to gate.
 */
export function parsePullRequestView({ status, stdout = "" } = {}) {
  if (status !== 0) return { included: false, reason: "gh-failed" };
  let parsed;
  try {
    parsed = JSON.parse(String(stdout));
  } catch {
    return { included: false, reason: "unparseable" };
  }
  if (!parsed || parsed.state !== "OPEN") return { included: false, reason: "not-open" };
  if (typeof parsed.body !== "string") return { included: false, reason: "no-body" };
  return { included: true, body: parsed.body };
}

export function readPullRequestBody({
  branch,
  spawnSyncImpl = spawnSync,
  ghBin = "gh",
  cwd,
} = {}) {
  if (!branch || branch === "HEAD") return { included: false, reason: "no-branch" };
  let result;
  try {
    result = spawnSyncImpl(ghBin, ["pr", "view", branch, "--json", "body,state"], {
      cwd,
      encoding: "utf8",
      shell: false,
    });
  } catch {
    return { included: false, reason: "gh-failed" };
  }
  if (!result) return { included: false, reason: "gh-failed" };
  return parsePullRequestView({ status: result.status, stdout: result.stdout });
}
