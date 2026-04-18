/**
 * Issue Bridge — mirrors a local BacklogItem, Epic, or PlatformIssueReport
 * to a GitHub Issue on the upstream hive repo so the project team can see
 * and act on items raised by non-Build-Studio users.
 *
 * Contribution-mode gated:
 *   - fork_only: never escalates
 *   - selective: caller decides (user-prompted in UI)
 *   - contribute_all: caller may auto-escalate per the routing matrix
 *
 * Identity: authored under the install's stable pseudonym (dpf-agent-<shortId>)
 * so the project team can thread replies to one contributor across issues.
 * See identity-privacy.ts and the 2026-04-18 spec for the identity model.
 */

import { prisma } from "@dpf/db";
import { getPlatformIdentity, redactHostnames } from "./identity-privacy";
import { resolveHiveToken } from "./identity-privacy";

// ─── Types ──────────────────────────────────────────────────────────────────

export type EscalationKind = "backlog" | "epic" | "issue-report";

export interface EscalateInput {
  kind: EscalationKind;
  id: string; // row id (cuid), NOT the human-readable itemId/epicId/reportId
}

export type EscalationResult =
  | { status: "created"; issueNumber: number; url: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

interface RepoCoordinates {
  owner: string;
  repo: string;
}

interface IssuePayload {
  title: string;
  body: string;
}

// ─── Source loading ─────────────────────────────────────────────────────────

interface NormalizedSource {
  title: string;
  body: string | null;
  severity: string | null;
  routeContext: string | null;
  errorStack: string | null;
  userAgent: string | null;
  humanId: string; // itemId / epicId / reportId — for display only
  upstreamIssueNumber: number | null;
}

async function loadSource(
  kind: EscalationKind,
  id: string,
): Promise<NormalizedSource | null> {
  if (kind === "backlog") {
    const row = await prisma.backlogItem.findUnique({
      where: { id },
      select: {
        itemId: true,
        title: true,
        body: true,
        upstreamIssueNumber: true,
      },
    });
    if (!row) return null;
    return {
      title: row.title,
      body: row.body,
      severity: null,
      routeContext: null,
      errorStack: null,
      userAgent: null,
      humanId: row.itemId,
      upstreamIssueNumber: row.upstreamIssueNumber,
    };
  }
  if (kind === "epic") {
    const row = await prisma.epic.findUnique({
      where: { id },
      select: {
        epicId: true,
        title: true,
        description: true,
        upstreamIssueNumber: true,
      },
    });
    if (!row) return null;
    return {
      title: row.title,
      body: row.description,
      severity: null,
      routeContext: null,
      errorStack: null,
      userAgent: null,
      humanId: row.epicId,
      upstreamIssueNumber: row.upstreamIssueNumber,
    };
  }
  const row = await prisma.platformIssueReport.findUnique({
    where: { id },
    select: {
      reportId: true,
      title: true,
      description: true,
      severity: true,
      routeContext: true,
      errorStack: true,
      userAgent: true,
      upstreamIssueNumber: true,
    },
  });
  if (!row) return null;
  return {
    title: row.title,
    body: row.description,
    severity: row.severity,
    routeContext: row.routeContext,
    errorStack: row.errorStack,
    userAgent: row.userAgent,
    humanId: row.reportId,
    upstreamIssueNumber: row.upstreamIssueNumber,
  };
}

// ─── Repo coordinate parsing ────────────────────────────────────────────────

export function parseGitHubRepo(remoteUrl: string): RepoCoordinates | null {
  const httpsMatch = remoteUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (httpsMatch?.[1] && httpsMatch?.[2]) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }
  const sshMatch = remoteUrl.match(/github\.com:([^/]+)\/([^/.]+)/);
  if (sshMatch?.[1] && sshMatch?.[2]) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }
  return null;
}

// ─── Issue payload building ─────────────────────────────────────────────────

const KIND_LABEL: Record<EscalationKind, string> = {
  backlog: "backlog-item",
  epic: "epic",
  "issue-report": "platform-issue-report",
};

/**
 * Builds the Markdown issue body. Pure function — safe to unit-test without
 * DB or network. Applies `redactHostnames` to every user-originated string
 * to defensively strip any leaked machine names before posting upstream.
 */
export function buildIssueBody(input: {
  kind: EscalationKind;
  pseudonym: string;
  source: NormalizedSource;
}): string {
  const { kind, pseudonym, source } = input;
  const sections: string[] = [
    `## Summary`,
    redactHostnames(source.title),
    ``,
    `## Reported by`,
    `Install: \`${pseudonym}\` — this pseudonym is stable across all issues and PRs from this install, so the project team can thread replies to one contributor over time.`,
    ``,
    `## Type`,
    `${KIND_LABEL[kind]}${source.severity ? ` · severity: ${source.severity}` : ""}${source.routeContext ? ` · route: ${source.routeContext}` : ""}`,
  ];

  if (source.body) {
    sections.push(``, `## Details`, redactHostnames(source.body));
  }

  if (kind === "issue-report" && source.errorStack) {
    sections.push(
      ``,
      `## Error context`,
      "```text",
      redactHostnames(source.errorStack),
      "```",
    );
    if (source.userAgent) {
      sections.push(``, `User agent: \`${redactHostnames(source.userAgent)}\``);
    }
  }

  sections.push(
    ``,
    `---`,
    `*Filed via Digital Product Factory. Local reference: \`${source.humanId}\`. Contributor privacy: real identity stays on the local install; the pseudonym above is the public contact handle.*`,
  );

  return sections.join("\n");
}

