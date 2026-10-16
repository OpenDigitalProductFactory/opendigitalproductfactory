// The deterministic executor for the weekly `client-capability-reverify`
// scheduled task (BI-64795FD0). Extracted so the scheduler's dispatcher stays a
// thin discriminator, like executeDemandScoringStewardTask.
//
// Off the LLM path: it fetches only the profile's declared sources, compares
// them with the last snapshot, and files proposals through the shared backlog
// intake. It never writes the profile, the credential policy or any client
// configuration; the profile ships in the image and changes only by a PR.

import { prisma } from "@dpf/db";
import { CLIENT_CAPABILITY_PROFILE } from "@dpf/integration-shared/client-capability-profile";

import { computeNextCronRun } from "@/lib/operate/cron-next-run";
import { err, ok } from "@/lib/shared/action-result";
import { ingestBacklogItem, type BacklogIngestInput, type BacklogIngestResult } from "@/lib/operate/backlog-ingest";

import { CLIENT_CAPABILITY_INTAKE_KIND } from "./client-capability-drift";
import {
  VERIFICATION_STATE_KEY,
  newestCliVersions,
  readVerificationState,
  runClientCapabilityReverification,
  type CapabilityProposal,
  type ReverifyResult,
  type SourceFetch,
} from "./client-capability-reverify";

export const CLIENT_CAPABILITY_NOTIFICATION_CATEGORY = "client-capability-verification";
const FETCH_TIMEOUT_MS = 15_000;
const MAX_PAGE_CHARS = 2_000_000;
const TERMINAL = ["done", "deferred", "retired"];

export interface ClientCapabilityReverifyTask {
  taskId: string;
  schedule: string;
  agentId: string;
  taskConfig?: unknown;
}

/** GET one declared source as text; any failure is a reason, never a throw. */
export const fetchDeclaredSource: SourceFetch = async (url) => {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "text/html, text/markdown, text/plain;q=0.9, */*;q=0.1" },
    });
    if (!response.ok) return err(`HTTP ${response.status}`);
    const type = response.headers.get("content-type") ?? "";
    if (type && !/text|json|xml|markdown/i.test(type)) return err(`unexpected content type ${type}`);
    return ok((await response.text()).slice(0, MAX_PAGE_CHARS));
  } catch (error) {
    return err(error instanceof Error ? error.message : "fetch failed");
  }
};

function proposalBody(proposal: CapabilityProposal): string {
  const lines = [
    `The weekly client-capability re-verification found something to check for ${proposal.clientKind}.`,
    `Profile verified on: ${proposal.verifiedVersion ?? "no version"}.`,
  ];
  if (proposal.reportedVersion) lines.push(`The updater reports ${proposal.clientKind} ${proposal.reportedVersion}, which the profile has not verified.`);
  for (const finding of proposal.findings) {
    lines.push("", `- Field \`${finding.field}\` (now ${finding.currentValue}). Proposed: ${finding.proposedValue}.`, `  Source: ${finding.source}`, `  > ${finding.passage}`);
  }
  lines.push(
    "",
    "This is a proposal. Change packages/dpf-skill-pack/client-capabilities.json only by a PR that cites the passage and a live probe on the dev install. Until then every rule keeps the last verified value.",
    "Design: docs/superpowers/specs/2026-10-07-agent-toolchain-release-delivery-design.md §5.5 (BI-64795FD0).",
  );
  return lines.join("\n");
}

type Db = typeof prisma;

function describeRun(result: ReverifyResult): string {
  const parts = [`${result.proposals.length} proposal(s)`, `${result.failures.length} failed source(s)`];
  if (result.notified) parts.push("notification raised");
  return parts.join("; ");
}

