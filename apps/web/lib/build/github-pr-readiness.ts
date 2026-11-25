/**
 * Shared GitHub pull-request readiness and merge-queue actuation.
 *
 * Read decisions are exact-head and fail closed. Mutations are intentionally
 * limited to update-branch (compare-and-swap), enable-auto-merge and re-running
 * a workflow run's failed jobs (BI-88341B5D); this module has no direct merge,
 * force-push or check-dismissal operation.
 */

const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";
const GITHUB_API_VERSION = "2022-11-28";

export type GithubCheckObservation = {
  name: string;
  status: string;
  conclusion: string | null;
  /** The check run's page (the failing run's log), when GitHub reports one. */
  detailsUrl?: string | null;
  /** The Actions workflow run behind a check run, so its failed jobs can be re-run. */
  workflowRunId?: number | null;
  /**
   * Whether branch protection requires this check for the PR (GitHub's isRequired).
   * Absent when GitHub did not say; an unknown check is treated as required.
   */
  required?: boolean;
};

/**
 * Only required checks decide whether a PR can merge, as in GitHub's merge
 * queue (BI-D081EDD0). A check whose required-ness is unknown still counts.
 */
export function checkBlocksMerge(check: GithubCheckObservation): boolean {
  return check.required !== false;
}

export type GithubQueueFailure = { name: string; conclusion: string; url: string | null };

export type GithubQueueEvent = {
  kind: "removed" | "disarmed" | "entry-unconfirmed";
  id: string;
  at: string;
  reason: string;
  groupHeadSha: string | null;
  failingChecks: GithubQueueFailure[];
};

export type GithubPrObservation = {
  nodeId: string;
  number: number;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  merged: boolean;
  headSha: string;
  mergeStateStatus: string | null;
  unresolvedReviewThreads: number;
  reviewThreadsComplete: boolean;
  checksComplete: boolean;
  checks: GithubCheckObservation[];
  autoMergeEnabled: boolean;
  autoMergeEnabledAt?: string | null;
  mergeQueueEntry: boolean;
  changesRequested?: boolean;
  queueEvent?: GithubQueueEvent | null;
};

export type GithubPrReadiness =
  | { kind: "ready" | "behind" | "conflict" | "queued" | "armed" | "merged" | "closed"; headSha: string }
  | { kind: "queue-hold"; headSha: string; event: GithubQueueEvent }
  | { kind: "checking" | "unknown"; headSha: string | null; reason: string };

const PASSING_CHECK_CONCLUSIONS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

export function projectGithubPrReadiness(observation: GithubPrObservation): GithubPrReadiness {
  const headSha = observation.headSha.trim();
  if (!headSha) return { kind: "unknown", headSha: null, reason: "missing-head-sha" };
  if (observation.merged || observation.state === "MERGED") return { kind: "merged", headSha };
  if (observation.state === "CLOSED") return { kind: "closed", headSha };
  if (observation.mergeQueueEntry) return { kind: "queued", headSha };
  if (observation.changesRequested) return { kind: "checking", headSha, reason: "changes-requested" };
  // A lingering auto-merge request from before the queue event is not fresh intent.
  const event = observation.queueEvent;
  const enabledAfterEvent = event && Date.parse(observation.autoMergeEnabledAt ?? "") > Date.parse(event.at);
  if (observation.autoMergeEnabled && (!event || enabledAfterEvent)) return { kind: "armed", headSha };
  if (event) return { kind: "queue-hold", headSha, event };

  const mergeState = (observation.mergeStateStatus ?? "").toUpperCase();
  if (mergeState === "DIRTY") return { kind: "conflict", headSha };
  if (mergeState === "BEHIND") return { kind: "behind", headSha };

  if (!observation.reviewThreadsComplete) {
    return { kind: "checking", headSha, reason: "review-threads-incomplete" };
  }
  if (observation.unresolvedReviewThreads > 0) {
    return { kind: "checking", headSha, reason: "review-threads-unresolved" };
  }
  if (!observation.checksComplete) {
    return { kind: "checking", headSha, reason: "checks-incomplete" };
  }
  // Non-required checks (for example GitHub's Code Quality scans) neither hold
  // nor block a PR; GitHub's merge queue does not wait on them either.
  const blocking = observation.checks.filter(checkBlocksMerge);
  if (blocking.some((check) => check.status.toUpperCase() !== "COMPLETED")) {
    return { kind: "checking", headSha, reason: "checks-pending" };
  }
  if (
    blocking.some(
      (check) => !check.conclusion || !PASSING_CHECK_CONCLUSIONS.has(check.conclusion.toUpperCase()),
    )
  ) {
    return { kind: "checking", headSha, reason: "checks-failing" };
  }
  if (!["CLEAN", "HAS_HOOKS", "UNSTABLE"].includes(mergeState)) {
    return { kind: "unknown", headSha, reason: "merge-state-unknown" };
  }
  return { kind: "ready", headSha };
}

