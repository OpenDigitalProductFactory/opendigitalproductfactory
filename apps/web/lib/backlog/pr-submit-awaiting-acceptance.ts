import { randomUUID } from "node:crypto";
import { prisma } from "@dpf/db";
import { isBacklogStatus, isLegalTransition, type BacklogStatus } from "@/lib/backlog/transitions";

export const CODING_POOL_STATUSES = ["triaging", "open", "in-progress"] as const;
export type CodingPoolStatus = (typeof CODING_POOL_STATUSES)[number];

export const AWAITING_ACCEPTANCE_STATUS = "awaiting-acceptance" as const;

const ITEM_ID_RE = /\bBI-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/g;

export type GitHubPullRequestEvent = {
  action: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  draft: boolean;
  merged: boolean;
  state: string;
  title: string;
  body: string;
  headBranch: string;
  repositoryFullName: string;
};

export type PrSubmitActuatorResult = {
  moved: string[];
  skipped: number;
  reason: string | null;
};

function isCodingPoolStatus(status: string): status is CodingPoolStatus {
  return (CODING_POOL_STATUSES as readonly string[]).includes(status);
}

export function extractBacklogItemIdsFromText(text: string): string[] {
  const found = text.match(ITEM_ID_RE) ?? [];
  return [...new Set(found)];
}

export function parseGitHubPullRequestEvent(payload: unknown): GitHubPullRequestEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const pr = record.pull_request;
  if (!pr || typeof pr !== "object") return null;
  const pullRequest = pr as Record<string, unknown>;
  const head = pullRequest.head && typeof pullRequest.head === "object"
    ? pullRequest.head as Record<string, unknown>
    : {};
  const repository = record.repository && typeof record.repository === "object"
    ? record.repository as Record<string, unknown>
    : {};
  const number = typeof pullRequest.number === "number"
    ? pullRequest.number
    : typeof record.number === "number"
      ? record.number
      : null;
  const url = typeof pullRequest.html_url === "string" ? pullRequest.html_url : null;
  const headBranch = typeof head.ref === "string" ? head.ref : null;
  const repositoryFullName = typeof repository.full_name === "string" ? repository.full_name : null;
  if (number == null || !url || !headBranch || !repositoryFullName) return null;
  return {
    action: typeof record.action === "string" ? record.action : "",
    pullRequestNumber: number,
    pullRequestUrl: url,
    draft: pullRequest.draft === true,
    merged: pullRequest.merged === true,
    state: typeof pullRequest.state === "string" ? pullRequest.state : "",
    title: typeof pullRequest.title === "string" ? pullRequest.title : "",
    body: typeof pullRequest.body === "string" ? pullRequest.body : "",
    headBranch,
    repositoryFullName,
  };
}

export function shouldMarkAwaitingAcceptance(event: GitHubPullRequestEvent): boolean {
  if (event.draft) return false;
  // Merged PRs have already left coding; still not accepted. Needed for CLI
  // rooms whose open event was never seen (Workroom.pullRequestNumber is sparse).
  if (event.merged) return true;
  if (event.state === "closed") return false;
  return event.action === "opened"
    || event.action === "reopened"
    || event.action === "ready_for_review"
    || event.action === "synchronize"
    || event.action === "edited"
    || event.action === "labeled"
    || event.action === "unlabeled"
    || event.action === "observed";
}

export function shouldReopenFromWithdrawnPr(event: GitHubPullRequestEvent): boolean {
  return event.action === "closed" && !event.merged;
}

