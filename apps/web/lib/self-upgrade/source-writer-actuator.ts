// Authorized source writer launches through the private actuator
// (BI-224F56F1, owner decision DI-250233FBDD9B).
//
// The qualified portal mounts the install checkout read-only. When the
// actuator is mounted, the portal asks it for one of the writer's fixed
// operations. The actuator re-checks the owner and every input against the
// install's own configuration, then launches a short-lived container from
// the canonical promoter image. That container has the install checkout as
// its only writable mount and no Docker socket, capabilities or privilege
// escalation, and it runs /promoter/source-writer.mjs.
//
// Workspace preparation is keyed on an existing self-upgrade run that is
// still pending, queued or running. The upstream refresh has no run, so it
// is a bounded freshness refresh: at most one launch per minute, whose result
// every caller in that minute shares.

import type { SelfUpgradeConfig } from "./config";
import type { PromoterInstallBinding } from "./promoter-actuator";
import type { PrepareSourceResult } from "./prepare-source";
import { isRecord } from "@/lib/shared/coerce";

export type SourceWriterOperation = "prepare-upgrade-source" | "refresh-upstream-head";
export type PrepareUpgradeSourceInput = { sourceMode: "upstream" | "local"; remote: string; branch: string; installBranch: string; isolatedWorkspace: boolean };
export type RefreshUpstreamHeadInput = { remote: string; branch: string };
export type SourceWriterRequest =
  | { owner: { kind: "self-upgrade"; runId: string }; operation: "prepare-upgrade-source"; input: PrepareUpgradeSourceInput }
  | { owner: { kind: "upstream-refresh" }; operation: "refresh-upstream-head"; input: RefreshUpstreamHeadInput };
export type RefreshUpstreamHeadResult = { ok: true; upstreamSha: string } | { ok: false; reason: "no-target" };
type ProcessResult = { exitCode: number; stdout: string; stderr: string };

const refuse = (): never => { throw new Error("source_writer_admission_refused"); };
const RUN_ID = /^SUR-[A-Za-z0-9-]{1,100}$/;
const IMAGE = /^(?:sha256:[a-f0-9]{64}|[a-z0-9][a-z0-9._/-]{0,200}(?::[A-Za-z0-9._-]{1,128})?(?:@sha256:[a-f0-9]{64})?)$/;
const ACTIVE_RUN = new Set(["pending", "queued", "running"]);
const REFRESH_INTERVAL_MS = 60_000;
const trimSlash = (path: string) => path.replace(/[\\/]$/, "");

/** One fixed recipe: the install checkout is the only writable mount. */
export function buildSourceWriterArgs(launch: { name: string; owner: string; project: string; installPath: string; image: string;
  operation: SourceWriterOperation; input: PrepareUpgradeSourceInput | RefreshUpstreamHeadInput }): string[] {
  return ["run", "--rm", "--name", launch.name,
    "--label", `dpf.source-writer-owner=${launch.owner}`, "--label", `dpf.promoter-project=${launch.project}`,
    "--user", "1000:1000", "--read-only", "--tmpfs", "/tmp:rw,nosuid,nodev,size=256m",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "2g", "--pids-limit", "512",
    "-e", "HOME=/tmp", "-e", `DPF_SOURCE_WRITER_INPUT=${JSON.stringify(launch.input)}`,
    "-v", `${launch.installPath}:/host-dpf`,
    "--entrypoint", "node", launch.image, "/promoter/source-writer.mjs", launch.operation];
}

function readResult(result: ProcessResult): unknown {
  const line = result.stdout.trim().split(/\r?\n/).at(-1) ?? "";
  try {
    const value: unknown = JSON.parse(line);
    if (isRecord(value) && typeof value.ok === "boolean") return value;
  } catch { /* fall through */ }
  throw new Error("source_writer_result_invalid");
}

