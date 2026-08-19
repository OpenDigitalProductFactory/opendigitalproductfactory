// apps/web/lib/build/sandbox-tool-surface-detector.ts
// Split from build-orchestrator.ts to keep the oversized orchestrator under
// the module-size ratchet while preserving the Build Studio dispatch fallback.

/**
 * Detect the failure mode from BI-9F634B90: a frontier CLI session receives a
 * Build Studio task/prompt that expects platform sandbox tools, but the session
 * only has its native CLI/tool surface. That mismatch used to look like a
 * normal BLOCKED specialist result and could leave the build stalled after
 * dispatch. Treat it as a dispatch-surface mismatch so the orchestrator can
 * retry through the portal agentic-loop path, which attaches the real platform
 * sandbox tools.
 */
export function isMissingSandboxToolSurfaceOutput(content: string): boolean {
  const normalized = content.toLowerCase();
  if (!normalized) return false;

  const hasToolSurfaceComplaint =
    normalized.includes("tool set") ||
    normalized.includes("not exposed") ||
    normalized.includes("not available") ||
    normalized.includes("lack") ||
    normalized.includes("cannot call") ||
    normalized.includes("can't call");

  const mentionsRequiredSandboxTools = [
    "read_sandbox_file",
    "edit_sandbox_file",
    "write_sandbox_file",
    "run_sandbox_command",
    "run_sandbox_tests",
  ].some((toolName) => normalized.includes(toolName));

  return hasToolSurfaceComplaint && mentionsRequiredSandboxTools;
}
