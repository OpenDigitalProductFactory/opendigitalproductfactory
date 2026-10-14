import type { RawCommit } from "./types";

const SHA = /^[a-f0-9]{40}$/i;
const MAX_PAGES = 10;
type Commit = { sha: string; parents: unknown[]; commit: {
  message: string; author: { name: string; date: string };
} };

/** Public immutable source comparison: consumer installs need no host clone.
 * Compare's files are range-wide, so never attribute them to individual commits.
 * Reject incomplete ranges rather than presenting partial counts as complete.
 */
export async function collectReleaseChangeSet(
  input: { currentLineageSha: string; targetSha: string },
  fetcher: typeof fetch = fetch,
): Promise<RawCommit[]> {
  if (!SHA.test(input.currentLineageSha) || !SHA.test(input.targetSha)) {
    throw new Error("Release change details require valid source revisions.");
  }
  const owner = encodeURIComponent(process.env.REPO_OWNER ?? "OpenDigitalProductFactory");
  const repo = encodeURIComponent(process.env.REPO_NAME ?? "opendigitalproductfactory");
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const commits = new Map<string, RawCommit>();
  const signal = AbortSignal.timeout(15_000);
  const seen = new Set<string>();
  let expectedTotal: number | null = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await fetcher(
      `https://api.github.com/repos/${owner}/${repo}/compare/${input.currentLineageSha}...${input.targetSha}?per_page=100&page=${page}`,
      { headers, signal },
    );
    if (!response.ok) throw new Error(`Published change details are temporarily unavailable (HTTP ${response.status}). Try again later.`);
    const data = await response.json() as { status: string; total_commits: number; commits: Commit[] };
    if (!["ahead", "identical"].includes(data.status) || !Array.isArray(data.commits)
      || !Number.isSafeInteger(data.total_commits) || data.total_commits < 0) {
      throw new Error("The published source revisions could not be compared reliably.");
    }
    if (data.total_commits > MAX_PAGES * 100) throw new Error("This update has too many changes to summarize in one request.");
    if (expectedTotal !== null && expectedTotal !== data.total_commits) throw new Error("The published change list is inconsistent. Try again later.");
    expectedTotal = data.total_commits;
    for (const entry of data.commits) {
      if (!SHA.test(entry.sha) || !Array.isArray(entry.parents) || typeof entry.commit?.message !== "string") {
        throw new Error("The published change list is incomplete. Try again later.");
      }
      if (seen.has(entry.sha)) throw new Error("The published change list is inconsistent. Try again later.");
      seen.add(entry.sha);
      if (entry.parents.length > 1) continue;
      commits.set(entry.sha, {
        sha: entry.sha,
        subject: entry.commit.message.split("\n")[0]!.trim(),
        author: entry.commit.author?.name ?? "",
        authorDate: entry.commit.author?.date ?? "",
        files: [],
      });
    }
    if (seen.size === data.total_commits) {
      if (data.status === "ahead" && !seen.has(input.targetSha)) throw new Error("The published change list does not contain the target revision.");
      return [...commits.values()];
    }
    if (data.commits.length === 0 || seen.size > data.total_commits) break;
  }
  throw new Error("The published change list is incomplete. Try again later.");
}
