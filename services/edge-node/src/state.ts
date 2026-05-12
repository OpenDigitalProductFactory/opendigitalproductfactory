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
// spec § Maturity gates security review scope.

import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";

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
 * Read state from disk. Returns null if the state file doesn't exist
 * (caller should treat as "first run" and trigger enrollment). Throws
 * if the file exists but doesn't parse — corruption shouldn't be
 * silently ignored.
 */
export async function loadState(stateDir: string): Promise<EdgeNodeState | null> {
  const path = statePath(stateDir);
  let raw: string;
  try {
    raw = await fs.readFile(path, "utf8");
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      return null;
    }
    throw err;
  }

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
