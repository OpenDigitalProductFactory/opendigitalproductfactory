// Host GPU admission for local completion.
//
// The in-process inference lock only sees one Node process. Docker Model
// Runner is a host service: the portal, Inngest, and any other app that talks
// to it share one GPU. A game or another LLM does not take that lock at all.
//
// This module decides whether a NEW local completion may start.
//   - A runner already loading or serving a request defers. Do not pile on.
//   - A fresh host snapshot (nvidia-smi, published into the state dir on
//     Windows where the portal container cannot run nvidia-smi) defers when
//     the card is busy or the model will not fit beside what is already there.
//   - No snapshot is not "busy". Missing telemetry must not disable local
//     fallback. windows_exporter on :9182 does not publish GPU memory.
//
// An idle runner we already loaded is released when the card is externally
// busy, so a game is not left sharing VRAM with a parked 27B model.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { resolve } from "node:path";

import { estimateModelVramGb, MODEL_HEADROOM_GB } from "@/lib/inference/local-model-policy";
import { getOllamaApiRoot } from "@/lib/inference/ollama-url";
import { isLocalProviderId } from "@/lib/routing/provider-locality";
import { currentReassessmentExecution, isReassessmentExecutionError, refuseReassessmentExecution } from "../routing/reassessment-execution-scope";
import { captureReassessmentHttpRequest, currentReassessmentHttpTransport } from "./reassessment-http-capture";

export const HOST_GPU_SNAPSHOT_MAX_AGE_MS = 20_000;
/** Desktop composition sits well under this. A game or another renderer does not. */
export const HOST_GPU_BUSY_UTILIZATION_PERCENT = 35;

export type HostGpuSnapshot = {
  observedAtMs: number;
  memoryUsedMiB: number;
  memoryTotalMiB: number;
  utilizationPercent: number;
};

export type LocalRunner = {
  modelName: string;
  mode: string;
  inUse: boolean;
  loading: boolean;
};

export type LocalGpuAdmission = {
  defer: "host-gpu-busy" | "local-runner-busy" | null;
  /** Release parked runners so an external GPU consumer gets the card back. */
  unloadIdle: boolean;
};

export function defaultHostGpuSnapshotPath(): string {
  const override = process.env.DPF_HOST_GPU_SNAPSHOT_FILE?.trim();
  return override && override.length > 0 ? override : "/dpf-state/host-gpu.json";
}

export function parseHostGpuSnapshotJson(raw: string): HostGpuSnapshot | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const observedAtMs = typeof parsed.observedAt === "string"
      ? Date.parse(parsed.observedAt)
      : typeof parsed.observedAtMs === "number"
        ? parsed.observedAtMs
        : Number.NaN;
    const memoryUsedMiB = Number(parsed.memoryUsedMiB);
    const memoryTotalMiB = Number(parsed.memoryTotalMiB);
    const utilizationPercent = Number(parsed.utilizationPercent);
    if (
      !Number.isFinite(observedAtMs)
      || !Number.isFinite(memoryUsedMiB)
      || !Number.isFinite(memoryTotalMiB)
      || !Number.isFinite(utilizationPercent)
      || memoryTotalMiB <= 0
    ) {
      return null;
    }
    return { observedAtMs, memoryUsedMiB, memoryTotalMiB, utilizationPercent };
  } catch {
    return null;
  }
}

/** `nvidia-smi --format=csv,noheader,nounits` first GPU line. */
export function parseNvidiaSmiCsv(line: string, observedAtMs: number): HostGpuSnapshot | null {
  const parts = line.split(",").map((part) => part.trim());
  if (parts.length < 3) return null;
  const memoryUsedMiB = Number(parts[0]);
  const memoryTotalMiB = Number(parts[1]);
  const utilizationPercent = Number(parts[2]);
  if (
    !Number.isFinite(memoryUsedMiB)
    || !Number.isFinite(memoryTotalMiB)
    || !Number.isFinite(utilizationPercent)
    || memoryTotalMiB <= 0
  ) {
    return null;
  }
  return { observedAtMs, memoryUsedMiB, memoryTotalMiB, utilizationPercent };
}

