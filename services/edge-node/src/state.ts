// Local state file for the Edge Node.
//
// Stores the dpfedge_* node token + edgeNodeId + Authority-decided
// intervals so the agent doesn't have to re-enroll on every restart.
//
// Phase 0 storage: plain JSON at $DPF_EDGE_STATE_DIR/state.json with
// 0600 perms. The spec calls out OS-secure-store (Keychain, Credential
// Manager, libsecret) as preferred, but in the Linux-container Phase 0
// deployment the host's libsecret isn't available. The 0600 file under
// a container-owned directory is the agreed Phase 0 fallback per the
// spec § Phase 0 storage downgrade (Linux container Mode 1).
//
// Read-time enforcement per spec:
//   - File mode must be 0600 (refuse if loosened by host bind-mount,
//     volume export, or operator copy).
//   - File owner UID must match the current process UID (refuse if
//     a different account dropped state into our directory — e.g. a
//     host bind-mount leaking a different container's state).
// Cross-container fingerprint detection (the spec's stronger
// promise) is Phase 1+; for now the docker-managed-volume + non-root
// dedicated UID controls bound the risk.

import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import * as os from "node:os";

import { z } from "zod";

const StateSchema = z.object({
  /** Stable nodeId returned by the Authority at enrollment. */
  nodeId: z.string().min(1),
  /** Plaintext dpfedge_* node token. NEVER logged. */
  nodeToken: z.string().min(1),
  /** When this state was last written. */
  enrolledAt: z.string().datetime(),
  /** Authority-decided heartbeat interval in seconds. */
  heartbeatIntervalSec: z.number().int().positive(),
  /** Authority-decided sweep interval in seconds. */
  sweepIntervalSec: z.number().int().positive(),
  /** Authority-decided metrics collection interval in seconds. Defaults to 10 s. */
  metricsIntervalSec: z.number().int().positive().optional(),
  /** Capabilities the Authority accepts from this node. */
  acceptedCapabilities: z.array(z.string()),
  /** trustState at last heartbeat. */
  trustState: z.enum(["pending", "trusted", "quarantined", "revoked"]),
});

export type EdgeNodeState = z.infer<typeof StateSchema>;

const STATE_FILENAME = "state.json";

export function statePath(stateDir: string): string {
  return join(stateDir, STATE_FILENAME);
}

/**
 * Get the current process UID. Returns null on platforms without
 * POSIX UIDs (Windows in tests). Owner enforcement is skipped on
 * those platforms; the spec's Mode 1 controls only bind in the
 * Linux-container deployment where UIDs are real.
 */
function currentUid(): number | null {
  if (typeof process.getuid !== "function") return null;
  try {
    return process.getuid();
  } catch {
    return null;
  }
}

/**
 * Skip the file-mode and owner checks on hosts that don't have POSIX
 * permission semantics (Windows). The container deployment is Linux;
 * skipping on Windows preserves dev-host ergonomics while keeping the
 * production-path checks intact.
 */
function shouldEnforcePosixPerms(): boolean {
  return os.platform() !== "win32";
}

/**
 * Verify the state file's mode is 0600 and owner is the current
 * process UID. Throws with a descriptive error if either check fails
 * — refusing to read state we don't trust is the point.
 */
async function verifyStatePerms(path: string): Promise<void> {
  if (!shouldEnforcePosixPerms()) return;

  const stat = await fs.stat(path);

  // Mode check: the lower 9 bits encode rwxrwxrwx. We require 0600
  // exactly (owner read/write, no group, no other). If the file is
  // group/world readable, the token is exposed to anything else
  // running as that group or on that host.
  const modeBits = stat.mode & 0o777;
  if (modeBits !== 0o600) {
    throw new Error(
      `Edge Node state file at ${path} has unsafe permissions: `
      + `expected mode 0600, got 0${modeBits.toString(8).padStart(3, "0")}. `
      + `Refusing to load; the node token in this file may be exposed. `
      + `Fix: chmod 600 ${path} (and investigate how the loose mode got there).`,
    );
  }

  // Owner check: the file must be owned by the current process UID.
  // A different owner means either (a) a host bind-mount leaked
  // another account's state into this container, or (b) the
  // installer ran as a different account than the runtime. Either
  // way, the token in the file is not ours to use.
  const myUid = currentUid();
  if (myUid !== null && stat.uid !== myUid) {
    throw new Error(
      `Edge Node state file at ${path} is owned by UID ${stat.uid}, `
      + `but the current process runs as UID ${myUid}. `
      + `Refusing to load; cross-account state-file read is the host-bind-mount-leak threat the spec's storage downgrade controls bound. `
      + `Fix: ensure the state directory is owned by the runtime's dedicated UID (e.g. dpf:dpf in the Dockerfile), and the state directory is a docker-managed volume, not a host bind-mount.`,
    );
  }
}

/**
 * Read state from disk. Returns null if the state file doesn't exist
 * (caller should treat as "first run" and trigger enrollment). Throws
 * if:
 *   - the file exists but parsing fails (corruption shouldn't be
 *     silently ignored);
 *   - the file mode is not 0600 (per spec § Phase 0 storage downgrade);
 *   - the file owner UID doesn't match the current process UID (same).
 */
export async function loadState(stateDir: string): Promise<EdgeNodeState | null> {
  const path = statePath(stateDir);

  // Existence check first via stat — lets us return null cleanly for
  // ENOENT without doing the perm check on a phantom path. Any other
  // stat error (EACCES, EPERM, etc.) propagates.
  let exists = true;
  try {
    await fs.access(path);
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      exists = false;
    } else {
      throw err;
    }
  }
  if (!exists) return null;

  // File exists — enforce the mode + owner controls BEFORE reading
  // the contents. Reading first would mean a loose-perms file gets
  // its plaintext token slurped into the Node process anyway.
  await verifyStatePerms(path);

  const raw = await fs.readFile(path, "utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Edge Node state file at ${path} is corrupt: ${(err as Error).message}`);
  }

  const result = StateSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Edge Node state file at ${path} is missing required fields:\n${issues}`,
    );
  }
  return result.data;
}

/**
 * Atomically write state. Uses tmp-file + rename so a crash mid-write
 * leaves the previous state intact. Sets 0600 perms.
 */
export async function saveState(
  stateDir: string,
  state: EdgeNodeState,
): Promise<void> {
  // Validate before writing — we don't want to persist an invalid
  // state shape that would fail to load on next restart.
  StateSchema.parse(state);

  await fs.mkdir(dirname(statePath(stateDir)), { recursive: true });
  await fs.mkdir(stateDir, { recursive: true });

  const path = statePath(stateDir);
  const tmp = `${path}.tmp.${process.pid}`;
  const body = `${JSON.stringify(state, null, 2)}\n`;

  await fs.writeFile(tmp, body, { mode: 0o600 });
  await fs.rename(tmp, path);
  // Re-chmod after rename in case the umask shifted bits.
  await fs.chmod(path, 0o600);
}

/**
 * Clear state entirely (e.g. on revocation). The next start triggers
 * a fresh enrollment.
 */
export async function clearState(stateDir: string): Promise<void> {
  const path = statePath(stateDir);
  try {
    await fs.unlink(path);
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      return;
    }
    throw err;
  }
}