export async function executeClientCapabilityReverifyTask(
  task: ClientCapabilityReverifyTask,
  deps: {
    now?: Date;
    db?: Db;
    fetchSource?: SourceFetch;
    ingest?: (input: BacklogIngestInput) => Promise<BacklogIngestResult>;
  } = {},
): Promise<ReverifyResult | null> {
  const db = deps.db ?? prisma;
  const now = deps.now ?? new Date();
  const nextRunAt = computeNextCronRun(task.schedule, now);
  const ingest = deps.ingest ?? ((input: BacklogIngestInput) => ingestBacklogItem(input));
  try {
    const reports = await db.agentSurfaceReadiness.findMany({
      orderBy: { reportedAt: "desc" },
      take: 200,
      select: { clientKind: true, detail: true },
    });
    const result = await runClientCapabilityReverification({
      profile: CLIENT_CAPABILITY_PROFILE,
      reportedCliVersions: newestCliVersions(reports),
      state: readVerificationState(task.taskConfig),
      now,
      fetchSource: deps.fetchSource ?? fetchDeclaredSource,
      fileItem: async (proposal) => {
        const item = await ingest({
          title: `Re-verify ${proposal.clientKind} capabilities for ${proposal.clientVersion}`,
          body: proposalBody(proposal),
          workType: "chore",
          source: "automated-detection",
          agentId: task.agentId,
          origin: { kind: CLIENT_CAPABILITY_INTAKE_KIND, id: `${proposal.clientKind}@${proposal.clientVersion}` },
        });
        await db.backlogItemActivity.create({
          data: {
            backlogItemId: item.id,
            kind: "evidence",
            summary: `Weekly re-verification: ${proposal.findings.length} source passage(s) to check`,
            payload: { runAt: now.toISOString(), taskId: task.taskId, proposal } as never,
            recordedByAgentId: task.agentId,
          },
        });
        return { itemId: item.itemId, created: item.created };
      },
      recordOnOpenItem: async (clientKind, payload) => {
        const open = await db.backlogItem.findFirst({
          where: { body: { contains: `[origin:${CLIENT_CAPABILITY_INTAKE_KIND}:${clientKind}@` }, status: { notIn: TERMINAL } },
          select: { id: true, itemId: true },
          orderBy: { createdAt: "desc" },
        });
        if (!open) return null;
        await db.backlogItemActivity.create({
          data: {
            backlogItemId: open.id,
            kind: "evidence",
            summary: `Weekly re-verification could not read ${payload.failures.length} source(s)`,
            payload: { ...payload, taskId: task.taskId } as never,
            recordedByAgentId: task.agentId,
          },
        });
        return open.itemId;
      },
      notify: async (message) => {
        await db.platformNotification.create({
          data: { severity: "warning", category: CLIENT_CAPABILITY_NOTIFICATION_CATEGORY, subjectId: task.taskId, message },
        });
      },
      resolveNotifications: async () => {
        await db.platformNotification.updateMany({
          where: { category: CLIENT_CAPABILITY_NOTIFICATION_CATEGORY, resolvedAt: null },
          data: { resolvedAt: now },
        });
      },
    });
    const config = task.taskConfig && typeof task.taskConfig === "object" && !Array.isArray(task.taskConfig) ? task.taskConfig : {};
    const lastStatus = result.failures.length ? "error" : result.proposals.length ? "proposed" : "ok";
    const lastError = result.failures.length ? result.failures.join("; ").slice(0, 2_000) : null;
    const summary = describeRun(result);
    console.info("[client-capability-reverify] %s", summary);
    await db.scheduledAgentTask.update({
      where: { taskId: task.taskId },
      data: { lastRunAt: now, lastStatus, lastError, nextRunAt, taskConfig: { ...config, [VERIFICATION_STATE_KEY]: result.state } as never },
    });
    await db.scheduledJob
      .update({ where: { jobId: task.taskId }, data: { lastRunAt: now, lastStatus, lastError, lastRunSummary: summary, nextRunAt } })
      .catch(() => {});
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    await db.scheduledAgentTask.update({
      where: { taskId: task.taskId },
      data: { lastRunAt: now, lastStatus: "error", lastError: message, nextRunAt },
    });
    await db.scheduledJob
      .update({ where: { jobId: task.taskId }, data: { lastRunAt: now, lastStatus: "error", lastError: message, nextRunAt } })
      .catch(() => {});
    return null;
  }
}
