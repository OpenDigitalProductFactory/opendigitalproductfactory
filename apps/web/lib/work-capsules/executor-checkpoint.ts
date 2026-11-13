import { err, ok, type ActionResult } from "@/lib/shared/action-result";

/**
 * The latest note an executor keeps with its heartbeat, so whoever takes the
 * room over learns what was in flight without the previous client being alive
 * (BI-11EF5A8C; design docs/superpowers/specs/2026-10-21-executor-takeover-design.md §3.2).
 * Advisory text: it never authorizes anything.
 */
export type ExecutorCheckpoint = {
  nextAction?: string;
  addressing?: string[];
  uncommittedPaths?: string[];
  headSha?: string;
  pushed?: boolean;
  openRisks?: string[];
};

const MAX_BYTES = 4096;
const LIST_LIMITS = { addressing: 20, uncommittedPaths: 50, openRisks: 20 } as const;

export function parseExecutorCheckpoint(input: unknown): ActionResult<ExecutorCheckpoint> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return err("checkpoint must be an object.");
  const raw = input as Record<string, unknown>;
  const checkpoint: ExecutorCheckpoint = {};
  if (raw.nextAction !== undefined) {
    if (typeof raw.nextAction !== "string" || !raw.nextAction.trim()) return err("nextAction must be text.");
    checkpoint.nextAction = raw.nextAction.trim();
  }
  for (const key of Object.keys(LIST_LIMITS) as (keyof typeof LIST_LIMITS)[]) {
    const value = raw[key];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.length > LIST_LIMITS[key] || value.some(entry => typeof entry !== "string")) {
      return err(`${key} must be a list of at most ${LIST_LIMITS[key]} text entries.`);
    }
    checkpoint[key] = value as string[];
  }
  if (raw.headSha !== undefined) {
    if (typeof raw.headSha !== "string" || !/^[0-9a-f]{40}$/.test(raw.headSha)) return err("headSha must be a full commit sha.");
    checkpoint.headSha = raw.headSha;
  }
  if (raw.pushed !== undefined) {
    if (typeof raw.pushed !== "boolean") return err("pushed must be true or false.");
    checkpoint.pushed = raw.pushed;
  }
  if (Object.keys(checkpoint).length === 0) return err("checkpoint has no fields.");
  if (Buffer.byteLength(JSON.stringify(checkpoint), "utf8") > MAX_BYTES) return err(`checkpoint exceeds ${MAX_BYTES} bytes.`);
  return ok(checkpoint);
}
