// Runtime-coordination tool pack — BI-ARCH-TOOLPACKS.
//
// Second extraction, and the first with LAZY handlers: the handlers live in
// @/lib/runtime-coordination/mcp-handlers and were dynamically imported per
// switch case, so the pack's handler map preserves that exactly — each handler
// is a thin wrapper that lazy-imports the module only when the tool is called
// (and passes the same arguments the switch case did). Definitions are moved
// verbatim from mcp-tools.ts; grants mirror agent-grants.ts TOOL_TO_GRANTS.

import type { ToolDefinition } from "@/lib/mcp-tools";
import { runtimeCoordinationToolEnums } from "@/lib/runtime-coordination/mcp-handlers";
import type { ToolPack } from "../tool-pack";

const ENUMS = runtimeCoordinationToolEnums();

const definitions: ToolDefinition[] = [
  {
    name: "register_runtime_target",
    description:
      "Register or refresh the governed runtime surface where work is being verified. Source ownership is read through Work Capsule, FeatureBuild, Sandbox, or GitPromotionCandidate links.",
    inputSchema: {
      type: "object",
      properties: {
        targetId: { type: "string", description: "Stable runtime target id, e.g. RT-ROOT-PORTAL or RT-SANDBOX-<sandboxRowId>." },
        kind: { type: "string", enum: ENUMS.targetKinds, description: "Runtime target kind." },
        status: { type: "string", enum: ENUMS.targetStatuses, description: "Runtime target status." },
        capsuleId: { type: "string", description: "Optional semantic Work Capsule id (WC-*)." },
        workCapsuleId: { type: "string", description: "Optional internal WorkCapsule row id; prefer capsuleId for external agents." },
        buildId: { type: "string", description: "Optional semantic FeatureBuild id (FB-*)." },
        featureBuildId: { type: "string", description: "Optional internal FeatureBuild row id; prefer buildId for external agents." },
        sandboxId: { type: "string", description: "Optional Sandbox row id." },
        slotId: { type: "string", description: "Optional SandboxSlot row id." },
        composeProjectName: { type: "string", description: "Compose project name when applicable." },
        serviceName: { type: "string", description: "Compose service name when applicable." },
        containerName: { type: "string", description: "Docker container name when applicable." },
        hostUrl: { type: "string", description: "Host-reachable URL." },
        internalUrl: { type: "string", description: "Container/internal URL." },
        port: { type: "number", description: "Host port when applicable." },
        serviceVersion: { type: "string", description: "OpenTelemetry service.version style artifact string, e.g. image + git SHA." },
        acceptanceRoleOverride: { type: "string", enum: ["debug-only"], description: "Rare override. Most roles are derived from kind." },
        debugReason: { type: "string", description: "Required for ad-hoc-debug targets." },
        expiresAt: { type: "string", description: "Optional ISO timestamp for temporary targets." },
        metadata: { type: "object", description: "Free-form snapshot data; never the source of truth." },
      },
      required: ["targetId", "kind", "status"],
    },
    requiredCapability: "manage_backlog",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "heartbeat_runtime_target",
    description: "Refresh the heartbeat for a governed runtime target.",
    inputSchema: {
      type: "object",
      properties: {
        targetId: { type: "string", description: "Stable runtime target id." },
      },
      required: ["targetId"],
    },
    requiredCapability: "manage_backlog",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "release_runtime_target",
    description: "Mark a governed runtime target released so another thread can safely use the surface.",
    inputSchema: {
      type: "object",
      properties: {
        targetId: { type: "string", description: "Stable runtime target id." },
      },
      required: ["targetId"],
    },
    requiredCapability: "manage_backlog",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "record_runtime_verification",
    description:
      "Record a typed verification event against exactly one primary runtime/build/promotion attach point, with optional evidence links. " +
      "One verificationId per real check — do not re-record the same command result as thrash heartbeats. " +
      "Supersede with status=superseded when replacing, rather than inventing parallel ids.",
    inputSchema: {
      type: "object",
      properties: {
        verificationId: { type: "string", description: "Stable verification id." },
        kind: { type: "string", enum: ENUMS.verificationKinds, description: "Verification kind." },
        status: { type: "string", enum: ENUMS.verificationStatuses, description: "Verification status." },
        targetId: { type: "string", description: "Optional stable RuntimeTarget id (RT-*)." },
        runtimeTargetId: { type: "string", description: "Optional RuntimeTarget row id; RT-* targetId is also accepted for compatibility." },
        capsuleId: { type: "string", description: "Optional semantic Work Capsule id (WC-*) for capsule-only or mirrored evidence." },
        workCapsuleId: { type: "string", description: "Optional WorkCapsule row id; prefer capsuleId for external agents." },
        buildId: { type: "string", description: "Optional semantic FeatureBuild id (FB-*)." },
        featureBuildId: { type: "string", description: "Optional FeatureBuild row id; prefer buildId for external agents." },
        candidateId: { type: "string", description: "Optional semantic GitPromotionCandidate id." },
        gitPromotionCandidateId: { type: "string", description: "Optional GitPromotionCandidate row id; prefer candidateId for external agents." },
        command: { type: "string", description: "Command that produced the verification." },
        url: { type: "string", description: "URL checked." },
        evidenceUrl: { type: "string", description: "Evidence URL." },
        screenshotUrl: { type: "string", description: "Screenshot URL." },
        toolExecutionId: { type: "string", description: "ToolExecution row id." },
        buildActivityId: { type: "string", description: "BuildActivity row id." },
        backlogActivityId: { type: "string", description: "BacklogItemActivity row id." },
        capsuleActivityId: { type: "string", description: "WorkCapsuleActivity row id." },
        startedAt: { type: "string", description: "Optional ISO start timestamp." },
        completedAt: { type: "string", description: "Optional ISO completion timestamp." },
        result: { type: "object", description: "Structured result payload." },
      },
      required: ["verificationId", "kind", "status"],
    },
    requiredCapability: "manage_backlog",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "get_runtime_coordination_map",
    description:
      "List governed runtime targets with recent verification events so operators can see what is deployed where and what is safe to merge.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ENUMS.targetKinds, description: "Filter by target kind." },
        status: { type: "string", enum: ENUMS.targetStatuses, description: "Filter by target status." },
        limit: { type: "number", description: "Max targets (default 50, max 100)." },
      },
      required: [],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
  },
];

const HANDLERS = () => import("@/lib/runtime-coordination/mcp-handlers");

export const runtimeCoordinationPack: ToolPack = {
  packId: "runtime-coordination",
  definitions,
  handlers: {
    register_runtime_target: (params, userId, context) =>
      HANDLERS().then((m) => m.registerRuntimeTargetTool(params, userId, context)),
    heartbeat_runtime_target: (params) => HANDLERS().then((m) => m.heartbeatRuntimeTargetTool(params)),
    release_runtime_target: (params, userId, context) =>
      HANDLERS().then((m) => m.releaseRuntimeTargetTool(params, userId, context)),
    record_runtime_verification: (params, userId, context) =>
      HANDLERS().then((m) => m.recordRuntimeVerificationTool(params, userId, context)),
    get_runtime_coordination_map: (params) =>
      HANDLERS().then((m) => m.getRuntimeCoordinationMapTool(params)),
  },
  grants: {
    register_runtime_target: ["work_capsule_write"],
    heartbeat_runtime_target: ["work_capsule_write"],
    release_runtime_target: ["work_capsule_write"],
    record_runtime_verification: ["work_capsule_write"],
    get_runtime_coordination_map: ["work_capsule_read"],
  },
};