export function parseEngineRunners(body: unknown): LocalRunner[] {
  if (!Array.isArray(body)) return [];
  const runners: LocalRunner[] = [];
  for (const entry of body) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const modelName = typeof row.model_name === "string"
      ? row.model_name
      : typeof row.modelName === "string"
        ? row.modelName
        : "";
    const mode = typeof row.mode === "string" ? row.mode : "";
    runners.push({
      modelName,
      mode,
      inUse: row.in_use === true || row.inUse === true,
      loading: row.loading === true,
    });
  }
  return runners;
}

export function requiredLocalModelMiB(modelId: string | null | undefined): number | null {
  if (!modelId) return null;
  const weights = estimateModelVramGb(modelId);
  if (weights == null) return null;
  return Math.ceil((weights + MODEL_HEADROOM_GB) * 1024);
}

/**
 * Pure admission decision. `snapshot` null means the host published nothing
 * fresh — do not invent a busy card. A runner that is loading or in use is
 * enough on its own: another thread or another app already has the model runner.
 */
export function decideLocalGpuAdmission(input: {
  runners: readonly LocalRunner[];
  snapshot: HostGpuSnapshot | null;
  nowMs: number;
  requiredMiB: number | null;
}): LocalGpuAdmission {
  if (input.runners.some((runner) => runner.inUse || runner.loading)) {
    return { defer: "local-runner-busy", unloadIdle: false };
  }

  const snapshot = input.snapshot;
  if (!snapshot) return { defer: null, unloadIdle: false };
  const ageMs = input.nowMs - snapshot.observedAtMs;
  if (ageMs > HOST_GPU_SNAPSHOT_MAX_AGE_MS || snapshot.observedAtMs - input.nowMs > 60_000) {
    return { defer: null, unloadIdle: false };
  }

  const idleResident = input.runners.length > 0;
  if (snapshot.utilizationPercent >= HOST_GPU_BUSY_UTILIZATION_PERCENT) {
    return { defer: "host-gpu-busy", unloadIdle: idleResident };
  }

  // The card is compute-idle. A parked model of ours is the VRAM we are
  // about to reuse. Only a cold start has to fit beside whoever else is resident.
  if (!idleResident && input.requiredMiB != null && input.requiredMiB > 0) {
    const freeMiB = snapshot.memoryTotalMiB - snapshot.memoryUsedMiB;
    if (freeMiB < input.requiredMiB) {
      return { defer: "host-gpu-busy", unloadIdle: false };
    }
  }

  return { defer: null, unloadIdle: false };
}

export type LocalGpuInspectDeps = {
  modelId?: string | null;
  nowMs?: number;
  readSnapshot?: () => Promise<HostGpuSnapshot | null>;
  listRunners?: () => Promise<LocalRunner[]>;
  unloadIdleRunners?: () => Promise<void>;
};

async function readSnapshotFile(filePath: string): Promise<HostGpuSnapshot | null> {
  try {
    const raw = await fs.promises.readFile(filePath, "utf8");
    return parseHostGpuSnapshotJson(raw);
  } catch {
    return null;
  }
}

function readNvidiaSmi(nowMs: number): HostGpuSnapshot | null {
  try {
    const result = spawnSync("nvidia-smi", [
      "--query-gpu=memory.used,memory.total,utilization.gpu",
      "--format=csv,noheader,nounits",
    ], { encoding: "utf8", timeout: 3_000, windowsHide: true });
    if (result.status !== 0 || !result.stdout) return null;
    const line = result.stdout.split(/\r?\n/).find((entry) => entry.trim().length > 0);
    return line ? parseNvidiaSmiCsv(line, nowMs) : null;
  } catch {
    return null;
  }
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown | null> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function readDefaultHostGpuSnapshot(nowMs: number): Promise<HostGpuSnapshot | null> {
  const fromFile = await readSnapshotFile(defaultHostGpuSnapshotPath());
  if (fromFile) return fromFile;
  return readNvidiaSmi(nowMs);
}

export async function listDefaultLocalRunners(): Promise<LocalRunner[]> {
  if (currentReassessmentExecution()) return refuseReassessmentExecution("reassessment-capacity-wrapper-required");
  const body = await fetchJson(`${getOllamaApiRoot()}/engines/ps`, { method: "GET" }, 1_500);
  return parseEngineRunners(body);
}

export async function unloadDefaultIdleRunners(): Promise<void> {
  if (currentReassessmentExecution()) return refuseReassessmentExecution("reassessment-model-management-unavailable");
  await fetchJson(`${getOllamaApiRoot()}/engines/unload`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ all: true }),
  }, 3_000);
}

