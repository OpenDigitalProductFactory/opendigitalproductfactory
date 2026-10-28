import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

export const MANAGED_INFERENCE_BASE_URL = "http://host.docker.internal:12436/v1";
const STATE_PATH = "/dpf-state/install-state.json";
const digest = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const invalid = (): never => { throw new Error("Managed inference selection invalid or hardware unqualified"); };

/** Installation state is written only by the native install/controller owner.
 * Never cache this selection: drain/activation/rollback must reach every new
 * local request through the same existing provider resolver. */
export function resolveManagedInferenceEndpoint(snapshot: unknown): string | null {
  if (!object(snapshot)) return invalid();
  if (!Object.hasOwn(snapshot, "managedInference")) return null;
  const value = snapshot.managedInference;
  if (snapshot.platform !== "darwin" || snapshot.arch !== "arm64" || !object(value)
    || value.schemaVersion !== 1 || value.device !== "Apple M5 Max" || value.port !== 12436
    || !["native", "docker", "transitioning", "uncertain"].includes(String(value.mode))
    || typeof value.actionKey !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{1,95}$/.test(value.actionKey)
    || typeof value.nodeId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value.nodeId)
    || typeof value.sourceSha !== "string" || !/^[a-f0-9]{40}$/.test(value.sourceSha)
    || ![value.profileSha256, value.runtimeManifestSha256, value.qualificationReportSha256, value.baselineEngineSha256].every(digest)
    || Object.keys(value).sort().join(",") !== ["schemaVersion", "mode", "actionKey", "nodeId", "device", "port", "sourceSha",
      "profileSha256", "runtimeManifestSha256", "qualificationReportSha256", "baselineEngineSha256"].sort().join(",")) return invalid();
  if (value.mode === "transitioning" || value.mode === "uncertain") throw new Error(`Managed inference ${value.mode}; new requests are fenced`);
  return value.mode === "native" ? MANAGED_INFERENCE_BASE_URL : null;
}

function readInstallStateBytes(): string | null {
  let fd: number;
  try { fd = openSync(STATE_PATH, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  try {
    const stat = fstatSync(fd), maximum = 256 * 1024;
    if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1 || stat.size > maximum) return invalid();
    const bytes = Buffer.alloc(maximum + 1); let used = 0;
    while (used < bytes.length) {
      const count = readSync(fd, bytes, used, bytes.length - used, null);
      if (count === 0) break;
      used += count;
    }
    if (used !== stat.size || used > maximum) return invalid();
    return bytes.subarray(0, used).toString("utf8");
  } finally { closeSync(fd); }
}

export function readManagedInferenceEndpoint(readBytes: () => string | null = readInstallStateBytes): string | null {
  const bytes = readBytes();
  return bytes === null ? null : resolveManagedInferenceEndpoint(JSON.parse(bytes));
}
