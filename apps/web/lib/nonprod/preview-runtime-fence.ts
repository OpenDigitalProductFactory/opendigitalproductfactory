import { hostname } from "node:os";
import { prisma } from "@dpf/db";
import { dockerSocketGet, dockerSocketStop } from "@/lib/platform-runtime/docker-socket.mjs";
import { isImmutableGateClaimKey } from "@/lib/gates/gate-run-identity";
import { previewMountMatches } from "../../../../packages/integration-shared/src/preview-mount-identity.cjs";
import { deterministicNonprodWaitTaskRunId } from "./durable-wait";
import { ownsProcessFreeLease } from "./environment-lease-provenance";
import type { LeaseRow } from "./environment-lease-result";
import { isRecord } from "../shared/coerce";

type PreviewTask = { taskRunId: string; userId: string; initiatingAgentId?: string | null; progressPayload: unknown; status: string };
type Container = {
  Id?: string; Name?: string;
  Config?: { Labels?: Record<string, string>; Env?: string[] };
  Mounts?: Array<{ Type: string; Source: string; Destination: string }>;
  State?: { Running?: boolean };
  NetworkSettings?: { Ports?: Record<string, Array<{ HostIp: string; HostPort: string }> | null> };
};
type Outcome = { containerId: string; leaseId?: string; state: "stopped" | "absent" | "held" | "pending"; reason?: string };
export type PreviewFenceResult = { checked: number; stopped: number; held: number; pending: number; truncated: boolean; outcomes: Outcome[] };
type Dependencies = {
  get?: (path: string) => Promise<unknown>; stop?: (id: string) => Promise<unknown>;
  readLease?: (id: string) => Promise<LeaseRow | null>;
  readTask?: (id: string) => Promise<PreviewTask | null>;
  readSource?: (lease: LeaseRow, sha: string) => Promise<{ headSha: string | null; repositoryFullName: string | null } | null>;
  selfHostname?: string; now?: Date;
};
const MAX_CONTAINERS_PER_PASS = 4;
const RECONCILE_INTERVAL_MS = 300_000;
const TERMINAL = new Set(["expired", "released", "cancelled"]);
const date = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());

/** A clock observation is not expiry authority. Only the existing committed,
 * serialized terminal transition can authorize this independent cleanup. */
function terminalPreview(lease: LeaseRow, now: Date): string | null {
  if (!TERMINAL.has(lease.status) || lease.activeKey !== null || !date(lease.releasedAt)
    || lease.releasedAt > now || !date(lease.expiresAt)
    || (lease.status === "expired" && lease.expiresAt > lease.releasedAt)
    || lease.admissionHistoryVersion !== 1 || !date(lease.firstAdmittedAt) || !date(lease.admittedAt)
    || lease.firstAdmittedAt > lease.admittedAt || lease.admittedAt > lease.releasedAt
    || !["local-integration-ci", "active-candidate"].includes(lease.environmentKey)
    || !lease.claimKey || isImmutableGateClaimKey(lease.claimKey)
    || lease.slotManifestVersion !== null || lease.buildId !== null
    || lease.ownerPid !== null || lease.ownerProcessIdentity !== null
    || lease.resourceClass !== null || lease.expectedMemoryBytes !== null
    || !lease.worktreePath || !lease.branchName || !lease.taskRunId
    || lease.ports.length !== 1 || lease.ports[0] !== 3001) return null;
  let url: URL;
  try { url = new URL(lease.url); } catch { return null; }
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname)
    || url.port !== "3001" || url.pathname !== "/" || url.username || url.password || url.search || url.hash) return null;
  // This audited immutable admission description is also checked against the
  // durable owner pins, source Workroom, actual mount and container identity.
  const prefix = `Contributor preview (:3001) bound to ${lease.worktreePath} @ ${lease.branchName} (`;
  const suffix = lease.purpose.startsWith(prefix) ? lease.purpose.slice(prefix.length) : "";
  return /^[a-f0-9]{40}\)$/.test(suffix) ? suffix.slice(0, -1) : null;
}