async function readOr<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (isReassessmentExecutionError(error)) throw error;
    return fallback;
  }
}

/**
 * Defer a new local completion while the GPU is not free.
 *
 * Routing stays a leaf, so this lives with inference. A unit test injects
 * `inspectGpu`. With no probe and `VITEST` set, this is a no-op so the suite
 * does not read the machine that happens to be running it. A probe that
 * throws is not evidence the card is busy.
 */
export async function assertLocalGpuFree(input: {
  providerId?: string | null;
  modelId?: string | null;
  inspectGpu?: (probe: { modelId?: string | null }) => Promise<LocalGpuAdmission>;
  unloadIdleRunners?: () => Promise<void>;
} = {}): Promise<void> {
  if (input.providerId && !isLocalProviderId(input.providerId)) return;
  const vitest = process.env.VITEST === "true" || process.env.VITEST === "1";
  const restricted = currentReassessmentExecution();
  if (!input.inspectGpu && vitest && !restricted) return;

  let decision: LocalGpuAdmission;
  try {
    decision = input.inspectGpu
      ? await input.inspectGpu({ modelId: input.modelId ?? null })
      : await inspectLocalGpuAdmission({ modelId: input.modelId ?? null });
  } catch (error) {
    if (isReassessmentExecutionError(error)) throw error;
    return;
  }
  if (decision.unloadIdle && !restricted) {
    try {
      if (input.unloadIdleRunners) await input.unloadIdleRunners();
      else await unloadDefaultIdleRunners();
    } catch {
      // Releasing the parked model is best-effort. The deferral still stands.
    }
  }
  if (decision.defer) {
    const { LocalProviderCapacityDeferredError } = await import("@/lib/routing/local-provider-capacity");
    throw new LocalProviderCapacityDeferredError(decision.defer);
  }
}

