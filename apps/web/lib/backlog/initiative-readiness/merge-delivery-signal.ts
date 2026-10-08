// The merge-through-gates signal (EP-4614F35E): did this item's change land on
// the trunk through CI + the merge queue? Extracted from
// backlog-terminal-transition.ts (BI-B04A0203) when the signal learned to read
// the PR the platform itself recorded as delivering the item.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { prisma } from "@dpf/db";

import { extractDeliveredBacklogItemIds, isDocPullRequest, PR_SUBMIT_ACTUATOR } from "@/lib/backlog/pr-submit-awaiting-acceptance";
import { isReachableFromTrunk, refreshTrunkRef, trunkHasMergedPullRequest, trunkRefCommittedAt, trunkRefExists, trustedGitArgs } from "@/lib/work-capsules/git-scanner";

const execFileAsync = promisify(execFile);

/**
 * BI-B04A0203 (EP-4614F35E): a PR merged THROUGH the code gates — CI + the merge
 * queue — is the strongest possible delivery evidence. Branch protection means it
 * could not have reached the trunk without passing them, so a direct-merge item
 * whose branch landed does not need a hand-built delivery manifest. Detect it
 * PROCEDURALLY and LOCALLY: the item's Workroom head SHA reachable from origin/main
 * == merged, reusing the room-closeout reachability helper — no GitHub API, no LLM.
 *
 * BI-043946C5: this used to answer `boolean`, and every infrastructure failure —
 * no candidate root is a git repository, the trunk ref does not resolve, the head
 * was never fetched locally — collapsed into `false`, which the caller could not
 * tell apart from a genuine "this never merged". Measured on a live install: the
 * probe's first root `/host-dpf` is the INSTALLED runtime directory, not a source
 * checkout, so `trunkRefExists` was false for every root and the signal was
 * unconditionally and silently false. Two capabilities were dead as a result —
 * merge-as-delivery-evidence (BI-B04A0203) and direct-merge recognition
 * (EP-4614F35E) — with nothing anywhere saying so.
 *
 * So the signal is now three-valued. `not-merged` is a MEASUREMENT: some root
 * answered and said no. `signal-unavailable` means nothing could answer, and the
 * caller must say that out loud rather than report it as a negative.
 */
export type MergeDeliverySignal = "merged" | "not-merged" | "signal-unavailable";

export type ResolveMergeDelivery = (args: {
  itemRowId: string;
  itemId: string;
  /** Lets an attested doc PR count only for a doc item (BI-A0020FAC). */
  workType?: string | null;
}) => Promise<MergeDeliverySignal>;

/**
 * Candidate source roots the merge signal probes, in order. Reachability stays
 * LOCAL and procedural — no GitHub API, no LLM
 * (platform-function-never-depends-on-a-client). The first root whose trunk ref
 * resolves wins.
 *
 * `/host-dpf` is listed because a source install mounts its checkout there. A
 * CONSUMER install legitimately has no checkout at all — there, `/host-dpf` is the
 * runtime directory and no root resolves, which is precisely the case that must
 * report `signal-unavailable` instead of a silent `false` (BI-043946C5). An
 * operator who wants the signal on such a host points `DPF_HOST_SOURCE_ROOT` at a
 * real checkout.
 */
export function mergeSignalRoots(): string[] {
  const roots = [
    process.env.DPF_REPO_ROOT,
    process.env.DPF_HOST_SOURCE_ROOT,
    // The runtime's own source root. On a consumer install this is the Build
    // Studio workspace volume (`/sandbox-workspace`), which docker-entrypoint.sh
    // makes a real repo and `start_build` points at the upstream — so the signal
    // works with NO operator configuration on exactly the installs that have no
    // host checkout. It was simply never asked (BI-043946C5).
    process.env.PROJECT_ROOT,
    "/host-dpf",
    process.cwd(),
  ];
  return [...new Set(roots.filter((r): r is string => Boolean(r)))];
}

/**
 * Refresh the trunk the merge signal will read, BEFORE the completion
 * transaction opens (BI-DC2758DE, founder decision on DI-B26D16D64C62).
 *
 * The signal runs inside the terminal transaction, whose default timeout is
 * seconds, so it must never touch the network itself. This runs just ahead of
 * it: one bounded fetch of origin/main in the first root that is a real clone.
 * The scheduled code-graph job keeps the same clone current between
 * completions. A failed fetch changes nothing, and a stale negative still reads
 * as "signal-unavailable", never as "not merged".
 */
