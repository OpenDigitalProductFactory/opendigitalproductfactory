/**
 * Substrate reconciler (BI-903FB5F9 slice C, BI-547B788D; WWMD DI-46E06C5441CF).
 *
 * The founder directive: host upkeep is platform function, including dealing
 * with problems when they occur. Two problems observed on 2026-09-25/26 had no
 * owner:
 *
 * 1. dpf-sandbox-1 was repeatedly stopped (docker stop: TERM, KILL after 3 s)
 *    and, being `restart: unless-stopped`, never came back. Reviewer inference
 *    runs through it, so every independent review stalled for hours until an
 *    agent ran recover_sandbox by hand.
 * 2. The Docker Desktop VM wedged: `sync` processes sat in uninterruptible
 *    sleep in fuse_sync_fs for 33 h, `docker kill` could not remove their
 *    containers, and nothing told anyone.
 *
 * Every run, this reconciler:
 * - starts any container of a service the enabled runtime capabilities
 *   REQUIRE, whose restart policy says it should be running, and which is found
 *   exited. The policy check excludes one-shot init containers; the required
 *   set excludes optional or disabled capabilities. If the required set cannot
 *   be read, it restarts nothing (fail closed).
 * - reads each running container's processes through the Docker Engine `top`
 *   endpoint (ps runs inside the VM) and raises ONE condition when any process
 *   has sat in D state for more than ten minutes. Only a Docker VM (WSL)
 *   restart clears such a process, and that stops the portal, every container
 *   and running gates, so the condition says so. The operator approves the
 *   restart on the Health tab; the native Edge agent runs it on the host
 *   (lib/remote-action/docker-vm-restart-action.ts, BI-F8F8C383).
 * - measures local-CI pool liveness and raises one condition when admissions
 *   keep ending without a recorded result (BI-277ECBDB).
 *
 * All I/O is injected; the cron wrapper lives in queue/functions.
 */

import type { ActionResult } from "@/lib/shared/action-result";
import {
  LOCAL_CI_POOL_STALLED_ISSUE_KEY,
  assessLocalCiPoolLiveness,
  type LocalCiLeaseLivenessRow,
} from "@/lib/nonprod/local-ci-pool-liveness";

export const DOCKER_VM_WEDGED_ISSUE_KEY = "substrate:docker-vm-wedged";
export const WEDGED_AFTER_SECONDS = 10 * 60;
const RESTART_POLICIES = new Set(["always", "unless-stopped"]);

export function substrateRestartIssueKey(service: string): string {
  return `substrate:service-restarted:${service}`;
}

export type SubstrateContainer = {
  id: string;
  name: string;
  /** Compose service name, or null for a container outside the project. */
  service: string | null;
  state: string;
  restartPolicy: string;
  inProject: boolean;
  /** When an exited container stopped and its exit code, from inspect (BI-547B788D). */
  stoppedAt?: string | null;
  exitCode?: number | null;
};

export type TopRow = { pid: string; stat: string; etime: string; wchan: string; comm: string };

export type SubstrateIssue = {
  issueKey: string;
  severity: "info" | "warn" | "error";
  summary: string;
  details: unknown;
};

export type SubstrateDeps = {
  listContainers: () => Promise<SubstrateContainer[]>;
  /** Services the enabled runtime capabilities require; null when unreadable. */
  requiredServices: () => Promise<Set<string> | null>;
  startContainer: (container: SubstrateContainer) => Promise<ActionResult>;
  topProcesses: (container: SubstrateContainer) => Promise<TopRow[]>;
  openIssue: (issue: SubstrateIssue) => Promise<void>;
  resolveIssue: (issueKey: string) => Promise<void>;
  now: () => Date;
  /** Recent local-integration-ci leases for the pool liveness check; omitted, the check is skipped. */
  localCiLeases?: () => Promise<LocalCiLeaseLivenessRow[]>;
};

export type SubstrateResult = {
  restarted: string[];
  restartFailed: string[];
  restartSkippedReason: string | null;
  wedged: number;
  topUnreadable: number;
  /** null when the lease table could not be read or the check was not wired. */
  localCiPoolDegraded: boolean | null;
};

/** ps `etime`: [[dd-]hh:]mm:ss, in seconds; null when unreadable. */
export function parseEtimeSeconds(text: string): number | null {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(String(text ?? "").trim());
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  return Number(days ?? 0) * 86400 + Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds);
}