/** Published telemetry only: no shell, model activation, unload or runner HTTP. */
export async function readPublishedHostGpuObservation(input: Pick<LocalGpuInspectDeps, "nowMs" | "readSnapshot"> = {},
  refuse: (reason: string) => never = reason => { throw new Error(`published-gpu-${reason}`); }) {
    let snapshot: HostGpuSnapshot | null = null, provenance: Record<string, unknown>;
    try {
      if (input.readSnapshot) {
        snapshot = await input.readSnapshot(); provenance = { source: "injected-published-observation" };
      } else {
        const path = resolve(defaultHostGpuSnapshotPath());
        let bytes: Buffer | null;
        try { bytes = await fs.promises.readFile(path); }
        catch (error) {
          if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
          bytes = null;
        }
        provenance = bytes === null ? { source: "published-file", path, readOutcome: "absent", errorCode: "ENOENT" }
          : { source: "published-file", path, readOutcome: "complete", bodyEncoding: "base64", bodyBase64: bytes.toString("base64") };
        if (bytes !== null) {
          const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes), raw = JSON.parse(source);
          // The publisher's object is flat. Preserve all bytes, while refusing
          // duplicate/unknown keys, coercion and conflicting timestamp forms.
          const names = [...source.matchAll(/"(?:\\.|[^"\\])*"\s*:/g)].map(match => JSON.parse(match[0].slice(0, -1).trim()) as string);
          if (!raw || typeof raw !== "object" || Array.isArray(raw) || new Set(names).size !== names.length || names.length !== Object.keys(raw).length
            || Object.keys(raw).some(key => !["observedAt", "observedAtMs", "memoryUsedMiB", "memoryTotalMiB", "utilizationPercent"].includes(key))
            || [raw.memoryUsedMiB, raw.memoryTotalMiB, raw.utilizationPercent].some(value => typeof value !== "number")
            || raw.observedAt !== undefined && typeof raw.observedAt !== "string" || raw.observedAtMs !== undefined && typeof raw.observedAtMs !== "number"
            || raw.observedAt !== undefined && raw.observedAtMs !== undefined && Date.parse(raw.observedAt) !== raw.observedAtMs) {
            return refuse("evidence-invalid");
          }
          snapshot = parseHostGpuSnapshotJson(source);
          if (!snapshot) return refuse("evidence-invalid");
        }
      }
    } catch (error) {
      if (isReassessmentExecutionError(error)) throw error;
      return refuse("evidence-unavailable");
    }
    if (snapshot && (!Object.values(snapshot).every(value => typeof value === "number" && Number.isFinite(value)) || snapshot.memoryTotalMiB <= 0
      || snapshot.memoryUsedMiB < 0 || snapshot.memoryUsedMiB > snapshot.memoryTotalMiB || snapshot.utilizationPercent < 0 || snapshot.utilizationPercent > 100)) {
      return refuse("evidence-invalid");
    }
    const observation = () => {
      const observedAtMs = input.nowMs ?? Date.now();
      const unknownReason = !snapshot ? "published-snapshot-absent" : observedAtMs - snapshot.observedAtMs > HOST_GPU_SNAPSHOT_MAX_AGE_MS
        ? "published-snapshot-stale" : snapshot.observedAtMs - observedAtMs > 60_000 ? "published-snapshot-future" : null;
      return { snapshot: unknownReason ? null : snapshot, provenance: { ...provenance, ...(unknownReason ? { unknownReason } : {}) }, observedAtMs };
    };
  return observation();
}

export async function inspectLocalGpuAdmission(input: LocalGpuInspectDeps = {}): Promise<LocalGpuAdmission> {
  const nowMs = input.nowMs ?? Date.now();
  const restricted = currentReassessmentExecution();
  if (restricted) {
    if (input.listRunners) return refuseReassessmentExecution("reassessment-capacity-uncaptured-runners");
    const published = await readPublishedHostGpuObservation(input, reason => refuseReassessmentExecution(`reassessment-capacity-${reason}`));
    const ports = currentReassessmentHttpTransport(), proof = restricted.qualification.finiteTokenProof;
    if (!proof) return refuseReassessmentExecution("reassessment-capacity-composition-unproven");
    let decision: LocalGpuAdmission | null = null;
    const response = await captureReassessmentHttpRequest({ url: `${proof.apiRoot}/engines/ps`, method: "GET", operation: "configuration",
      ...ports, captureAdditional: async response => {
        const evidence = published;
        let body: unknown; try { body = await response.json(); } catch { return { ...evidence, parseStatus: "invalid" }; }
        if (!response.ok || !Array.isArray(body) || body.some(row => !row || typeof row !== "object"
          || typeof row.model_name !== "string" || typeof row.mode !== "string" || typeof row.in_use !== "boolean" || typeof row.loading !== "boolean")) {
          return { ...evidence, parseStatus: "invalid" };
        }
        const runners = parseEngineRunners(body);
        decision = decideLocalGpuAdmission({ runners, snapshot: evidence.snapshot, nowMs: evidence.observedAtMs, requiredMiB: requiredLocalModelMiB(input.modelId) });
        return { ...evidence, runners, decision };
      } });
    if (!response.ok || !decision) return refuseReassessmentExecution("reassessment-capacity-response-invalid");
    return decision;
  }
  const [runners, snapshot] = await Promise.all([
    readOr(input.listRunners ?? listDefaultLocalRunners, [] as LocalRunner[]),
    readOr(input.readSnapshot ?? (() => readDefaultHostGpuSnapshot(nowMs)), null),
  ]);
  return decideLocalGpuAdmission({
    runners,
    snapshot,
    nowMs,
    requiredMiB: requiredLocalModelMiB(input.modelId),
  });
}
