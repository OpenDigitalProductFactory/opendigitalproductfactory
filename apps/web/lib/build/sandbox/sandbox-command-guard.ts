// apps/web/lib/build/sandbox/sandbox-command-guard.ts
//
// What run_sandbox_command refuses before a command reaches the sandbox. Moved
// out of apps/web/lib/mcp/packs/sandbox-pack.ts unchanged (the safety
// blocklist), plus the test-scope rule (BI-F5D4FA50): a test run that names no
// test files is the whole suite, which belongs to cloud CI and the merge queue.
//
// Commands run inside the sandbox container (docker exec), not the host OS.
// The container is isolated, but we still block commands that could:
//   - Destroy the workspace beyond git recovery
//   - Exfiltrate files to the internet
//   - Escape the container or affect the host Docker daemon
//   - Execute arbitrary code piped from the network

import { classifyShellTestCommand, unscopedTestRefusal } from "./test-scope-guard";

const BLOCKED_PATTERNS: readonly RegExp[] = [
  /rm\s+-rf\s+\/(?!workspace)/i,       // rm -rf outside /workspace
  /rm\s+-rf\s+\/workspace\s*$/i,        // rm -rf /workspace itself
  /curl\s+.*\|\s*(ba)?sh/i,             // curl | sh (remote code exec)
  /wget\s+.*\|\s*(ba)?sh/i,             // wget | sh
  /curl\s+.*\|\s*node/i,                // curl | node
  /docker\s+(run|exec|build|rm|rmi)/i,  // docker escape attempts
  /--privileged/i,                       // container privilege escalation
  /\/proc\/\d+\/fd/i,                   // procfs fd access
  /nsenter/i,                            // namespace escape
  /chroot/i,                             // chroot escape
  /mount\b/i,                            // mount syscall
  /chmod\s+[0-7]*7[0-7]*\s+\/(?!workspace)/i, // chmod outside workspace
];

export type SandboxCommandRefusal = {
  reason: "safety-policy" | "unscoped-test-run";
  error: string;
  message: string;
  /** Build activity line recording the refusal, when there is one to record. */
  activity?: string;
  data?: Record<string, unknown>;
};

/** The refusal for a command run_sandbox_command must not run, or null to run it. */
export function sandboxCommandRefusal(command: string): SandboxCommandRefusal | null {
  if (BLOCKED_PATTERNS.some((p) => p.test(command))) {
    return {
      reason: "safety-policy",
      error: "Command blocked by safety policy.",
      message: `This command is not permitted: "${command.slice(0, 100)}". Commands must operate within /workspace. Destructive operations outside the workspace, remote code execution, and container escape attempts are blocked.`,
    };
  }
  const testScope = classifyShellTestCommand(command);
  if (testScope.kind === "unscoped") {
    return {
      reason: "unscoped-test-run",
      error: "Unscoped test run refused.",
      message: unscopedTestRefusal(testScope.runner),
      activity: `Test scope guard refused an unscoped ${testScope.runner} run: ${command.slice(0, 100)}`,
      data: { testScopeGuard: { decision: "refused", runner: testScope.runner } },
    };
  }
  return null;
}
