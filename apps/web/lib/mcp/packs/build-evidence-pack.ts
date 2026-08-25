// Build-evidence tool pack — scoped ToolPack extraction.
//
// Drains the build/backlog evidence-capture domain out of the mcp-tools.ts
// executeTool switch: attaching an evidence record to a backlog item, deduping
// a Playwright functional-failure into a backlog item, and recording a local
// merged-code integration result. Each handler reproduces the former switch
// case verbatim (dynamic imports retargeted to absolute @/lib paths), so
// behaviour is identical when the tool is invoked over MCP.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source. The
// functional-failure handler used one local redaction helper that had no other
// consumer; it is replicated here so the pack is self-contained.

import * as crypto from "crypto";
import { prisma } from "@dpf/db";

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import {
  EXECUTION_EVIDENCE_KINDS,
  isExecutionEvidenceKind,
  validateExecutionEvidenceStructure,
} from "@/lib/backlog/execution-evidence";
import type { ToolPack, ToolPackHandler } from "../tool-pack";
import {
  isNonprodOwnerProvider,
  NONPROD_OWNER_PROVIDERS,
} from "@/lib/nonprod/nonprod-owner-provider";

/** Strip bearer tokens / MCP tokens / Anthropic keys out of operator-supplied failure text. */
function redactFunctionalFailureText(text: string): string {
  return text
    .replace(/\bdpfmcp_[A-Za-z0-9_-]+/g, "[redacted-token]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/g, "[redacted-token]")
    // BI-1291B677: Anthropic OAuth tokens (sk-ant-oat01-*) and API keys
    // (sk-ant-api03-*) in raw form.
    .replace(/\bsk-ant-[A-Za-z0-9_-]{8,}/g, "[redacted-token]")
    // BI-1291B677: a secret staged into the sandbox as `echo '<base64>' | base64 -d`
    // (the CLI dispatch token / mcp-config write). Redact the base64 payload so a
    // surfaced docker command can't be reversed back to the secret.
    .replace(/echo '[A-Za-z0-9+\/=]{20,}'(\s*\|\s*base64\s+-d)/g, "echo '[redacted-token]'$1");
}

const definitions: ToolDefinition[] = [
  {
    name: "record_execution_evidence",
    description: "Attach typed evidence to a backlog item (tests, production build, UX, migration, source provenance, spec review, manual check, or supporting link). Positive completion evidence is later resolved server-side; a supplied ToolExecution reference must identify a successful execution owned by the same user.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "Semantic backlog item id" },
        kind: {
          type: "string",
          enum: [...EXECUTION_EVIDENCE_KINDS],
          description: "Evidence kind",
        },
        summary: { type: "string", description: "Headline for the timeline (<= 240 chars)" },
        url: { type: "string", description: "Link to PR / CI run / screenshot" },
        body: { type: "string", description: "Longer notes (<= 8000 chars)" },
        toolExecutionId: { type: "string", description: "Audit row id when this evidence was produced by a prior tool call" },
      },
      required: ["itemId", "kind", "summary"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "record_local_integration_result",
    description: "Record the result of a local merged-code integration gate before push or PR. Captures candidate branch, mode, status (passed | failed | conflict | blocked_sandbox_drift | blocked_control_plane_starvation), and evidence including dependency freshness and concurrent control-plane health. Blocked statuses are infrastructure evidence, not product failures.",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", enum: [...NONPROD_OWNER_PROVIDERS] },
        externalSessionId: { type: "string" },
        routeContext: { type: "string" },
        buildId: { type: "string" },
        taskRunId: { type: "string" },
        candidateBranch: { type: "string" },
        mode: { type: "string", enum: ["single-branch", "sibling-set", "post-merge-main"] },
        status: { type: "string", enum: ["passed", "failed", "conflict", "blocked_sandbox_drift", "blocked_control_plane_starvation"] },
        summary: { type: "string" },
        gateKey: { type: "string", description: "Server-derived immutable gate key returned at admission." },
        leaseId: { type: "string", description: "Canonical executor lease id returned at admission." },
        evidence: { type: "object" },
      },
      required: ["provider", "externalSessionId", "routeContext", "candidateBranch", "mode", "status", "summary", "evidence"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
  },
  {
    name: "record_functional_failure_evidence",
    description: "Create or update a deduped backlog item from Playwright FunctionalFailureEvidence. Uses a deterministic testId+route+actual fingerprint and records an evidence activity; the cross-cutting audit lives in ToolExecution. Side-effecting.",
    inputSchema: {
      type: "object",
      properties: {
        testId: { type: "string", description: "Stable automated test id" },
        suite: { type: "string", description: "Playwright suite or project" },
        route: { type: "string", description: "Application route under test" },
        expected: { type: "string", description: "Expected behavior" },
        actual: { type: "string", description: "Observed failure" },
        screenshotPath: { type: "string", description: "Local screenshot path when available" },
        tracePath: { type: "string", description: "Local trace path when available" },
        userRole: { type: "string", description: "User role used by the test" },
        agentId: { type: "string", description: "Expected or active coworker id" },
        routeContext: { type: "string", description: "Route context used by the test" },
        reproCommand: { type: "string", description: "Command to reproduce the failure" },
        createdAt: { type: "string", description: "Evidence timestamp" },
        likelyOwnerArea: { type: "string", description: "Likely owning product area" },
        buildId: { type: "string", description: "Optional Build Studio id" },
        backlogItemId: { type: "string", description: "Optional explicit backlog item to attach to" },
      },
      required: [
        "testId",
        "suite",
        "route",
        "expected",
        "actual",
        "userRole",
        "routeContext",
        "reproCommand",
        "createdAt",
        "likelyOwnerArea",
      ],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
];

async function recordExecutionEvidenceHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const itemIdRaw = String(params["itemId"] ?? "").trim();
  const kindRaw = String(params["kind"] ?? "");
  const summaryRaw = String(params["summary"] ?? "").slice(0, 240);
  const url = typeof params["url"] === "string" ? params["url"] : null;
  const body = typeof params["body"] === "string" ? params["body"].slice(0, 8000) : null;
  const toolExecutionId =
    typeof params["toolExecutionId"] === "string" ? params["toolExecutionId"] : null;
  if (!itemIdRaw || !kindRaw || !summaryRaw)
    return {
      success: false,
      error: "missing_required",
      message: "itemId, kind, summary are all required",
    };
  if (!isExecutionEvidenceKind(kindRaw))
    return { success: false, error: "invalid_kind", message: `kind=${kindRaw} not allowed` };
  const structuralError = validateExecutionEvidenceStructure(kindRaw, url);
  if (structuralError) {
    return { success: false, error: "invalid_evidence", message: structuralError };
  }
  const item = await prisma.backlogItem.findUnique({
    where: { itemId: itemIdRaw },
    select: { id: true },
  });
  if (!item)
    return { success: false, error: "not_found", message: `Item ${itemIdRaw} not found` };
  if (toolExecutionId) {
    const toolExecution = await prisma.toolExecution.findUnique({
      where: { id: toolExecutionId },
      select: { id: true, success: true, userId: true },
    });
    if (!toolExecution?.success || toolExecution.userId !== userId) {
      return {
        success: false,
        error: "invalid_tool_execution",
        message: `ToolExecution ${toolExecutionId} does not resolve to a successful execution owned by this user`,
      };
    }
  }
  const activity = await prisma.backlogItemActivity.create({
    data: {
      backlogItemId: item.id,
      kind: "evidence",
      summary: summaryRaw,
      payload: {
        evidenceKind: kindRaw,
        url,
        body,
        toolExecutionId,
      },
      recordedById: userId,
      recordedByAgentId: context?.agentId ?? null,
      toolExecutionId,
    },
  });
  return {
    success: true,
    entityId: activity.id,
    message: `Recorded ${kindRaw} evidence for ${itemIdRaw}`,
    data: { activityId: activity.id, recordedAt: activity.recordedAt.toISOString() },
  };
}

async function recordLocalIntegrationResultHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: { routeContext?: string },
): Promise<ToolResult> {
  const { recordLocalIntegrationResult } = await import("@/lib/nonprod/local-integration");
  const stringValue = (key: string) => (typeof params[key] === "string" ? String(params[key]).trim() : "");
  const provider = stringValue("provider");
  const externalSessionId = stringValue("externalSessionId");
  const routeContext = stringValue("routeContext") || context?.routeContext || "";
  const candidateBranch = stringValue("candidateBranch");
  const mode = stringValue("mode");
  const status = stringValue("status");
  const summary = stringValue("summary");
  const evidence = params["evidence"];
  const missing = [
    ["provider", provider],
    ["externalSessionId", externalSessionId],
    ["routeContext", routeContext],
    ["candidateBranch", candidateBranch],
    ["mode", mode],
    ["status", status],
    ["summary", summary],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (evidence === undefined) missing.push("evidence");
  if (missing.length > 0) {
    return {
      success: false,
      error: "missing_required",
      message: `Missing required local integration result field(s): ${missing.join(", ")}`,
    };
  }
  if (!isNonprodOwnerProvider(provider)) {
    return { success: false, error: "invalid_provider", message: `Unsupported provider: ${provider}` };
  }
  if (!["single-branch", "sibling-set", "post-merge-main"].includes(mode)) {
    return { success: false, error: "invalid_mode", message: `Unsupported local integration mode: ${mode}` };
  }
  if (!["passed", "failed", "conflict", "blocked_sandbox_drift", "blocked_control_plane_starvation"].includes(status)) {
    return { success: false, error: "invalid_status", message: `Unsupported local integration status: ${status}` };
  }

  const result = await recordLocalIntegrationResult({
    actorUserId: userId,
    provider,
    externalSessionId,
    routeContext,
    buildId: stringValue("buildId") || undefined,
    taskRunId: stringValue("taskRunId") || undefined,
    candidateBranch,
    mode: mode as "single-branch" | "sibling-set" | "post-merge-main",
    status: status as "passed" | "failed" | "conflict" | "blocked_sandbox_drift" | "blocked_control_plane_starvation",
    summary,
    gateKey: stringValue("gateKey") || undefined,
    leaseId: stringValue("leaseId") || undefined,
    evidence: evidence as import("@dpf/db").Prisma.InputJsonValue,
  });
  return {
    success: true,
    entityId: result.id,
    message: `Recorded local integration result for ${candidateBranch}.`,
    data: { evidenceId: result.id, status },
  };
}

async function recordFunctionalFailureEvidenceHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const required = [
    "testId",
    "suite",
    "route",
    "expected",
    "actual",
    "userRole",
    "routeContext",
    "reproCommand",
    "createdAt",
    "likelyOwnerArea",
  ];
  const missing = required.filter((key) => typeof params[key] !== "string" || !String(params[key]).trim());
  if (missing.length > 0) {
    return {
      success: false,
      error: "missing_required",
      message: `Missing required functional failure evidence field(s): ${missing.join(", ")}`,
    };
  }

  const testId = String(params["testId"]).trim();
  const suite = String(params["suite"]).trim();
  const route = String(params["route"]).trim();
  const expected = redactFunctionalFailureText(String(params["expected"]));
  const actual = redactFunctionalFailureText(String(params["actual"]));
  const userRole = String(params["userRole"]).trim();
  const routeContext = String(params["routeContext"]).trim();
  const reproCommand = String(params["reproCommand"]).trim();
  const createdAt = String(params["createdAt"]).trim();
  const likelyOwnerArea = String(params["likelyOwnerArea"]).trim();
  const agentId = typeof params["agentId"] === "string" ? params["agentId"].trim() || null : null;
  const screenshotPath =
    typeof params["screenshotPath"] === "string" ? params["screenshotPath"].trim() || null : null;
  const tracePath = typeof params["tracePath"] === "string" ? params["tracePath"].trim() || null : null;
  const buildId = typeof params["buildId"] === "string" ? params["buildId"].trim() || null : null;
  const explicitItemId =
    typeof params["backlogItemId"] === "string" ? params["backlogItemId"].trim() || null : null;

  const normalizedActual = actual.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 1200);
  const failureFingerprint = crypto
    .createHash("sha256")
    .update(`${testId}|${route}|${normalizedActual}`)
    .digest("hex")
    .slice(0, 16);

  const evidencePayload = {
    evidenceKind: "test_fail",
    source: "functional-test-failure",
    failureFingerprint,
    testId,
    suite,
    route,
    expected,
    actual,
    screenshotPath,
    tracePath,
    userRole,
    agentId,
    routeContext,
    reproCommand,
    createdAt,
    likelyOwnerArea,
    buildId,
  };
  const summary = `${testId} failed${route ? ` on ${route}` : ""}: ${actual.slice(0, 120)}`;

  let item = explicitItemId
    ? await prisma.backlogItem.findUnique({
        where: { itemId: explicitItemId },
        select: { id: true, itemId: true, occurrenceCount: true },
      })
    : null;

  if (!item) {
    item = await prisma.backlogItem.findFirst({
      where: {
        source: "functional-test-failure",
        status: { notIn: ["done", "deferred", "retired"] },
        body: { contains: `failureFingerprint: ${failureFingerprint}` },
      },
      select: { id: true, itemId: true, occurrenceCount: true },
    });
  }

  let action: "created" | "updated";
  if (!item) {
    item = await prisma.backlogItem.create({
      data: {
        itemId: `BI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        title: `[${testId}] ${route} functional smoke failure`,
        type: "product",
        status: "triaging",
        source: "functional-test-failure",
        submittedById: userId,
        agentId: context?.agentId ?? agentId ?? null,
        lastSeenAt: new Date(createdAt),
        body: [
          `failureFingerprint: ${failureFingerprint}`,
          `ownerArea: ${likelyOwnerArea}`,
          `route: ${route}`,
          `suite: ${suite}`,
          `expected: ${expected}`,
          `actual: ${actual}`,
          `repro: ${reproCommand}`,
        ].join("\n"),
      },
      select: { id: true, itemId: true, occurrenceCount: true },
    });
    action = "created";
  } else {
    item = await prisma.backlogItem.update({
      where: { id: item.id },
      data: {
        occurrenceCount: { increment: 1 },
        lastSeenAt: new Date(createdAt),
      },
      select: { id: true, itemId: true, occurrenceCount: true },
    });
    action = "updated";
  }

  const activity = await prisma.backlogItemActivity.create({
    data: {
      backlogItemId: item.id,
      kind: "evidence",
      summary: action === "created" ? summary.slice(0, 240) : `${testId} failed again on ${route}`.slice(0, 240),
      payload: evidencePayload,
      recordedById: userId,
      recordedByAgentId: context?.agentId ?? agentId ?? null,
    },
  });

  return {
    success: true,
    entityId: item.itemId,
    message:
      action === "created"
        ? `Created ${item.itemId} for ${testId} functional failure`
        : `Updated ${item.itemId} with repeated ${testId} functional failure`,
    data: {
      action,
      itemId: item.itemId,
      activityId: activity.id,
      failureFingerprint,
      occurrenceCount: item.occurrenceCount,
      recordedAt: activity.recordedAt.toISOString(),
    },
  };
}

const handlers: Record<string, ToolPackHandler> = {
  record_execution_evidence: (params, userId, context) => recordExecutionEvidenceHandler(params, userId, context),
  record_local_integration_result: (params, userId, context) => recordLocalIntegrationResultHandler(params, userId, context),
  record_functional_failure_evidence: (params, userId, context) => recordFunctionalFailureEvidenceHandler(params, userId, context),
};

export const buildEvidencePack: ToolPack = {
  packId: "build-evidence",
  definitions,
  handlers,
  grants: {
    record_execution_evidence: ["build_evidence"],
    record_local_integration_result: ["backlog_write"],
    record_functional_failure_evidence: ["backlog_write"],
  },
};