export async function refreshMergeSignalTrunk(
  roots: readonly string[] = mergeSignalRoots(),
  refresh: (root: string) => Promise<unknown> = (root) => refreshTrunkRef(root, { timeoutMs: 15_000 }),
): Promise<string | null> {
  for (const root of roots) {
    if (!(await trunkRefExists(root))) continue;
    await refresh(root);
    return root;
  }
  return null;
}

/**
 * How stale a trunk ref may be before a NEGATIVE reachability answer stops
 * counting as a measurement. Positives are unaffected: reachability is monotone,
 * so a stale trunk can only ever miss a merge, never invent one.
 *
 * This exists because the roots above are not guaranteed to be fetched. The
 * Build Studio workspace is refreshed at `start_build`, not on the completion
 * path, and was observed ten days behind on a live install — old enough to
 * report merged work as unmerged with total confidence, which is the exact
 * failure BI-043946C5 set out to remove. Reading the ref is local and cheap;
 * fetching here is deliberately NOT done, because the completion path must not
 * depend on the network.
 */
const TRUNK_FRESHNESS_WINDOW_MS = (() => {
  const raw = Number(process.env.DPF_MERGE_SIGNAL_MAX_TRUNK_AGE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 24 * 60 * 60 * 1000;
})();

/**
 * The operator-facing sentence for an unavailable merge signal. It names the
 * measurement (nothing could answer), never a verdict, and the one lever that
 * changes it. Surfaced through `requirementReasons`, which `requirementNextAction`
 * puts at the FRONT of the next action.
 */
export function mergeSignalUnavailableReason(roots: readonly string[]): string {
  const probed = roots.length > 0 ? roots.join(", ") : "no candidate roots";
  return "The merge-through-gates signal could not run on this runtime, so whether this work "
    + `landed on the trunk is UNKNOWN here, not answered "no" (probed: ${probed}). `
    + "Point DPF_HOST_SOURCE_ROOT at a source checkout to enable it.";
}

/** Pull-request numbers named by an item's evidence links (`.../pull/123`). */
export function pullRequestNumbersFromActivities(
  activities: readonly { kind: string; payload: unknown }[],
): number[] {
  const numbers = new Set<number>();
  for (const activity of activities) {
    if (activity.kind !== "evidence") continue;
    const url = (activity.payload as { url?: unknown } | null)?.url;
    const match = typeof url === "string" ? url.match(/\/pull\/(\d+)(?:[/?#]|$)/) : null;
    if (match) numbers.add(Number(match[1]));
  }
  return [...numbers];
}

/**
 * Delivery evidence is the trunk (BI-AFE8BB73, design §4): a SHA reachable
 * from origin/main satisfies DELIVERY_EVIDENCE_REQUIRED for every shape.
 * Read the Workroom heads first; when no room recorded a head (a fix worked
 * outside a Workroom, or a room whose head was never synced), fall back to the
 * item's linked pull request — the room's `pullRequestNumber` or an evidence
 * link — and look for its merge commit on the trunk. The manifest path stays
 * as the fallback the caller already has.
 */
/**
 * The git half of the merge signal, with no database and no ambient
 * configuration: given the branch identities to look for and the roots to look
 * in, decide whether the work landed.
 *
 * Split out so it can be driven against REAL repositories in a test
 * (BI-043946C5). The defect this function now encodes lived precisely in the
 * boundary between this module and git, and every existing test stubbed the
 * whole resolver, so the suite stayed green while the shipped code could not
 * answer at all on a live install.
 */
export async function resolveMergeSignalFromRefs(input: {
  heads: readonly string[];
  pullRequests: readonly number[];
  /**
   * PRs the server-side PR-submit actuator recorded as delivering the item
   * (BI-B04A0203). Unlike `pullRequests`, these are re-checked against the
   * squash commit on the trunk: it must deliver `item` under the actuator's
   * current rule and must not have been reverted. Read only with `item`.
   */
  attestedPullRequests?: readonly number[];
  item?: { itemId: string; workType: string | null };
  roots: readonly string[];
  /** Injectable for tests; defaults to the real clock. */
  now?: Date;
  /** Injectable for tests; defaults to reading the trunk tip's commit date. */
  readTrunkCommittedAt?: (root: string) => Promise<Date | null>;
}): Promise<MergeDeliverySignal> {
  const { heads, pullRequests, roots } = input;
  const attested = input.item ? [...new Set(input.attestedPullRequests ?? [])] : [];
  const now = input.now ?? new Date();
  const readTrunkCommittedAt = input.readTrunkCommittedAt ?? ((root: string) => trunkRefCommittedAt(root));
  // Nothing to look up: no room recorded a head and no PR is linked. That is a
  // real measurement about THIS item — there is no branch identity to find on
  // the trunk — not a broken probe, so it stays a negative.
  if (heads.length === 0 && pullRequests.length === 0 && attested.length === 0) return "not-merged";
  for (const root of roots) {
    if (!(await trunkRefExists(root))) continue;
    // A root answered. Distinguish "git said no" from "git could not say":
    // isReachableFromTrunk / trunkHasMergedPullRequest already return null for
    // the indeterminate case (sha never fetched, bad ref, git missing), and
    // flattening those to false is the same silent-negative bug one level down.
    let sawDefiniteNegative = false;
    for (const sha of heads) {
      const reachable = await isReachableFromTrunk(root, sha);
      if (reachable === true) return "merged";
      if (reachable === false) sawDefiniteNegative = true;
    }
    for (const prNumber of new Set(pullRequests)) {
      const merged = await trunkHasMergedPullRequest(root, prNumber);
      if (merged === true) return "merged";
      if (merged === false) sawDefiniteNegative = true;
    }
    for (const prNumber of attested) {
      const commit = await readTrunkPullRequestCommit(root, prNumber);
      if (commit === null) continue;
      if (commit && input.item && trunkCommitDeliversItem(commit, input.item)) return "merged";
      // Absent, reverted, or a squash commit that does not deliver this item:
      // git answered, and the answer is that this PR is not the item's merge.
      sawDefiniteNegative = true;
    }
    if (!sawDefiniteNegative) return "signal-unavailable";
    // A negative is only a measurement if the trunk it was measured against is
    // current. An unfetched trunk reports merged work as unmerged, confidently.
    const trunkAt = await readTrunkCommittedAt(root);
    if (!trunkAt) return "signal-unavailable";
    const staleBy = now.getTime() - trunkAt.getTime();
    return staleBy <= TRUNK_FRESHNESS_WINDOW_MS ? "not-merged" : "signal-unavailable";
  }
  // No candidate root is a readable repository.
  return "signal-unavailable";
}

type MergeDeliveryDb = {
  workroom: { findMany(args: unknown): Promise<{ headSha: string | null; pullRequestNumber: number | null }[]> };
  backlogItemActivity: { findMany(args: unknown): Promise<{ kind: string; payload: unknown }[]> };
};

/**
 * The database half: gather every branch identity the platform holds for the
 * item, then ask git. Injectable so the read itself is tested, not stubbed past.
 */
export async function resolveMergeDeliveryFromDb(
  db: MergeDeliveryDb,
  { itemRowId, itemId, workType }: { itemRowId: string; itemId: string; workType?: string | null },
  options: {
    roots?: readonly string[];
    now?: Date;
    readTrunkCommittedAt?: (root: string) => Promise<Date | null>;
  } = {},
): Promise<MergeDeliverySignal> {
  try {
    const rooms = await db.workroom.findMany({
      where: { backlogItemId: itemId },
      orderBy: { updatedAt: "desc" },
      select: { headSha: true, pullRequestNumber: true },
    });
    const heads = rooms.map((room) => room.headSha).filter((sha): sha is string => Boolean(sha));
    const evidence = await db.backlogItemActivity.findMany({
      where: { backlogItemId: itemRowId, kind: "evidence" },
      select: { kind: true, payload: true },
      take: 200,
    });
    const pullRequests = [
      ...rooms.map((room) => room.pullRequestNumber).filter((n): n is number => typeof n === "number"),
      ...pullRequestNumbersFromActivities(evidence),
    ];
    // BI-B04A0203: the PR the platform itself recorded when it moved the item
    // to awaiting-acceptance — for most delivered items the only record there is.
    const transitions = await db.backlogItemActivity.findMany({
      where: { backlogItemId: itemRowId, kind: "status_change" },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
      select: { kind: true, payload: true },
      take: 200,
    });
    return await resolveMergeSignalFromRefs({
      heads,
      pullRequests,
      attestedPullRequests: deliveryAttemptPullRequests(transitions),
      item: { itemId, workType: workType ?? null },
      roots: options.roots ?? mergeSignalRoots(),
      ...(options.now ? { now: options.now } : {}),
      ...(options.readTrunkCommittedAt ? { readTrunkCommittedAt: options.readTrunkCommittedAt } : {}),
    });
  } catch {
    return "signal-unavailable";
  }
}

export const defaultResolveMergeDelivery: ResolveMergeDelivery = (args) =>
  resolveMergeDeliveryFromDb(prisma as unknown as MergeDeliveryDb, args);

/** A move back into the coding pool ends a delivery attempt. */
const REOPENED_TO = new Set(["triaging", "open", "in-progress"]);

/**
 * BI-B04A0203. The pull requests the current delivery attempt was submitted
 * as, read from the `status_change` rows the PR-submit actuator writes
 * (the PR-submit actuator module). Measured 2026-10-06: for 235 of 535
 * direct-merge platform items in awaiting-acceptance this row was the only
 * record of the PR that delivered them, and the signal never read it.
 *
 * Rows must be NEWEST FIRST. Only that actuator's rows count — a status row
 * another writer produced is not an attestation — and the walk stops at the
 * newest reopen, so a PR from an earlier attempt cannot close reopened work
 * (the same rule deployment closure applies).
 */
export function deliveryAttemptPullRequests(
  transitions: readonly { kind: string; payload: unknown }[],
): number[] {
  const numbers: number[] = [];
  for (const row of transitions) {
    if (row.kind !== "status_change") continue;
    const payload = (row.payload ?? {}) as { to?: unknown; actuator?: unknown; pullRequestNumber?: unknown };
    if (typeof payload.to === "string" && REOPENED_TO.has(payload.to)) break;
    const n = payload.pullRequestNumber;
    if (payload.actuator === PR_SUBMIT_ACTUATOR && payload.to === "awaiting-acceptance"
      && typeof n === "number" && Number.isInteger(n) && n > 0 && !numbers.includes(n)) {
      numbers.push(n);
    }
  }
  return numbers;
}

/**
 * Whether a squash commit on the trunk delivers the item, by the actuator's
 * CURRENT rule (BI-A0020FAC): ids in the title, or body ids after a delivery
 * keyword or on a Backlog line — a mere citation does not deliver. Before that
 * fix the actuator moved every BI a PR mentioned, so a recorded PR number alone
 * is not trusted; the immutable trunk commit is re-read instead. A doc PR
 * delivers only a doc item.
 */
export function trunkCommitDeliversItem(
  commit: { subject: string; body: string },
  item: { itemId: string; workType: string | null },
): boolean {
  if (isDocPullRequest(commit.subject) && item.workType !== "doc") return false;
  return extractDeliveredBacklogItemIds(commit.subject, commit.body).includes(item.itemId);
}

/**
 * The merge-queue squash commit for PR `prNumber` on the trunk: the commit
 * whose subject ends `(#N)`. `false` when the trunk has none, or when the trunk
 * also carries a revert of it; `null` when git could not answer.
 */
export async function readTrunkPullRequestCommit(
  root: string,
  prNumber: number,
  trunkRef = "origin/main",
): Promise<{ subject: string; body: string } | false | null> {
  if (!Number.isInteger(prNumber) || prNumber <= 0) return null;
  const marker = `(#${prNumber})`;
  try {
    const { stdout } = await execFileAsync(
      "git",
      trustedGitArgs(root, ["log", trunkRef, "--fixed-strings", `--grep=${marker}`, "-n", "20", "--format=%s%x1f%b%x1e"]),
      { timeout: 5000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
    );
    const commits = stdout.split("\x1e").map((entry) => entry.replace(/^\n/, "")).filter(Boolean).map((entry) => {
      const [subject = "", body = ""] = entry.split("\x1f");
      return { subject: subject.trim(), body };
    });
    if (commits.some((c) => c.subject.startsWith("Revert ") && c.subject.includes(marker))) return false;
    return commits.find((c) => !c.subject.startsWith("Revert ") && c.subject.endsWith(marker)) ?? false;
  } catch {
    return null;
  }
}
