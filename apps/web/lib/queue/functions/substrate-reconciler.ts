// BI-903FB5F9 slice C / BI-547B788D — keep required substrate running and report
// a wedged Docker VM. Every 5 minutes; skipped while the portal is quiescing for
// a self-upgrade (the swap owns container lifecycle then). Logic and tests live in
// lib/platform-runtime/substrate-reconciler.ts; this file only wires real I/O.

import { AI_TURN_CLAIM_PREFIX } from "@/lib/nonprod/environment-lease-overseer";
import { hostname as osHostname } from "node:os";
import { readFile } from "node:fs/promises";

import { cron } from "@/lib/jobs/triggers";
import { prisma } from "@dpf/db";
import { jobs } from "@/lib/jobs";
import { gateAtEntry } from "../quiescence-gates";
import { dockerSocketGet } from "@/lib/platform-runtime/docker-socket.mjs";
import { loadOperationalCapabilityState, observeDockerProjectServices } from "@/lib/platform-runtime/operational-state";
import { getQuiescenceLevel, parseQuiescenceConfig, QUIESCENCE_CONFIG_KEY } from "@/lib/self-upgrade/quiescence";
import { lockScopeEpochEnrollmentAdmission } from "@/lib/work-capsules/scope-epoch-enrollment.server";
import type { CapsuleDb } from "@/lib/work-capsules/work-capsule-store-types";
import { hasPrivateActuatorMount, reconcileActuatorSubstrate } from "../../../../../scripts/lib/scope-writer-observation.mjs";
import {
  reconcileSubstrate,
  type SubstrateContainer,
  type TopRow,
} from "@/lib/platform-runtime/substrate-reconciler";
import { openMonitorIssue, resolveMonitorIssue, type MonitorIssueDb } from "@/lib/observability/monitor-issue-writer";
import { runProcessWithBudget } from "@/lib/shared/run-process-with-budget";
import { err, ok } from "@/lib/shared/action-result";
import { LOCAL_CI_LIVENESS_WINDOW_MS } from "@/lib/nonprod/local-ci-pool-liveness";
import {
  convergeHostUpkeepOnInstallerNodes,
  type HostUpkeepConvergenceDb,
} from "@/lib/edge-node/host-upkeep-convergence";

type DockerSummary = { Id: string; Names?: string[]; State?: string; Labels?: Record<string, string> };
type DockerInspect = {
  Id?: string;
  HostConfig?: { RestartPolicy?: { Name?: string } };
  Config?: { Labels?: Record<string, string> };
  State?: { FinishedAt?: string; ExitCode?: number; Running?: boolean };
};
type DockerTop = { Titles?: string[]; Processes?: string[][] };

const TOP_COLUMNS = "-o pid,stat,etime,wchan,comm";
// The established db-handle boundary cast (alert-delivery-bridge.ts:92).
const monitorDb = prisma as unknown as MonitorIssueDb;

type DockerGet = (path: string) => Promise<unknown>;

/**
 * The container finds its compose project by inspecting itself under the
 * hostname Docker gives it (the container id), read from the OS. Not
 * process.env.HOSTNAME: the portal image sets that to 0.0.0.0 as the Next.js
 * bind address, so every run inspected /containers/0.0.0.0/json and 404'd
 * (BI-3925A700 is the same trap in operational-state.ts). An unreadable
 * self-inspect leaves every container outside the project, which restarts
 * nothing but still lets wedge detection run.
 */
