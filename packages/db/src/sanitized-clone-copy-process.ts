/**
 * BI-9F7192F9: the child-process side of one binary COPY from the source to
 * the destination, isolated so its failure contract is testable.
 *
 * - Every child's lifecycle handlers are attached the moment it is spawned, so
 *   a spawn failure (ENOENT, EAGAIN) is a rejection the caller's cleanup sees,
 *   never an unhandled 'error' event that exits Node.
 * - Destination admission races the destination child's own failure: a child
 *   that dies before it is admitted fails the copy at once with its original
 *   cause instead of waiting for the admission deadline.
 * - On any failure both children are killed and drained before the original
 *   error is rethrown, so the caller's destination cleanup runs with no writer
 *   still attached.
 */
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { pipeline } from "node:stream/promises";

export type SpawnPsql = (args: string[], options: SpawnOptions) => ChildProcess;

const defaultSpawnPsql: SpawnPsql = (args, options) => spawn("psql", args, options);
const CHILD_DRAIN_MS = 5_000;

export type AdmittedPsqlCopy = {
  /** Destination psql arguments; the connection URL inside already carries the writer's application_name. */
  destinationArgs: string[];
  sourceArgs: string[];
  writerName: string;
  /** Registers the destination writer with the fence; rejects when it cannot be admitted. */
  admitWriter: (applicationName: string) => Promise<void>;
  destinationEnv: NodeJS.ProcessEnv;
  spawnPsql?: SpawnPsql;
};

export async function runAdmittedPsqlCopy(copy: AdmittedPsqlCopy): Promise<void> {
  const spawnPsql = copy.spawnPsql ?? defaultSpawnPsql;
  const destination = spawnPsql(copy.destinationArgs, {
    stdio: ["pipe", "ignore", "pipe"],
    env: { ...copy.destinationEnv, PGAPPNAME: copy.writerName },
  });
  const destinationDone = settleChild(destination, "destination psql");
  destination.stdin?.on("error", () => {}); // a dead destination surfaces through destinationDone
  let source: ChildProcess | null = null;
  try {
    const admission = copy.admitWriter(copy.writerName);
    admission.catch(() => {}); // still observed below; a lost race must not become unhandled
    await Promise.race([
      admission,
      destinationDone.then(() => { throw new Error("destination psql exited before it was admitted"); }),
    ]);
    source = spawnPsql(copy.sourceArgs, { stdio: ["ignore", "pipe", "pipe"] });
    const sourceDone = settleChild(source, "source psql");
    await Promise.all([pipeline(source.stdout!, destination.stdin!), sourceDone, destinationDone]);
  } catch (error) {
    await drainChildren([destination, source]);
    throw error;
  }
}

/** Attach 'error' and 'close' handlers now; the promise is always observed, so it never rejects unhandled. */
function settleChild(child: ChildProcess, label: string): Promise<void> {
  const stderr = collectBoundedStderr(child);
  const settled = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) return resolve();
      const detail = stderr();
      reject(new Error(`${label} failed (${signal ? `signal ${signal}` : `exit ${String(code)}`})${detail ? `: ${detail}` : ""}`));
    });
  });
  settled.catch(() => {});
  return settled;
}

function collectBoundedStderr(child: ChildProcess): () => string {
  const chunks: Buffer[] = [];
  let size = 0;
  child.stderr?.on("data", (chunk: Buffer | string) => {
    if (size >= 8_192) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = 8_192 - size;
    chunks.push(Buffer.from(buffer.subarray(0, remaining)));
    size += Math.min(buffer.length, remaining);
  });
  return () => Buffer.concat(chunks).toString("utf8").trim();
}

/** Kill every live child and wait (bounded) until each has exited; a never-spawned child is skipped. */
async function drainChildren(children: Array<ChildProcess | null>): Promise<void> {
  await Promise.all(children.map((child) => {
    if (!child || child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return undefined;
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, CHILD_DRAIN_MS);
      child.once("close", () => { clearTimeout(timer); resolve(); });
      child.kill();
    });
  }));
}
