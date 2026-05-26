import type { PullRequestSnapshot } from "./types";

export type GitHubInventoryError = {
  source: "pr-list";
  message: string;
};

export type GitHubInventoryResult = {
  pullRequests: PullRequestSnapshot[];
  errors: GitHubInventoryError[];
};

type RawPr = {
  number: number;
  url: string;
  title: string;
  headRefName?: string;
  state?: string;
  isDraft?: boolean;
  mergeStateStatus?: string | null;
};

export function parseGhPrListJson(json: string): GitHubInventoryResult {
  if (!json.trim()) {
    return { pullRequests: [], errors: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return {
      pullRequests: [],
      errors: [{ source: "pr-list", message: `Failed to parse gh JSON: ${(err as Error).message}` }],
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      pullRequests: [],
      errors: [{ source: "pr-list", message: "gh output is not a JSON array" }],
    };
  }

  const pullRequests: PullRequestSnapshot[] = [];
  for (const raw of parsed as RawPr[]) {
    if (!raw || typeof raw !== "object") continue;
    if (typeof raw.number !== "number") continue;
    if (typeof raw.url !== "string") continue;
    if (typeof raw.headRefName !== "string") continue;
    pullRequests.push({
      number: raw.number,
      url: raw.url,
      title: typeof raw.title === "string" ? raw.title : "",
      headBranch: raw.headRefName,
      state: normalizeState(raw.state),
      isDraft: Boolean(raw.isDraft),
      mergeStateStatus: typeof raw.mergeStateStatus === "string" ? raw.mergeStateStatus : null,
    });
  }

  return { pullRequests, errors: [] };
}

function normalizeState(s: unknown): PullRequestSnapshot["state"] {
  if (typeof s !== "string") return "open";
  const lower = s.toLowerCase();
  if (lower === "merged") return "merged";
  if (lower === "closed") return "closed";
  return "open";
}