/**
 * Builds the issue title with the pseudonym as a prefix so the project
 * team can filter/sort by contributor in the GitHub issue list. The
 * final title is capped at 256 chars (GitHub's practical limit) by
 * shortening the title portion — the pseudonym prefix is preserved
 * since operators filter on it.
 */
const MAX_ISSUE_TITLE = 256;

export function buildIssueTitle(pseudonym: string, rawTitle: string): string {
  const prefix = `[${pseudonym}] `;
  const safeTitle = redactHostnames(rawTitle).trim();
  const budget = MAX_ISSUE_TITLE - prefix.length;
  const titleSegment =
    safeTitle.length > budget ? `${safeTitle.slice(0, budget - 3)}...` : safeTitle;
  return `${prefix}${titleSegment}`;
}

// ─── Labels ─────────────────────────────────────────────────────────────────

function buildLabels(kind: EscalationKind, severity: string | null): string[] {
  const labels = ["hive:submitted", `hive:${KIND_LABEL[kind]}`];
  if (severity) labels.push(`severity:${severity}`);
  return labels;
}

// ─── Persistence ────────────────────────────────────────────────────────────

async function recordEscalation(
  kind: EscalationKind,
  id: string,
  issueNumber: number,
  url: string,
): Promise<void> {
  const now = new Date();
  const data = {
    upstreamIssueNumber: issueNumber,
    upstreamIssueUrl: url,
    upstreamSyncedAt: now,
  };
  if (kind === "backlog") {
    await prisma.backlogItem.update({ where: { id }, data });
    return;
  }
  if (kind === "epic") {
    await prisma.epic.update({ where: { id }, data });
    return;
  }
  await prisma.platformIssueReport.update({ where: { id }, data });
}

// ─── GitHub API ─────────────────────────────────────────────────────────────

interface CreateIssueResponse {
  number?: number;
  html_url?: string;
  message?: string;
}

async function postIssue(args: {
  coordinates: RepoCoordinates;
  token: string;
  payload: IssuePayload;
  labels: string[];
}): Promise<{ number: number; url: string } | { error: string }> {
  const { coordinates, token, payload, labels } = args;
  const apiUrl = `https://api.github.com/repos/${coordinates.owner}/${coordinates.repo}/issues`;

  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: payload.title,
        body: payload.body,
        labels,
      }),
    });
  } catch (err) {
    return { error: `Network error: ${(err as Error).message}` };
  }

  let data: CreateIssueResponse;
  try {
    data = (await response.json()) as CreateIssueResponse;
  } catch {
    return { error: `GitHub returned ${response.status} with unparseable body` };
  }

  if (!response.ok) {
    const msg = data?.message ?? `status ${response.status}`;
    return { error: `GitHub API error: ${msg}` };
  }
  if (typeof data.number !== "number" || typeof data.html_url !== "string") {
    return { error: "GitHub response missing number/html_url" };
  }
  return { number: data.number, url: data.html_url };
}

// ─── Main entry point ──────────────────────────────────────────────────────

/**
 * Escalates a local item to the upstream hive repo as a GitHub Issue.
 *
 * Returns `skipped` (with reason) when the install is in fork_only mode,
 * the item is already escalated, upstream coordinates are missing, or no
 * hive token is available. Returns `failed` on network or GitHub API
 * errors. Returns `created` with the issue number/url on success.
 *
 * This function does NOT decide WHEN to escalate — the routing matrix
 * (auto vs. user-prompted per severity) lives in the caller. See the
 * 2026-04-18 spec for the policy.
 */
export async function escalateToUpstreamIssue(
  input: EscalateInput,
): Promise<EscalationResult> {
  const source = await loadSource(input.kind, input.id);
  if (!source) {
    return { status: "failed", error: `${input.kind} ${input.id} not found` };
  }
  if (source.upstreamIssueNumber != null) {
    return {
      status: "skipped",
      reason: `already escalated as issue #${source.upstreamIssueNumber}`,
    };
  }

  const config = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { contributionMode: true, upstreamRemoteUrl: true },
  });

  if (!config) {
    return {
      status: "skipped",
      reason: "platform development policy not configured",
    };
  }
  if (config.contributionMode === "fork_only") {
    return {
      status: "skipped",
      reason: "contribution mode is fork_only — no upstream escalation",
    };
  }
  if (!config.upstreamRemoteUrl) {
    return {
      status: "skipped",
      reason: "upstreamRemoteUrl not configured on PlatformDevConfig",
    };
  }

  const coordinates = parseGitHubRepo(config.upstreamRemoteUrl);
  if (!coordinates) {
    return {
      status: "skipped",
      reason: `could not parse GitHub coordinates from ${config.upstreamRemoteUrl}`,
    };
  }

  const token = await resolveHiveToken();
  if (!token) {
    return {
      status: "skipped",
      reason: "no hive contribution token available",
    };
  }

  const identity = await getPlatformIdentity();
  const payload: IssuePayload = {
    title: buildIssueTitle(identity.authorName, source.title),
    body: buildIssueBody({
      kind: input.kind,
      pseudonym: identity.authorName,
      source,
    }),
  };
  const labels = buildLabels(input.kind, source.severity);

  const result = await postIssue({ coordinates, token, payload, labels });
  if ("error" in result) {
    return { status: "failed", error: result.error };
  }

  try {
    await recordEscalation(input.kind, input.id, result.number, result.url);
  } catch (err) {
    return {
      status: "failed",
      error: `Issue created (#${result.number}) but failed to persist link: ${(err as Error).message}`,
    };
  }

  return { status: "created", issueNumber: result.number, url: result.url };
}
