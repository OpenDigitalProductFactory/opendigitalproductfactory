// BI-903FB5F9 slice C / BI-547B788D — keep required substrate running and report
// a wedged Docker VM. Every 5 minutes; skipped while the portal is quiescing for
// a self-upgrade (the swap owns container lifecycle then). Logic and tests live in
// lib/platform-runtime/substrate-reconciler.ts; this file only wires real I/O.

import { cron } from "@/lib/jobs/triggers";
import { prisma } from "@dpf/db";
import { jobs } from "@/lib/jobs";
import { gateAtEntry } from "../quiescence-gates";
import { dockerSocketGet } from "@/lib/platform-runtime/docker-socket.mjs";
import { loadOperationalCapabilityState } from "@/lib/platform-runtime/operational-state";
import {
  reconcileSubstrate,
  type SubstrateContainer,
  type TopRow,
} from "@/lib/platform-runtime/substrate-reconciler";
import { openMonitorIssue, resolveMonitorIssue, type MonitorIssueDb } from "@/lib/observability/monitor-issue-writer";
import { runProcessWithBudget } from "@/lib/shared/run-process-with-budget";
import { err, ok } from "@/lib/shared/action-result";

type DockerSummary = { Id: string; Names?: string[]; State?: string; Labels?: Record<string, string> };
type DockerInspect = { HostConfig?: { RestartPolicy?: { Name?: string } }; Config?: { Labels?: Record<string, string> } };
type DockerTop = { Titles?: string[]; Processes?: string[][] };

const TOP_COLUMNS = "-o pid,stat,etime,wchan,comm";
// The established db-handle boundary cast (alert-delivery-bridge.ts:92).
const monitorDb = prisma as unknown as MonitorIssueDb;

async function listContainers(): Promise<SubstrateContainer[]> {
  const hostname = process.env.HOSTNAME;
  const self = hostname
    ? await dockerSocketGet(`/containers/${encodeURIComponent(hostname)}/json`) as DockerInspect
    : null;
  const project = self?.Config?.Labels?.["com.docker.compose.project"] ?? null;
  const summaries = await dockerSocketGet("/containers/json?all=1") as DockerSummary[];
  const containers: SubstrateContainer[] = [];
  for (const summary of summaries) {
    const inProject = Boolean(project) && summary.Labels?.["com.docker.compose.project"] === project;
    const state = String(summary.State ?? "").toLowerCase();
    // Only an exited project container can be restarted, so only it needs the
    // restart policy (one inspect per such container, not per container).
    const restartPolicy = inProject && state === "exited"
      ? String((await dockerSocketGet(`/containers/${encodeURIComponent(summary.Id)}/json`) as DockerInspect)
        .HostConfig?.RestartPolicy?.Name ?? "")
      : "";
    containers.push({
      id: summary.Id,
      name: String(summary.Names?.[0] ?? summary.Id).replace(/^\//, ""),
      service: summary.Labels?.["com.docker.compose.service"] ?? null,
      state,
      restartPolicy,
      inProject,
    });
  }
  return containers;
}

async function requiredServices(): Promise<Set<string> | null> {
  try {
    const state = await loadOperationalCapabilityState({ observedProviders: {} });
    return new Set(state.serviceRequirements.map((requirement) => requirement.service));
  } catch {
    return null;
  }
}

async function topProcesses(container: SubstrateContainer): Promise<TopRow[]> {
  const top = await dockerSocketGet(
    `/containers/${encodeURIComponent(container.id)}/top?ps_args=${encodeURIComponent(TOP_COLUMNS)}`,
  ) as DockerTop;
  const titles = (top.Titles ?? []).map((title) => title.toUpperCase());
  const at = (row: string[], title: string) => row[titles.indexOf(title)] ?? "";
  return (top.Processes ?? []).map((row) => ({
    pid: at(row, "PID"),
    stat: at(row, "STAT"),
    etime: at(row, "ELAPSED") || at(row, "ETIME"),
    wchan: at(row, "WCHAN"),
    comm: at(row, "COMMAND") || at(row, "COMM"),
  }));
}

export const substrateReconciler = jobs.createFunction(
  { id: "ops/substrate-reconciler", retries: 0, triggers: [cron("4,9,14,19,24,29,34,39,44,49,54,59 * * * *")] },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "ops/substrate-reconciler");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return step.run("reconcile-substrate", () => reconcileSubstrate({
      listContainers,
      requiredServices,
      startContainer: async (container) => {
        const started = await runProcessWithBudget("docker", ["start", container.id], {
          timeoutMs: 30_000,
          timeoutLabel: "substrate-reconciler-start",
        });
        return started.exitCode === 0
          ? ok()
          : err((started.stderr || `docker start exited ${started.exitCode}`).trim().slice(0, 300));
      },
      topProcesses,
      openIssue: async (issue) => {
        await openMonitorIssue(monitorDb, { ...issue, issueType: "health_alert" });
      },
      resolveIssue: (issueKey) => resolveMonitorIssue(monitorDb, issueKey),
      now: () => new Date(),
    }));
  },
);
