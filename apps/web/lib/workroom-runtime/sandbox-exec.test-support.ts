// Test seam for callers of the sandbox exec primitive (BI-224F56F1). The
// routing itself is covered by sandbox-exec.test.ts; caller tests keep driving
// their own `@/lib/shared/lazy-node` mock exactly as before, synchronously:
//
//   vi.mock("@/lib/workroom-runtime/sandbox-exec", () => import("@/lib/workroom-runtime/sandbox-exec.test-support").then(m => m.legacySandboxExec()));

import { promisify as nodePromisify } from "node:util";
import { vi } from "vitest";

export async function legacySandboxExec() {
  const lazy = await import("@/lib/shared/lazy-node");
  const actual = await vi.importActual<typeof import("./sandbox-exec")>("./sandbox-exec");
  const promisify = (() => {
    try { return lazy.lazyUtil().promisify; } catch { return nodePromisify; }
  })();
  return {
    ...actual,
    spawnSandboxExec: (args: readonly string[], options?: object) => (options === undefined
      ? lazy.lazyChildProcess().spawn("docker", args as string[])
      : lazy.lazyChildProcess().spawn("docker", args as string[], options)),
    execSandboxCommandLine: (line: string, options?: object) => {
      let run: ((line: string, options?: object) => Promise<{ stdout: string; stderr: string }>) | undefined;
      try { run = lazy.lazyExec() as typeof run; } catch { run = undefined; }
      return (run ?? (promisify(lazy.lazyChildProcess().exec) as (line: string, options?: object) => Promise<{ stdout: string; stderr: string }>))(line, options);
    },
  };
}
