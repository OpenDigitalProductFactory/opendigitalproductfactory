// apps/web/lib/build/sandbox/agents/dpf-native-agent-runner.ts
//
// `dpf-native` build agent — the governed common dispatch path for the
// embedded build surface. Spec: docs/superpowers/specs/2026-06-05-unified-
// delivery-surfaces-execution-alignment-design.md §4.4 and docs/superpowers/
// specs/2026-05-09-build-execution-provider-design.md ("The `dpf-native`
// agent", Contract 9 mode 1 / `LLM_BASE_URL`, cutover gates).
//
// Unlike codex/claude (mode-4 vendor CLIs that run inside the sandbox and call
// vendor endpoints directly — an audit gap), dpf-native runs its agentic loop
// IN THE PORTAL PROCESS and routes every model call through the platform's
// governed inference envelope (`callProvider` → routing → `LLM_BASE_URL`). The
// sandbox is a thin tool target: `provider.exec` / `provider.readFile` /
// `provider.writeFile` are the tools the loop drives. This gives:
//   - no vendor CLI binary in the image, no port-1455 OAuth callback, no
//     in-sandbox refresh token (`requiresCredential: false`);
//   - a full `ToolExecution` audit record per dispatch (real `toolExecutionId`,
//     not a static dispatch label like the CLI runners emit);
//   - substrate unlock: every substrate that can reach `LLM_BASE_URL` becomes
//     Build-Studio-capable (`honorsLlmBaseUrl: true`).
//
// SLICE 1 SCOPE (Tier 1, single-file edit — provider spec §"cutover gates"):
// this runner performs ONE governed inference turn for the task and applies the
// model's structured file directives to the sandbox. The multi-turn tool loop
// (read → reason → edit → verify → iterate) and the eval-gated tier promotion
// are deliberately out of scope here; the narrowest internal piece (multi-turn
// orchestration) is stubbed with a clear TODO so the runner contract is
// complete and selectable without throwing.

import { prisma } from "@dpf/db";
import { callProvider, type ChatMessage } from "@/lib/inference/ai-inference";
import type { AssignedTask } from "../../task-dependency-graph";
import type {
  AgentCredential,
  AgentRunResult,
  AgentRunSpec,
  BuildAgentRunner,
  BuildAgentRunnerCapabilities,
} from "../agent-runner-types";
import type { BuildExecutionProvider, SandboxHandle } from "../provider-types";
import { getErrorMessage } from "@/lib/shared/get-error-message";

// dpf-native's capability profile is the inverse of the mode-4 CLI runners:
// the loop lives in the portal, so it needs no persistent in-sandbox session,
// no callback port, and no per-task credential injected into the sandbox. It
// DOES honor `LLM_BASE_URL` — which is what makes it legal on `untrusted-ok`
// providers (see `assertAgentProviderCompatibility`) and on every cloud-native
// substrate. Tier starts at "single-file-edit" per the cutover gates; the
// router promotes it as eval evidence accrues.
const capabilities: BuildAgentRunnerCapabilities = {
  tier: "single-file-edit",
  requiresPersistentSession: false,
  requiresCredential: false,
  honorsLlmBaseUrl: true,
};

// Default governed model selector for the dpf-native loop. Resolved from env so
// installs (including air-gapped / local-LLM) can point the loop at their
// Contract 9 mode-1 endpoint without code changes; the actual base URL is
// honored downstream by the routing layer via `LLM_BASE_URL`.
const DEFAULT_PROVIDER_ID = process.env.DPF_NATIVE_PROVIDER_ID ?? "anthropic";
const DEFAULT_MODEL_ID = process.env.DPF_NATIVE_MODEL_ID ?? "claude-sonnet-4-5";

function taskFromSpec(spec: AgentRunSpec): AssignedTask {
  if (spec.task) return spec.task;
  const title = spec.title ?? spec.prompt?.split(/\r?\n/)[0]?.slice(0, 80) ?? "Build task";
  return {
    taskIndex: 0,
    title,
    specialist: "software-engineer",
    files: [],
    task: {
      title,
      testFirst: "",
      implement: spec.prompt ?? title,
      verify: "",
    },
  };
}

const SYSTEM_PROMPT = [
  "You are the DPF native build agent. You implement a single build task by",
  "emitting file edits. Respond ONLY with a fenced ```dpf-edits block containing",
  "a JSON array of { \"path\": string, \"content\": string } objects — the full",
  "intended content of each file you create or replace. Do not include prose",
  "outside the block. If no edit is needed, emit an empty array.",
].join(" ");

function buildTaskMessages(task: AssignedTask, spec: AgentRunSpec): ChatMessage[] {
  const t = task.task;
  const parts = [
    `# Task: ${t.title}`,
    "",
    "## Implement",
    t.implement || spec.prompt || t.title,
  ];
  if (t.testFirst) parts.push("", "## Test first", t.testFirst);
  if (t.verify) parts.push("", "## Verify", t.verify);
  if (spec.buildContext) parts.push("", "## Project context", spec.buildContext.slice(0, 3000));
  if (spec.priorResults) parts.push("", "## Prior task results", spec.priorResults.slice(0, 2000));
  return [{ role: "user", content: parts.join("\n") }];
}

