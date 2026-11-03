import { execFile, type ChildProcess } from "node:child_process";
import { lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const REAL_GIT_SETUP_MS = 90_000;
export const REAL_GIT_SETUP_HOOK_MS = 95_000;
const COMMAND_MS = 15_000;
type Output = { stdout: string; stderr: string };
export type RealGitFixture = {
  readonly root: string;
  git: (...args: string[]) => Promise<Output>;
  /** Direct subprocess seam for lifecycle tests; never invokes a shell. */
  command: (phase: string, file: string, args: string[]) => Promise<Output>;
  dispose: () => Promise<void>;
};

/** Owns allocation before initialization, including failure before caller assignment. */
export async function createRealGitFixture<T>(
  prefix: string,
  initialize: (fixture: RealGitFixture) => Promise<T>,
  limits: { commandMs?: number; setupMs?: number } = {},
): Promise<RealGitFixture & { value: T }> {
  if (!/^[a-z0-9-]+-$/.test(prefix)) throw new Error("Fixture prefix must be a plain temporary-directory prefix");
  const commandMs = limits.commandMs ?? COMMAND_MS;
  const setupMs = limits.setupMs ?? REAL_GIT_SETUP_MS;
  for (const limit of [commandMs, setupMs]) {
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 2_147_483_647) throw new Error("Fixture limits must be positive finite timer integers");
  }
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(path.join(parent, prefix));
  // -C does not override these environment selectors. Keep all writes in the owned repo.
  const commandEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(commandEnv)) {
    if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CONFIG_PARAMETERS|CONFIG_COUNT|CONFIG_KEY_\d+|CONFIG_VALUE_\d+)$/i.test(key)) delete commandEnv[key];
  }
  const children = new Set<ChildProcess>();
  const pending = new Set<Promise<Output>>();
  let closed = false;
  let setupActive = true;
  let phase = "allocate";
  let lastCommand = "none";
  let cleanup: Promise<void> | undefined;
  const started = performance.now();
  const diagnostic = (detail: string, cause?: unknown) => new Error(
    `Real Git fixture ${root}: ${phase}: ${lastCommand}: ${detail} (elapsed ${Math.round(performance.now() - started)}ms)`,
    { cause },
  );
  const stop = () => {
    closed = true;
    for (const child of children) child.kill("SIGKILL");
  };
  const dispose = () => cleanup ??= (async () => {
    stop();
    // execFile's callback runs after the child terminates; never delete a live child's cwd.
    await Promise.allSettled([...pending]);
    if (path.dirname(root) !== parent || !path.basename(root).startsWith(prefix)) throw diagnostic("unowned cleanup path refused");
    const stat = await lstat(root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!stat) return;
    if (stat.isSymbolicLink() || await realpath(root) !== root) throw diagnostic("changed cleanup root refused");
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  })();
  const command: RealGitFixture["command"] = (nextPhase, file, args) => {
    if (closed) return Promise.reject(diagnostic("fixture closed; later command refused"));
    phase = nextPhase;
    lastCommand = JSON.stringify([file, ...args]);
    const remaining = setupActive ? setupMs - (performance.now() - started) : commandMs;
    if (remaining <= 0) return Promise.reject(diagnostic(`setup deadline ${setupMs}ms exceeded`));
    const timeout = Math.max(1, Math.floor(Math.min(commandMs, remaining)));
    // Capture phase/command before another operation can change shared diagnostics.
    const description = `${nextPhase}: ${lastCommand}`;
    const result = new Promise<Output>((resolve, reject) => {
      const child = execFile(file, args, {
        windowsHide: true, env: commandEnv, timeout, killSignal: "SIGKILL", encoding: "utf8", maxBuffer: 1024 * 1024,
      }, (error, stdout, stderr) => {
        children.delete(child);
        if (error || closed) {
          reject(Object.assign(new Error(`Real Git fixture ${root}: ${description}: command failed or cancelled; bound ${timeout}ms; elapsed ${Math.round(performance.now() - started)}ms; ${stderr.trim()}`, { cause: error }), { childPid: child.pid }));
        } else resolve({ stdout, stderr });
      });
      children.add(child);
    });
    pending.add(result);
    const remove = () => { pending.delete(result); };
    void result.then(remove, remove);
    return result;
  };
  const fixture: RealGitFixture = {
    root, command, dispose,
    git: (...args) => command(`git ${args[0] ?? ""}`, "git", [
      "-C", root,
      // Synthetic local repositories must not start inherited hooks/signers/watchers.
      "-c", `core.hooksPath=${path.join(root, ".git", "dpf-disabled-hooks")}`,
      "-c", "commit.gpgsign=false", "-c", "core.fsmonitor=false", ...args,
    ]),
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { stop(); reject(diagnostic(`setup deadline ${setupMs}ms exceeded`)); }, setupMs);
    });
    const value = await Promise.race([Promise.resolve().then(() => initialize(fixture)), deadline]);
    if (performance.now() - started >= setupMs) throw diagnostic(`setup deadline ${setupMs}ms exceeded`);
    if (pending.size) throw diagnostic("unawaited subprocess at setup completion");
    setupActive = false;
    return { ...fixture, value };
  } catch (error) {
    try { await dispose(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "Real Git fixture setup and owned cleanup failed"); }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

