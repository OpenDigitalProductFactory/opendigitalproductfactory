/**
 * Shared GitHub pull-request readiness and merge-queue actuation.
 *
 * Read decisions are exact-head and fail closed. Mutations are intentionally
 * limited to update-branch (compare-and-swap) and enable-auto-merge; this module
 * has no direct merge or force-push operation.
 */

const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";
const GITHUB_API_VERSION = "2022-11-28";

export type GithubCheckObservation = {
  name: string;
  status: string;
  conclusion: string | null;
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
  mergeQueueEntry: boolean;
};

export type GithubPrReadiness =
  | { kind: "ready" | "behind" | "conflict" | "queued" | "merged" | "closed"; headSha: string }
  | { kind: "checking" | "unknown"; headSha: string | null; reason: string };

const PASSING_CHECK_CONCLUSIONS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

export function projectGithubPrReadiness(observation: GithubPrObservation): GithubPrReadiness {
  const headSha = observation.headSha.trim();
  if (!headSha) return { kind: "unknown", headSha: null, reason: "missing-head-sha" };
  if (observation.merged || observation.state === "MERGED") return { kind: "merged", headSha };
  if (observation.state === "CLOSED") return { kind: "closed", headSha };
  if (observation.autoMergeEnabled || observation.mergeQueueEntry) return { kind: "queued", headSha };

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
  if (observation.checks.some((check) => check.status.toUpperCase() !== "COMPLETED")) {
    return { kind: "checking", headSha, reason: "checks-pending" };
  }
  if (
    observation.checks.some(
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
      id number url state merged headRefOid mergeStateStatus
      autoMergeRequest { enabledAt }
      mergeQueueEntry { id }
      reviewThreads(first:100){ nodes { isResolved } pageInfo { hasNextPage } }
      commits(last:1){
        nodes {
          commit {
            statusCheckRollup {
              contexts(first:100) {
                nodes {
                  ... on CheckRun { name status conclusion }
                  ... on StatusContext { context state }
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
      autoMergeRequest?: { enabledAt?: string } | null;
      mergeQueueEntry?: { id?: string } | null;
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
    if (node.context) {
      const state = node.state ?? "UNKNOWN";
      return [{
        name: node.context,
        status: state === "PENDING" || state === "EXPECTED" ? "IN_PROGRESS" : "COMPLETED",
        conclusion: state === "SUCCESS" ? "SUCCESS" : state,
      }];
    }
    return [{ name: node.name ?? "unnamed-check", status: node.status ?? "UNKNOWN", conclusion: node.conclusion ?? null }];
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
    reviewThreadsComplete: pr.reviewThreads?.pageInfo?.hasNextPage !== true,
    checksComplete: contexts?.pageInfo?.hasNextPage !== true,
    checks,
    autoMergeEnabled: Boolean(pr.autoMergeRequest),
    mergeQueueEntry: Boolean(pr.mergeQueueEntry),
  };
}

const ENABLE_AUTOMERGE_MUTATION = `
mutation DpfEnableAutoMerge($id:ID!){
  enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:SQUASH}) {
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
  fetchImpl?: typeof fetch;
}): Promise<void> {
  await githubGraphql({
    token: input.token,
    query: ENABLE_AUTOMERGE_MUTATION,
    variables: { id: input.nodeId },
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