type GithubGraphqlEnvelope<T> = { data?: T; errors?: Array<{ message?: string }> };

export async function githubGraphql<T>(input: {
  token: string;
  query: string;
  variables: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}): Promise<T> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(GITHUB_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
      "User-Agent": "dpf-github-pr-readiness",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
    body: JSON.stringify({ query: input.query, variables: input.variables }),
  });
  if (!response.ok) throw new Error(`GitHub GraphQL HTTP ${response.status}`);
  const envelope = (await response.json()) as GithubGraphqlEnvelope<T>;
  if (envelope.errors?.length) {
    throw new Error(`GitHub GraphQL error: ${envelope.errors[0]?.message ?? "unknown"}`);
  }
  if (!envelope.data) throw new Error("GitHub GraphQL returned no data");
  return envelope.data;
}

const PR_OBSERVATION_QUERY = `
query DpfPullRequestReadiness($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      id number url state merged headRefOid mergeStateStatus reviewDecision
      latestReviews(first:100){ nodes { state } pageInfo { hasNextPage } }
      autoMergeRequest { enabledAt }
      mergeQueueEntry { id }
      timelineItems(last:1,itemTypes:[ADDED_TO_MERGE_QUEUE_EVENT,REMOVED_FROM_MERGE_QUEUE_EVENT,AUTO_MERGE_DISABLED_EVENT]){
        nodes {
          __typename
          ... on AddedToMergeQueueEvent { id createdAt }
          ... on AutoMergeDisabledEvent { id createdAt }
          ... on RemovedFromMergeQueueEvent {
            id createdAt reason
            beforeCommit {
              oid
              statusCheckRollup { contexts(first:50) { nodes {
                ... on CheckRun { name status conclusion detailsUrl }
                ... on StatusContext { context state targetUrl }
              } } }
            }
          }
        }
      }
      reviewThreads(first:100){ nodes { isResolved } pageInfo { hasNextPage } }
      commits(last:1){
        nodes {
          commit {
            statusCheckRollup {
              contexts(first:100) {
                nodes {
                  ... on CheckRun { name status conclusion detailsUrl isRequired(pullRequestNumber:$number) checkSuite { workflowRun { databaseId } } }
                  ... on StatusContext { context state targetUrl isRequired(pullRequestNumber:$number) }
                }
                pageInfo { hasNextPage }
              }
            }
          }
        }
      }
    }
  }
}`;

type QueueTimelineNode = {
  __typename?: string;
  id?: string;
  createdAt?: string;
  reason?: string | null;
  beforeCommit?: {
    oid?: string;
    statusCheckRollup?: { contexts?: { nodes?: Array<{
      name?: string; status?: string; conclusion?: string | null; detailsUrl?: string | null;
      context?: string; state?: string; targetUrl?: string | null;
    } | null> } | null } | null;
  } | null;
};