function sameBinding(left: LeaseRow, right: LeaseRow): boolean {
  return ["id", "leaseId", "claimKey", "environmentKey", "status", "ownerProvider", "ownerSessionId", "worktreePath",
    "branchName", "taskRunId", "purpose", "url", "ports", "releasedAt", "expiresAt", "admittedAt", "firstAdmittedAt"]
    .every(key => JSON.stringify(left[key as keyof LeaseRow]) === JSON.stringify(right[key as keyof LeaseRow]));
}

function containerMatches(container: Container, id: string, project: string, lease: LeaseRow, sha: string,
  dockerOperatingSystem: string | undefined, requireServing: boolean): boolean {
  const labels = container.Config?.Labels;
  const service = labels?.["com.docker.compose.service"];
  const mount = container.Mounts?.find(item => item.Destination === "/workspace");
  if (container.Id !== id || labels?.["com.docker.compose.project"] !== project
    || labels?.["dpf.preview.lease"] !== lease.leaseId || labels?.["dpf.preview.sha"] !== sha
    || !["dev-portal", "dev-init"].includes(service ?? "")
    || (service === "dev-init" && !/^\/dpf-preview-init-[a-f0-9]{24}$/.test(container.Name ?? ""))
    || mount?.Type !== "bind" || !previewMountMatches(mount.Source, lease.worktreePath, dockerOperatingSystem)
    || !container.Config?.Env?.includes("DPF_ENVIRONMENT_CLASS=development")
    || !container.Config.Env.includes(`DPF_PREVIEW_SOURCE_SHA=${sha}`)
    || !container.Config.Env.includes(`DPF_PREVIEW_LEASE_ID=${lease.leaseId}`)) return false;
  if (!requireServing) return true;
  const ports = container.NetworkSettings?.Ports ?? {};
  if (service === "dev-init") return Object.values(ports).every(value => value === null || value.length === 0);
  const published = ports["3000/tcp"];
  return Boolean(published?.length && published.every(value => ["127.0.0.1", "::1"].includes(value.HostIp) && value.HostPort === "3001")
    && Object.entries(ports).every(([key, value]) => key === "3000/tcp" || value === null || value.length === 0));
}

/** Existing native owners call this after their normal expiry reconciliation.
 * No client, CLI, stored cleanup command, new claim or authority grant is used. */