export async function listSubstrateContainers(
  get: DockerGet = dockerSocketGet,
  selfHostname: string = osHostname(),
): Promise<SubstrateContainer[]> {
  let project: string | null = null;
  if (selfHostname) {
    try {
      const self = await get(`/containers/${encodeURIComponent(selfHostname)}/json`) as DockerInspect;
      project = self?.Config?.Labels?.["com.docker.compose.project"] ?? null;
    } catch {
      project = null;
    }
  }
  const summaries = await get("/containers/json?all=1") as DockerSummary[];
  const containers: SubstrateContainer[] = [];
  for (const summary of summaries) {
    const inProject = Boolean(project) && summary.Labels?.["com.docker.compose.project"] === project;
    const state = String(summary.State ?? "").toLowerCase();
    // Only an exited project container can be restarted, so only it needs the
    // restart policy and stop time (one inspect per such container, not per container).
    const inspected = inProject && state === "exited"
      ? await get(`/containers/${encodeURIComponent(summary.Id)}/json`) as DockerInspect
      : null;
    const restartPolicy = String(inspected?.HostConfig?.RestartPolicy?.Name ?? "");
    containers.push({
      id: summary.Id,
      name: String(summary.Names?.[0] ?? summary.Id).replace(/^\//, ""),
      service: summary.Labels?.["com.docker.compose.service"] ?? null,
      state,
      restartPolicy,
      inProject,
      stoppedAt: inspected?.State?.FinishedAt ?? null,
      exitCode: typeof inspected?.State?.ExitCode === "number" ? inspected.State.ExitCode : null,
    });
  }
  return containers;
}

async function requiredServices(): Promise<Set<string> | null> {
  try {
    const state = await loadOperationalCapabilityState({ observedProviders: {},
      readObservedServices: () => observeDockerProjectServices(dockerSocketGet) });
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

/** The private actuator derives targets and checks present admission at start. */
export async function reconcileSubstrateAtDaemon(actuatorProject?: string) {
  if (actuatorProject && await getQuiescenceLevel() !== "normal") return { skipped: true, reason: "quiescence" };
  return reconcileSubstrate({
    listContainers: () => listSubstrateContainers(),
    requiredServices,
    startContainer: async (container) => {
      if (!/^[a-f0-9]{64}$/.test(container.id)) return err("container_identity_unproven");
      const start = async (timeoutMs: number) => {
        const started = await runProcessWithBudget("docker", ["start", container.id], {
          timeoutMs, timeoutLabel: "substrate-reconciler-start",
        });
        return started.exitCode === 0 ? ok() : err((started.stderr || `docker start exited ${started.exitCode}`).trim().slice(0, 300));
      };
      if (!actuatorProject) return start(30_000);
      try {
        return await prisma.$transaction(async tx => {
          await lockScopeEpochEnrollmentAdmission(tx as unknown as CapsuleDb);
          const config = await tx.platformConfig.findUnique({ where: { key: QUIESCENCE_CONFIG_KEY } });
          if (parseQuiescenceConfig(config?.value).level !== "normal") return err("quiescence");
          const live = await dockerSocketGet(`/containers/${container.id}/json`) as DockerInspect;
          if (live?.Id !== container.id || live.State?.Running !== false
            || live.Config?.Labels?.["com.docker.compose.project"] !== actuatorProject
            || live.Config.Labels["com.docker.compose.service"] !== container.service
            || live.HostConfig?.RestartPolicy?.Name !== container.restartPolicy
            || live.State.FinishedAt !== container.stoppedAt || live.State.ExitCode !== container.exitCode) {
            return err("container_binding_changed");
          }
          return start(5_000);
        }, { timeout: 15_000 });
      } catch { return err("runtime_admission_unavailable"); }
    },
    topProcesses,
    openIssue: async (issue) => {
      await openMonitorIssue(monitorDb, { ...issue, issueType: "health_alert" });
    },
    resolveIssue: (issueKey) => resolveMonitorIssue(monitorDb, issueKey),
    localCiLeases: () => prisma.nonProductionEnvironmentLease.findMany({
      where: {
        environmentKey: "local-integration-ci",
        admittedAt: { gte: new Date(Date.now() - LOCAL_CI_LIVENESS_WINDOW_MS) },
        // A served AI turn is a queue placeholder and never records a gate result.
        OR: [{ claimKey: null }, { NOT: { claimKey: { startsWith: AI_TURN_CLAIM_PREFIX } } }],
      },
      select: { leaseId: true, admittedAt: true, releasedAt: true, evidenceRecordId: true, status: true },
    }),
    now: () => new Date(),
  });
}

export const substrateReconciler = jobs.createFunction(
  { id: "ops/substrate-reconciler", retries: 0, triggers: [cron("4,9,14,19,24,29,34,39,44,49,54,59 * * * *")] },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "ops/substrate-reconciler");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    // BI-28EFE18A: the install's own edge node carries host upkeep. Converge it
    // once per node; a failure here never blocks the substrate pass below.
    await step.run("converge-host-upkeep", async () => {
      try {
        return await convergeHostUpkeepOnInstallerNodes(prisma as unknown as HostUpkeepConvergenceDb);
      } catch (error) {
        return { converged: [], error: error instanceof Error ? error.message : String(error) };
      }
    });
    return step.run("reconcile-substrate", async () => {
      if (await readFile("/proc/self/mountinfo").then(hasPrivateActuatorMount, () => false)) return reconcileActuatorSubstrate();
      return reconcileSubstrateAtDaemon();
    });
  },
);