function readQueueEvent(node: QueueTimelineNode | null | undefined): GithubQueueEvent | null {
  if (!node?.id || !node.createdAt) return null;
  const kind = node.__typename === "RemovedFromMergeQueueEvent" ? "removed"
    : node.__typename === "AutoMergeDisabledEvent" ? "disarmed"
    : node.__typename === "AddedToMergeQueueEvent" ? "entry-unconfirmed" : null;
  if (!kind) return null;
  const failingChecks = (node.beforeCommit?.statusCheckRollup?.contexts?.nodes ?? []).flatMap((check) => {
    if (!check) return [];
    const name = check.name ?? check.context;
    const conclusion = check.context ? check.state : check.status === "COMPLETED" ? check.conclusion : null;
    if (!name || !conclusion || ["EXPECTED", "PENDING"].includes(conclusion)
      || PASSING_CHECK_CONCLUSIONS.has(conclusion)) return [];
    return [{ name, conclusion, url: check.detailsUrl ?? check.targetUrl ?? null }];
  }).slice(0, 12);
  return {
    kind, id: node.id, at: node.createdAt,
    reason: node.reason || kind,
    groupHeadSha: node.beforeCommit?.oid ?? null,
    failingChecks,
  };
}

type ObservationQueryData = {
  repository?: {
    pullRequest?: {
      id?: string;
      number?: number;
      url?: string;
      state?: "OPEN" | "CLOSED" | "MERGED";
      merged?: boolean;
      headRefOid?: string;
      mergeStateStatus?: string | null;
      reviewDecision?: string | null;
      latestReviews?: { nodes?: Array<{ state?: string } | null>; pageInfo?: { hasNextPage?: boolean } } | null;
      autoMergeRequest?: { enabledAt?: string } | null;
      mergeQueueEntry?: { id?: string } | null;
      timelineItems?: { nodes?: Array<QueueTimelineNode | null> } | null;
      reviewThreads?: {
        nodes?: Array<{ isResolved?: boolean } | null>;
        pageInfo?: { hasNextPage?: boolean };
      };
      commits?: {
        nodes?: Array<{
          commit?: {
            statusCheckRollup?: {
              contexts?: {
                nodes?: Array<{
                  name?: string;
                  status?: string;
                  conclusion?: string | null;
                  context?: string;
                  state?: string;
                  detailsUrl?: string | null;
                  targetUrl?: string | null;
                  checkSuite?: { workflowRun?: { databaseId?: number | null } | null } | null;
                  isRequired?: boolean | null;
                } | null>;
                pageInfo?: { hasNextPage?: boolean };
              };
            } | null;
          };
        } | null>;
      };
    } | null;
  } | null;
};

