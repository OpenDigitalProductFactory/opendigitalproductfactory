import { readFileSync } from "node:fs";
import { isEntryModule } from "./lib/entry-module.mjs";

export function reviewHeads(event, entries = []) {
  if (event.pull_request?.head?.sha) {
    if (!/^[a-f0-9]{40}$/.test(event.pull_request.head.sha)) throw new Error("PR source identity is malformed.");
    return [event.pull_request.head.sha];
  }
  const group = event.merge_group;
  const target = entries.find(entry => entry.headCommit?.oid === group?.head_sha);
  if (!group || !target) throw new Error("Current merge group is not present in the authoritative queue snapshot.");
  const heads = entries.filter(entry => entry.position <= target.position).map(entry => entry.pullRequest?.headRefOid);
  if (!heads.length || heads.some(sha => !/^[a-f0-9]{40}$/.test(sha ?? ""))) throw new Error("Merge queue source identity is incomplete.");
  return [...new Set(heads)];
}

export function validateFailureStatus(statuses, publisher, now = Date.now()) {
  if (!publisher) return { valid: false, reason: "Trusted status publisher is not configured." };
  const current = statuses.filter(status => status.context === "dpf/failure-readiness")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (!current) return { valid: false, reason: "Final-change failure readiness evidence is missing." };
  if (current.creator?.login !== publisher) return { valid: false, reason: "Status was not issued by the configured platform publisher." };
  if (current.state !== "success") return { valid: false, reason: "Failure readiness has not passed; use internal review recovery." };
  const age = now - Date.parse(current.created_at);
  if (!Number.isFinite(age) || age < 0 || age > 60 * 60 * 1000) return { valid: false, reason: "Failure readiness status is stale; republish from current evidence." };
  return { valid: true };
}

export async function checkFailureReadiness({ event, repository, token, publisher, fetchImpl = fetch }) {
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository ?? "") || !token) throw new Error("GitHub repository and read token are required.");
  const [owner, name] = repository.split("/");
  const request = async (path, body) => {
    const response = await fetchImpl(`https://api.github.com/${path}`, { method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(`GitHub evidence read failed (${response.status}); no approval inferred.`);
    const value = await response.json();
    if (value.errors) throw new Error("GitHub queue evidence is unavailable.");
    return value;
  };
  const entries = [];
  if (event.merge_group) {
    let cursor = null;
    for (let page = 0; page < 10; page++) {
      const result = await request("graphql", { query: `query($owner:String!,$name:String!,$branch:String!,$cursor:String){repository(owner:$owner,name:$name){mergeQueue(branch:$branch){entries(first:100,after:$cursor){nodes{position headCommit{oid} pullRequest{headRefOid}} pageInfo{hasNextPage endCursor}}}}}`,
        variables: { owner, name, branch: event.merge_group.base_ref.replace(/^refs\/heads\//, ""), cursor } });
      const connection = result.data?.repository?.mergeQueue?.entries;
      if (!connection) throw new Error("Merge queue evidence is missing.");
      entries.push(...connection.nodes);
      if (!connection.pageInfo.hasNextPage) break;
      if (!connection.pageInfo.endCursor || connection.pageInfo.endCursor === cursor || page === 9) throw new Error("Queue pagination did not complete.");
      cursor = connection.pageInfo.endCursor;
    }
  }
  for (const sha of reviewHeads(event, entries)) {
    const result = await request(`repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${sha}/status?per_page=100`);
    const verdict = validateFailureStatus(result.statuses ?? [], publisher);
    if (!verdict.valid) throw new Error(verdict.reason);
  }
}

if (isEntryModule(import.meta.url)) {
  try {
    await checkFailureReadiness({ event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")),
      repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN, publisher: process.env.DPF_REVIEW_STATUS_PUBLISHER });
    console.log("Final-change failure analysis and recovery evidence verified.");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