async function loadLinkedItems(event: GitHubPullRequestEvent): Promise<{
  id: string;
  itemId: string;
  status: string;
  claimStatus: string | null;
}[]> {
  const rooms = await prisma.workroom.findMany({
    where: {
      repositoryFullName: event.repositoryFullName,
      headBranch: event.headBranch,
      backlogItemId: { not: null },
    },
    select: { id: true, backlogItemId: true, pullRequestNumber: true },
    take: 50,
  });

  const fromRooms = rooms
    .map((room) => room.backlogItemId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const fromText = extractBacklogItemIdsFromText(`${event.title}\n${event.body}`);
  const itemIds = [...new Set([...fromRooms, ...fromText])];
  if (itemIds.length === 0) return [];

  return prisma.backlogItem.findMany({
    where: { itemId: { in: itemIds } },
    select: { id: true, itemId: true, status: true, claimStatus: true },
  });
}

async function stampWorkroomPr(event: GitHubPullRequestEvent): Promise<void> {
  await prisma.workroom.updateMany({
    where: {
      repositoryFullName: event.repositoryFullName,
      headBranch: event.headBranch,
    },
    data: {
      pullRequestNumber: event.pullRequestNumber,
      pullRequestUrl: event.pullRequestUrl,
    },
  });
}

async function transitionItem(args: {
  id: string;
  itemId: string;
  from: string;
  to: BacklogStatus;
  reason: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
}): Promise<boolean> {
  if (args.from === args.to) return false;
  if (!isBacklogStatus(args.from) || !isLegalTransition(args.from, args.to)) return false;

  await prisma.$transaction(async (tx) => {
    await tx.backlogItem.update({
      where: { id: args.id },
      data: {
        status: args.to,
        ...(args.to === AWAITING_ACCEPTANCE_STATUS
          ? { claimStatus: "released", claimedById: null, claimedByAgentId: null, claimedAt: null }
          : {}),
      },
    });
    await tx.backlogItemActivity.create({
      data: {
        backlogItemId: args.id,
        kind: "status_change",
        summary: `${args.from} → ${args.to} — ${args.reason}`,
        payload: {
          from: args.from,
          to: args.to,
          reason: args.reason,
          actuator: "pr-submit-awaiting-acceptance",
          pullRequestNumber: args.pullRequestNumber,
          pullRequestUrl: args.pullRequestUrl,
          ...(args.to === AWAITING_ACCEPTANCE_STATUS ? { claimAction: "released" } : {}),
        },
      },
    });
  });
  return true;
}

export async function applyGitHubPullRequestToBacklog(payload: unknown): Promise<PrSubmitActuatorResult> {
  const event = parseGitHubPullRequestEvent(payload);
  if (!event) return { moved: [], skipped: 0, reason: "unparseable-pull-request" };

  await stampWorkroomPr(event);
  const items = await loadLinkedItems(event);
  if (items.length === 0) return { moved: [], skipped: 0, reason: "no-linked-items" };

  const mark = shouldMarkAwaitingAcceptance(event);
  const reopen = shouldReopenFromWithdrawnPr(event);
  if (!mark && !reopen) return { moved: [], skipped: items.length, reason: "no-status-action" };

  const moved: string[] = [];
  let skipped = 0;
  for (const item of items) {
    const to: BacklogStatus = mark ? AWAITING_ACCEPTANCE_STATUS : "open";
    const eligible = mark ? isCodingPoolStatus(item.status) : item.status === AWAITING_ACCEPTANCE_STATUS;
    if (!eligible) {
      skipped += 1;
      continue;
    }
    const did = await transitionItem({
      id: item.id,
      itemId: item.itemId,
      from: item.status,
      to,
      reason: mark
        ? `Merge-ready PR #${event.pullRequestNumber} submitted`
        : `PR #${event.pullRequestNumber} withdrawn without merge`,
      pullRequestNumber: event.pullRequestNumber,
      pullRequestUrl: event.pullRequestUrl,
    });
    if (did) moved.push(item.itemId);
    else skipped += 1;
  }
  return { moved, skipped, reason: null };
}

export async function sweepPrSubmittedBacklogItems(args?: { limit?: number }): Promise<PrSubmitActuatorResult> {
  const take = Math.max(1, Math.min(args?.limit ?? 100, 200));
  const rooms = await prisma.workroom.findMany({
    where: {
      pullRequestNumber: { not: null },
      backlogItemId: { not: null },
    },
    select: { backlogItemId: true, pullRequestNumber: true, pullRequestUrl: true },
    take,
    orderBy: { updatedAt: "desc" },
  });
  const itemIds = [...new Set(
    rooms.map((room) => room.backlogItemId).filter((id): id is string => typeof id === "string"),
  )];
  if (itemIds.length === 0) return { moved: [], skipped: 0, reason: "no-pr-workrooms" };

  const items = await prisma.backlogItem.findMany({
    where: { itemId: { in: itemIds }, status: { in: [...CODING_POOL_STATUSES] } },
    select: { id: true, itemId: true, status: true, claimStatus: true },
  });

  const byItem = new Map(rooms.map((room) => [room.backlogItemId, room]));
  const moved: string[] = [];
  let skipped = 0;
  for (const item of items) {
    const room = byItem.get(item.itemId);
    const prNumber = room?.pullRequestNumber;
    if (typeof prNumber !== "number") {
      skipped += 1;
      continue;
    }
    const did = await transitionItem({
      id: item.id,
      itemId: item.itemId,
      from: item.status,
      to: AWAITING_ACCEPTANCE_STATUS,
      reason: `Reconcile existing PR #${prNumber}`,
      pullRequestNumber: prNumber,
      pullRequestUrl: room?.pullRequestUrl ?? `https://github.com/pull/${prNumber}`,
    });
    if (did) moved.push(item.itemId);
    else skipped += 1;
  }
  return { moved, skipped, reason: null };
}

export async function applyObservedPullRequestsToBacklog(
  observations: readonly {
    repositoryFullName: string;
    number: number;
    url: string;
    title?: string;
    headBranch: string;
    state: "open" | "merged" | "closed";
    isDraft: boolean;
  }[],
): Promise<PrSubmitActuatorResult> {
  const moved: string[] = [];
  let skipped = 0;
  for (const observation of observations) {
    const result = await applyGitHubPullRequestToBacklog({
      action: "observed",
      number: observation.number,
      pull_request: {
        number: observation.number,
        html_url: observation.url,
        draft: observation.isDraft,
        merged: observation.state === "merged",
        state: observation.state === "open" ? "open" : "closed",
        title: observation.title ?? "",
        body: "",
        head: { ref: observation.headBranch },
      },
      repository: { full_name: observation.repositoryFullName },
    });
    moved.push(...result.moved);
    skipped += result.skipped;
  }
  return { moved: [...new Set(moved)], skipped, reason: moved.length === 0 ? "no-linked-items" : null };
}

export async function fileAcceptanceMiss(args: {
  originalItemId: string;
  servedSha: string;
  fingerprint: string;
  title: string;
  body: string;
}): Promise<{ action: "created" | "updated" | "skipped"; itemId: string | null; reason?: string }> {
  const original = await prisma.backlogItem.findUnique({
    where: { itemId: args.originalItemId },
    select: { id: true, itemId: true, status: true, epicId: true, organizationId: true },
  });
  if (!original) return { action: "skipped", itemId: null, reason: "original-not-found" };
  if (original.status !== AWAITING_ACCEPTANCE_STATUS) {
    return { action: "skipped", itemId: original.itemId, reason: "original-not-awaiting-acceptance" };
  }

  const marker = `acceptanceFingerprint: ${args.fingerprint}`;
  const existing = await prisma.backlogItem.findFirst({
    where: {
      status: { notIn: ["done", "deferred", "retired"] },
      body: { contains: marker },
    },
    select: { itemId: true },
  });
  if (existing) return { action: "updated", itemId: existing.itemId };

  const created = await prisma.backlogItem.create({
    data: {
      itemId: `BI-ACC-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      title: args.title,
      body: `${args.body}\n\n${marker}\nservedSha: ${args.servedSha}\nsupersedes: ${original.itemId}\n`,
      status: "open",
      type: "portfolio",
      workType: "bug",
      source: "automated-detection",
      epicId: original.epicId,
      organizationId: original.organizationId,
    },
    select: { itemId: true },
  });
  await prisma.backlogItemActivity.create({
    data: {
      backlogItemId: original.id,
      kind: "status_change",
      summary: `Acceptance miss filed as ${created.itemId}; ${original.itemId} stays awaiting-acceptance`,
      payload: {
        from: AWAITING_ACCEPTANCE_STATUS,
        to: AWAITING_ACCEPTANCE_STATUS,
        reason: "verification-fail",
        correctiveItemId: created.itemId,
        servedSha: args.servedSha,
        fingerprint: args.fingerprint,
        actuator: "pr-submit-awaiting-acceptance",
      },
    },
  });
  return { action: "created", itemId: created.itemId };
}