export async function observeGithubPullRequest(input: {
  owner: string;
  repo: string;
  prNumber: number;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<GithubPrObservation> {
  const data = await githubGraphql<ObservationQueryData>({
    token: input.token,
    query: PR_OBSERVATION_QUERY,
    variables: { owner: input.owner, name: input.repo, number: input.prNumber },
    fetchImpl: input.fetchImpl,
  });
  const pr = data.repository?.pullRequest;
  if (!pr?.id || !pr.number || !pr.url || !pr.state || !pr.headRefOid) {
    throw new Error(`GitHub PR #${input.prNumber} observation is incomplete`);
  }

  const contexts = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts;
  const checks: GithubCheckObservation[] = (contexts?.nodes ?? []).flatMap((node) => {
    if (!node) return [];
    const required = typeof node.isRequired === "boolean" ? { required: node.isRequired } : {};
    if (node.context) {
      const state = node.state ?? "UNKNOWN";
      return [{
        name: node.context,
        status: state === "PENDING" || state === "EXPECTED" ? "IN_PROGRESS" : "COMPLETED",
        conclusion: state === "SUCCESS" ? "SUCCESS" : state,
        detailsUrl: node.targetUrl ?? null,
        workflowRunId: null,
        ...required,
      }];
    }
    return [{
      name: node.name ?? "unnamed-check",
      status: node.status ?? "UNKNOWN",
      conclusion: node.conclusion ?? null,
      detailsUrl: node.detailsUrl ?? null,
      workflowRunId: node.checkSuite?.workflowRun?.databaseId ?? null,
      ...required,
    }];
  });

  return {
    nodeId: pr.id,
    number: pr.number,
    url: pr.url,
    state: pr.state,
    merged: pr.merged === true,
    headSha: pr.headRefOid,
    mergeStateStatus: pr.mergeStateStatus ?? null,
    unresolvedReviewThreads: (pr.reviewThreads?.nodes ?? []).filter((thread) => thread?.isResolved === false).length,
    reviewThreadsComplete: pr.reviewThreads?.pageInfo?.hasNextPage !== true
      && pr.latestReviews?.pageInfo?.hasNextPage !== true,
    changesRequested: pr.reviewDecision === "CHANGES_REQUESTED"
      || (pr.latestReviews?.nodes ?? []).some((review) => review?.state === "CHANGES_REQUESTED"),
    checksComplete: contexts?.pageInfo?.hasNextPage !== true,
    checks,
    autoMergeEnabled: Boolean(pr.autoMergeRequest),
    autoMergeEnabledAt: pr.autoMergeRequest?.enabledAt ?? null,
    mergeQueueEntry: Boolean(pr.mergeQueueEntry),
    queueEvent: readQueueEvent(pr.timelineItems?.nodes?.[0]),
  };
}

const ENABLE_AUTOMERGE_MUTATION = `
mutation DpfEnableAutoMerge($id:ID!,$expectedHeadOid:GitObjectID!){
  enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:SQUASH,expectedHeadOid:$expectedHeadOid}) {
    pullRequest { number }
  }
}`;

const PR_NODE_ID_QUERY = `
query DpfPullRequestNodeId($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){pullRequest(number:$number){id}}
}`;

export async function resolvePullRequestNodeId(input: {
  owner: string;
  repo: string;
  prNumber: number;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const data = await githubGraphql<{
    repository?: { pullRequest?: { id?: string } | null } | null;
  }>({
    token: input.token,
    query: PR_NODE_ID_QUERY,
    variables: { owner: input.owner, name: input.repo, number: input.prNumber },
    fetchImpl: input.fetchImpl,
  });
  const nodeId = data.repository?.pullRequest?.id;
  if (!nodeId) throw new Error(`Could not resolve GitHub node id for PR #${input.prNumber}`);
  return nodeId;
}

export async function enablePullRequestAutoMerge(input: {
  nodeId: string;
  token: string;
  /** GitHub refuses when the PR head has moved off this commit (BI-53BED66C). */
  expectedHeadOid: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  await githubGraphql({
    token: input.token,
    query: ENABLE_AUTOMERGE_MUTATION,
    variables: { id: input.nodeId, expectedHeadOid: input.expectedHeadOid },
    fetchImpl: input.fetchImpl,
  });
}

export type UpdatePullRequestBranchResult = "accepted" | "head-changed";

export async function updatePullRequestBranch(input: {
  owner: string;
  repo: string;
  prNumber: number;
  expectedHeadSha: string;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<UpdatePullRequestBranchResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls/${input.prNumber}/update-branch`,
    {
      method: "PUT",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${input.token}`,
        "Content-Type": "application/json",
        "User-Agent": "dpf-github-pr-readiness",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
      body: JSON.stringify({ expected_head_sha: input.expectedHeadSha }),
    },
  );
  if (response.status === 202) return "accepted";
  if (response.status === 422) return "head-changed";
  throw new Error(`GitHub update-branch HTTP ${response.status}`);
}

export type RerunFailedJobsResult = "accepted" | "not-rerunnable";

/**
 * Re-run only the failed jobs of one workflow run (BI-88341B5D §3.4): the
 * single infrastructure re-run. It changes no code and no check configuration.
 * GitHub answers 201 when the re-run is created; 403/409/422 mean the run
 * cannot be re-run (in progress, too old, or not permitted), which the caller
 * escalates instead of retrying.
 */
export async function rerunFailedWorkflowJobs(input: {
  owner: string;
  repo: string;
  workflowRunId: number;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<RerunFailedJobsResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/actions/runs/${input.workflowRunId}/rerun-failed-jobs`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${input.token}`,
        "User-Agent": "dpf-github-pr-readiness",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
    },
  );
  if (response.status === 201) return "accepted";
  if (response.status === 403 || response.status === 409 || response.status === 422) return "not-rerunnable";
  throw new Error(`GitHub rerun-failed-jobs HTTP ${response.status}`);
}