export type DpfNativeFileEdit = { path: string; content: string };

/**
 * Parse the model's `dpf-edits` directive block into concrete file edits.
 *
 * Exported for unit testing. Returns an empty array on any malformed output
 * (the loop treats "no parseable edits" as a no-op rather than a crash — a bad
 * turn is a failed turn, not a thrown dispatch).
 */
export function parseFileEdits(content: string): DpfNativeFileEdit[] {
  const fence = content.match(/```(?:dpf-edits|json)?\s*([\s\S]*?)```/);
  const raw = (fence ? fence[1] : content).trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is DpfNativeFileEdit =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as DpfNativeFileEdit).path === "string" &&
        typeof (e as DpfNativeFileEdit).content === "string",
    );
  } catch {
    return [];
  }
}

export const dpfNativeAgentRunner: BuildAgentRunner = {
  id: "dpf-native",

  async prepare(
    _provider: BuildExecutionProvider,
    _handle: SandboxHandle,
    _credential: AgentCredential | null,
  ): Promise<void> {
    // No-op: dpf-native injects no credential into the sandbox and opens no
    // callback port. Inference auth is resolved per-call by the governed
    // inference envelope (portal-side credential store), not by the sandbox.
  },

  async run(
    provider: BuildExecutionProvider,
    handle: SandboxHandle,
    spec: AgentRunSpec,
  ): Promise<AgentRunResult> {
    const startedAt = Date.now();
    const task = taskFromSpec(spec);
    const providerId = spec.providerId ?? DEFAULT_PROVIDER_ID;
    const modelId = spec.model ?? DEFAULT_MODEL_ID;
    const buildId = spec.buildId ?? "unknown-build";

    spec.onProgress?.(`[dpf-native] dispatching "${task.title}" via governed inference (${providerId}/${modelId})`);

    let inferenceContent = "";
    let success = false;
    let stderr = "";
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    let edits: DpfNativeFileEdit[] = [];
    const appliedFiles: string[] = [];

    try {
      // One governed inference turn through the platform envelope. This is the
      // audit/no-bypass advantage: the call flows through `callProvider` →
      // routing → `LLM_BASE_URL`, not a vendor CLI shelling out of the sandbox.
      const result = await callProvider(
        providerId,
        modelId,
        buildTaskMessages(task, spec),
        SYSTEM_PROMPT,
      );
      inferenceContent = result.content;
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;

      edits = parseFileEdits(result.content);

      // Apply edits to the sandbox via the thin tool target. The sandbox is the
      // tool, the portal-side loop is the agent (provider spec §"The dpf-native
      // agent"). TODO(spec §4.4): replace this single apply pass with the full
      // multi-turn tool loop (read → reason → edit → verify → iterate) and the
      // eval-gated tier promotion (provider spec §"cutover gates"). Tier-1
      // single-file edit is sufficient for the first real slice.
      for (const edit of edits) {
        await provider.writeFile(handle, edit.path, edit.content);
        appliedFiles.push(edit.path);
        spec.onProgress?.(`[dpf-native] wrote ${edit.path}`);
      }

      success = true;
    } catch (err) {
      success = false;
      stderr = getErrorMessage(err);
      spec.onProgress?.(`[dpf-native] dispatch failed: ${stderr}`);
    }

    const durationMs = Date.now() - startedAt;

    // Governed audit record. The real cuid `id` becomes the `toolExecutionId`
    // returned to the orchestrator — a genuine audit handle, not the static
    // dispatch label the CLI runners emit. Best-effort: a DB hiccup must not
    // turn a successful dispatch into a thrown run, so we fall back to an
    // in-memory id and keep going.
    let toolExecutionId = `dpf-native:${buildId}:${startedAt}`;
    try {
      const row = await prisma.toolExecution.create({
        data: {
          threadId: buildId,
          agentId: "system:dpf-native",
          userId: "system",
          toolName: "dpf_native_build_dispatch",
          parameters: {
            buildId,
            taskTitle: task.title,
            providerId,
            modelId,
            specialist: task.specialist,
          },
          result: {
            appliedFiles,
            editCount: edits.length,
            outputExcerpt: inferenceContent.slice(0, 2000),
          },
          success,
          executionMode: "background",
          routeContext: "/build",
          durationMs,
          ...(inputTokens !== null && { inputTokens }),
          ...(outputTokens !== null && { outputTokens }),
          summary: success
            ? `dpf-native applied ${appliedFiles.length} file(s) for "${task.title}".`
            : `dpf-native dispatch failed for "${task.title}": ${stderr}`,
        },
        select: { id: true },
      });
      toolExecutionId = row.id;
    } catch (err) {
      // Audit-row write failed — surface in stderr but don't fail the dispatch.
      const auditErr = getErrorMessage(err);
      stderr = stderr ? `${stderr}\n[audit] ${auditErr}` : `[audit] ${auditErr}`;
    }

    return {
      exitCode: success ? 0 : 1,
      stdout: inferenceContent,
      stderr,
      durationMs,
      toolExecutionId,
      agentId: "dpf-native",
      providerId: provider.id,
    };
  },

  capabilities(): BuildAgentRunnerCapabilities {
    return capabilities;
  },
};