export async function fenceEndedPreviewRuntimes(deps: Dependencies = {}): Promise<PreviewFenceResult> {
  const get = deps.get ?? dockerSocketGet, stop = deps.stop ?? dockerSocketStop;
  const readLease = deps.readLease ?? (leaseId => prisma.nonProductionEnvironmentLease.findUnique({ where: { leaseId } }));
  const readTask = deps.readTask ?? (taskRunId => prisma.taskRun.findUnique({ where: { taskRunId },
    select: { taskRunId: true, userId: true, initiatingAgentId: true, progressPayload: true, status: true } }));
  const readSource = deps.readSource ?? ((lease, sha) => prisma.workroom.findFirst({
    where: { worktreePath: lease.worktreePath, headBranch: lease.branchName, headSha: sha },
    select: { headSha: true, repositoryFullName: true },
  }));
  const result: PreviewFenceResult = { checked: 0, stopped: 0, held: 0, pending: 0, truncated: false, outcomes: [] };
  const passNow = deps.now ?? new Date();
  const add = (outcome: Outcome) => {
    result.outcomes.push(outcome);
    if (outcome.state === "stopped" || outcome.state === "absent") result.stopped += 1;
    else result[outcome.state] += 1;
  };
  let project: string, operatingSystem: string | undefined, summaries: unknown[];
  try {
    const self = await get(`/containers/${encodeURIComponent(deps.selfHostname ?? hostname())}/json`) as Container;
    project = self.Config?.Labels?.["com.docker.compose.project"] ?? "";
    if (!project) throw new Error("unverified project");
    const filters = encodeURIComponent(JSON.stringify({ label: [`com.docker.compose.project=${project}`, "dpf.preview.lease"] }));
    const listed = await get(`/containers/json?filters=${filters}`);
    if (!Array.isArray(listed)) throw new Error("unverified listing");
    summaries = listed;
    const info = await get("/info") as { OperatingSystem?: string };
    operatingSystem = info.OperatingSystem;
  } catch { add({ containerId: "", state: "pending", reason: "daemon-unavailable" }); return result; }
  const validIds = new Set(summaries.flatMap(summary => isRecord(summary)
    && typeof summary.Id === "string" && /^[a-f0-9]{64}$/.test(summary.Id) ? [summary.Id] : []));
  const ids = [...validIds].sort();
  if (summaries.some(summary => !isRecord(summary) || !validIds.has(String(summary.Id)))) {
    add({ containerId: "", state: "held", reason: "identity-unverified" });
  }
  result.truncated = ids.length > MAX_CONTAINERS_PER_PASS;
  // Existing five-minute reconciliation advances this stateless window. A
  // stable list of held/pending IDs cannot starve later candidates forever.
  // Events in the same period reuse that window; they do not create a cursor.
  const windows = Math.max(1, Math.ceil(ids.length / MAX_CONTAINERS_PER_PASS));
  const start = (Math.floor(passNow.getTime() / RECONCILE_INTERVAL_MS) % windows) * MAX_CONTAINERS_PER_PASS;
  for (const id of ids.slice(start, start + MAX_CONTAINERS_PER_PASS)) {
    result.checked += 1;
    let leaseId: string | undefined;
    try {
      const before = await get(`/containers/${id}/json`) as Container;
      leaseId = before.Config?.Labels?.["dpf.preview.lease"];
      if (!leaseId || !/^NPEL-[A-Z0-9]+$/.test(leaseId)) { add({ containerId: id, state: "held", reason: "lease-unverified" }); continue; }
      const lease = await readLease(leaseId);
      const sha = lease && terminalPreview(lease, passNow);
      if (!lease || !sha) { add({ containerId: id, leaseId, state: "held", reason: "not-terminal-preview" }); continue; }
      if (!containerMatches(before, id, project, lease, sha, operatingSystem, before.State?.Running === true)) {
        add({ containerId: id, leaseId, state: "held", reason: "container-binding-unverified" }); continue;
      }
      const task = await readTask(lease.taskRunId!);
      const progress = isRecord(task?.progressPayload) ? task.progressPayload : null;
      const owner = isRecord(progress?.nonprodPreviewOwner) ? progress.nonprodPreviewOwner : null;
      const agentId = typeof owner?.agentId === "string" ? owner.agentId : undefined;
      const owned = task?.status === "completed" && task.taskRunId === deterministicNonprodWaitTaskRunId(task.userId, leaseId)
        && await ownsProcessFreeLease({ db: { taskRun: { findUnique: async () => task } }, lease,
          userId: task.userId, agentId, ownerSessionId: lease.ownerSessionId });
      const source = owned ? await readSource(lease, sha) : null;
      if (!owned || source?.headSha !== sha || !source.repositoryFullName) {
        add({ containerId: id, leaseId, state: "held", reason: "source-owner-unverified" }); continue;
      }
      const current = await readLease(leaseId);
      if (!current || !terminalPreview(current, passNow) || !sameBinding(current, lease)) {
        add({ containerId: id, leaseId, state: "held", reason: "lease-changed" }); continue;
      }
      // Non-gate terminality cannot be renewed/reclaimed. Labels and mounts
      // are immutable for this full ID; a replacement has a different ID.
      if (before.State?.Running === true) {
        try { await stop(id); } catch { /* Timeout may mean the stop executed. Read back. */ }
      }
      try {
        const after = await get(`/containers/${id}/json`) as Container;
        if (containerMatches(after, id, project, current, sha, operatingSystem, false) && after.State?.Running === false) {
          add({ containerId: id, leaseId, state: "stopped" });
        } else add({ containerId: id, leaseId, state: "pending", reason: "stop-unverified" });
      } catch (error) {
        add({ containerId: id, leaseId, state: error instanceof Error && error.message === "docker_engine_http_404" ? "absent" : "pending",
          reason: "stop-readback" });
      }
    } catch { add({ containerId: id, ...(leaseId ? { leaseId } : {}), state: "pending", reason: "proof-or-transport-unavailable" }); }
  }
  return result;
}