/** Actuator side. A refused request never reaches Docker. */
export function createSourceWriterLauncher(deps: {
  binding: PromoterInstallBinding & { repoRemote?: string; repoBranch?: string };
  readConfig: () => Promise<SelfUpgradeConfig>;
  readRunStatus: (runId: string) => Promise<string | null>;
  run: (args: string[], options: { timeoutMs: number; maxStdoutBytes: number; containerName: string }) => Promise<ProcessResult>;
  now?: () => number;
}) {
  // One refresh launch per interval: callers inside it share the in-flight or
  // last result, so a bounded writer never turns a fresh head into "no target".
  let refresh: { at: number; key: string; result: Promise<unknown> } | null = null;
  const now = deps.now ?? Date.now;
  return async (value: unknown): Promise<unknown> => {
    if (!isRecord(value) || Object.keys(value).length !== 3 || !isRecord(value.owner) || !isRecord(value.input)) return refuse();
    const config = await deps.readConfig();
    const remote = config.repositoryRemote ?? deps.binding.repoRemote ?? "origin";
    const branch = config.repositoryBranch ?? deps.binding.repoBranch ?? "main";
    const installPath = config.hostInstallPath ?? deps.binding.installPath;
    const image = config.promoterImage || "dpf-promoter";
    if (!IMAGE.test(image)) refuse();
    const owner = value.owner, input = value.input;

    if (value.operation === "prepare-upgrade-source") {
      const runId = owner.runId;
      const workspace = config.useIsolatedWorkspace
        ? config.upgradeWorkspaceHostPath ?? `${trimSlash(installPath)}/.upgrade-workspace` : null;
      if (Object.keys(owner).length !== 2 || owner.kind !== "self-upgrade" || typeof runId !== "string" || !RUN_ID.test(runId)
        || Object.keys(input).length !== 5 || input.sourceMode !== config.sourceMode || input.remote !== remote
        || input.branch !== branch || input.installBranch !== config.installBranch
        || input.isolatedWorkspace !== config.useIsolatedWorkspace
        // The writer prepares only the default workspace inside the checkout.
        || (workspace !== null && workspace !== `${trimSlash(installPath)}/.upgrade-workspace`)) return refuse();
      if (!ACTIVE_RUN.has((await deps.readRunStatus(runId)) ?? "")) refuse();
      const name = `dpf-source-writer-${runId}`;
      const result = await deps.run(buildSourceWriterArgs({ name, owner: runId, project: deps.binding.project, installPath, image,
        operation: "prepare-upgrade-source", input: input as PrepareUpgradeSourceInput }),
      { timeoutMs: 20 * 60_000, maxStdoutBytes: 64 * 1024, containerName: name });
      return readResult(result);
    }

    if (value.operation === "refresh-upstream-head") {
      if (Object.keys(owner).length !== 1 || owner.kind !== "upstream-refresh"
        || Object.keys(input).length !== 2 || input.remote !== remote || input.branch !== branch) return refuse();
      const key = `${remote}/${branch}`;
      if (refresh && refresh.key === key && now() - refresh.at < REFRESH_INTERVAL_MS) return refresh.result;
      const at = now();
      const name = `dpf-source-writer-refresh-${at}`;
      const result = deps.run(buildSourceWriterArgs({ name, owner: "upstream-refresh", project: deps.binding.project, installPath,
        image, operation: "refresh-upstream-head", input: input as RefreshUpstreamHeadInput }),
      { timeoutMs: 3 * 60_000, maxStdoutBytes: 8 * 1024, containerName: name }).then(readResult);
      refresh = { at, key, result };
      // A failed launch is not cached as the head; the next caller retries
      // once the interval has passed.
      result.catch(() => { if (refresh?.result === result) refresh = { at, key, result: Promise.resolve({ ok: false, reason: "no-target" }) }; });
      return result;
    }
    return refuse();
  };
}

type ActuatorSend = (body: unknown, timeoutMs: number) => Promise<unknown>;

/** Portal side. Null keeps the legacy local path; a lost or refused reply is
 * a governed prep error, never a fallback to local writes. */
export async function sourceWriterThroughPrivateActuator<R extends SourceWriterRequest>(request: R,
  available?: () => Promise<boolean>, send?: ActuatorSend,
): Promise<(R["operation"] extends "prepare-upgrade-source" ? PrepareSourceResult : RefreshUpstreamHeadResult) | null> {
  const observation = await import("../../../../scripts/lib/scope-writer-observation.mjs");
  if (!await (available ?? observation.usesPrivateActuator)()) return null;
  const timeoutMs = request.operation === "prepare-upgrade-source" ? 21 * 60_000 : 4 * 60_000;
  try {
    const result = await (send ?? ((body, ms) => observation.runActuatorSourceWriter(body, { timeoutMs: ms })))(request, timeoutMs);
    if (isRecord(result) && typeof result.ok === "boolean") return result as never;
  } catch { /* reported below */ }
  return (request.operation === "prepare-upgrade-source"
    ? { ok: false, reason: "prep-error", message: "The authorized source writer did not confirm the operation." }
    : { ok: false, reason: "no-target" }) as never;
}

/** Portal side, for every reader that freshens the install checkout's
 * upstream ref: one bounded writer refresh shared by all of them. Null when
 * the actuator is not mounted, so the caller keeps its local fetch. */
export function refreshUpstreamThroughWriter(input: RefreshUpstreamHeadInput,
  available?: () => Promise<boolean>, send?: ActuatorSend): Promise<RefreshUpstreamHeadResult | null> {
  return sourceWriterThroughPrivateActuator({ owner: { kind: "upstream-refresh" }, operation: "refresh-upstream-head", input },
    available, send);
}