export async function reconcileSubstrate(deps: SubstrateDeps): Promise<SubstrateResult> {
  const containers = await deps.listContainers();
  const result: SubstrateResult = {
    restarted: [],
    restartFailed: [],
    restartSkippedReason: null,
    wedged: 0,
    topUnreadable: 0,
    localCiPoolDegraded: null,
  };
  const at = deps.now().toISOString();

  const required = await deps.requiredServices();
  if (!required) {
    result.restartSkippedReason = "required services could not be read; nothing restarted";
  } else {
    for (const container of containers) {
      if (!container.inProject || !container.service || !required.has(container.service)) continue;
      const issueKey = substrateRestartIssueKey(container.service);
      if (container.state === "running") {
        await deps.resolveIssue(issueKey);
        continue;
      }
      if (container.state !== "exited" || !RESTART_POLICIES.has(container.restartPolicy)) continue;
      const started = await deps.startContainer(container);
      if (started.ok) {
        result.restarted.push(container.service);
        const stopped = container.stoppedAt
          ? ` It had exited ${container.exitCode ?? "?"} at ${container.stoppedAt}; match that time against the host's process audit to find what stopped it.`
          : "";
        await deps.openIssue({
          issueKey,
          severity: "warn",
          summary: `Required service ${container.service} (${container.name}) was found stopped and the platform restarted it at ${at}. A repeat means something keeps stopping it.${stopped}`,
          details: {
            source: "substrate-reconciler",
            container: container.name,
            service: container.service,
            restartedAt: at,
            stoppedAt: container.stoppedAt ?? null,
            exitCode: container.exitCode ?? null,
          },
        });
      } else {
        result.restartFailed.push(container.service);
        await deps.openIssue({
          issueKey,
          severity: "error",
          summary: `Required service ${container.service} (${container.name}) is stopped and the platform could not restart it: ${started.error}`,
          details: { source: "substrate-reconciler", container: container.name, service: container.service, error: started.error, observedAt: at },
        });
      }
    }
  }

  const stuck: Array<TopRow & { container: string; seconds: number }> = [];
  for (const container of containers) {
    if (container.state !== "running") continue;
    let rows: TopRow[];
    try {
      rows = await deps.topProcesses(container);
    } catch {
      result.topUnreadable += 1;
      continue;
    }
    for (const row of rows) {
      const seconds = parseEtimeSeconds(row.etime);
      if (row.stat.startsWith("D") && seconds !== null && seconds >= WEDGED_AFTER_SECONDS) {
        stuck.push({ ...row, container: container.name, seconds });
      }
    }
  }
  result.wedged = stuck.length;
  if (stuck.length > 0) {
    const where = [...new Set(stuck.map((row) => row.container))].join(", ");
    await deps.openIssue({
      issueKey: DOCKER_VM_WEDGED_ISSUE_KEY,
      severity: "error",
      summary: `${stuck.length} process${stuck.length === 1 ? "" : "es"} in ${where} ${stuck.length === 1 ? "has" : "have"} been stuck in uninterruptible I/O for over ${WEDGED_AFTER_SECONDS / 60} minutes. Their containers cannot be stopped; only a Docker VM restart clears them, and that stops the portal, every container and any running gate. An operator can approve one from the portal Health tab (Restart Docker VM).`,
      details: {
        source: "substrate-reconciler",
        observedAt: at,
        stuck: stuck.map(({ container, pid, stat, etime, wchan, comm }) => ({ container, pid, stat, etime, wchan, comm })),
      },
    });
  } else if (result.topUnreadable === 0) {
    await deps.resolveIssue(DOCKER_VM_WEDGED_ISSUE_KEY);
  }

  if (deps.localCiLeases) {
    let leases: LocalCiLeaseLivenessRow[] | null = null;
    try {
      leases = await deps.localCiLeases();
    } catch {
      leases = null;
    }
    if (leases) {
      const liveness = assessLocalCiPoolLiveness({ leases, now: deps.now() });
      result.localCiPoolDegraded = liveness.degraded;
      if (liveness.degraded) {
        await deps.openIssue({
          issueKey: LOCAL_CI_POOL_STALLED_ISSUE_KEY,
          severity: "error",
          summary: liveness.summary,
          details: {
            source: "substrate-reconciler",
            observedAt: at,
            windowMs: liveness.windowMs,
            admittedWithoutResult: liveness.admittedWithoutResult,
            stalledLeaseIds: liveness.stalledLeaseIds,
          },
        });
      } else {
        await deps.resolveIssue(LOCAL_CI_POOL_STALLED_ISSUE_KEY);
      }
    }
  }
  return result;
}
