// apps/web/lib/mcp/siem-handlers.ts (relocated from lib/mcp-tools-siem.ts — W9, BI-0E7B0953)
// EP-SOVEREIGN-SOC P2c (BI-5A9A5E03) — the AI-SOC coworker tool surface.
//
// Self-contained tool module (mirrors deliberation-handlers.ts): exports
// SIEM_TOOLS + handlers, registered into PLATFORM_TOOLS + the executeTool
// dispatch in mcp-tools.ts. Reads query the SecurityEvent / Detection /
// SecurityCase substrate; writes are coworkerArtifact + propose-only — a
// coworker opens/updates cases (its legitimate worklist output) and PROPOSES
// response / tuning, but never executes on a customer estate (that rides the
// proposal-not-action rail in P3). Grant-gated via TOOL_TO_GRANTS:
//   siem_read        — query events / detections / cases
//   siem_investigate — open + update cases (implies siem_read)
//   siem_tune        — propose detection-rule tuning (implies siem_read)
//   incident_respond — propose a response action (implies siem_read)
//
// Spec: docs/superpowers/specs/2026-06-24-sovereign-soc-siem-design.md §4.4, §7.2.

import { randomUUID } from "node:crypto";

import { prisma } from "@dpf/db";

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import {
  decideSecurityResponse,
  type SecurityBlastRadius,
  type SecurityResponseConsent,
  type SecurityResponseInput,
} from "@/lib/security/response-authority";

type SiemContext = {
  routeContext?: string;
  agentId?: string;
  threadId?: string;
};

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

const clampLimit = (v: unknown, fallback: number, cap: number): number => {
  const n = num(v);
  if (n === undefined) return fallback;
  return Math.max(1, Math.min(cap, Math.floor(n)));
};

// ── Tool definitions ────────────────────────────────────────────────────────

export const SIEM_TOOLS: ToolDefinition[] = [
  {
    name: "query_security_events",
    description:
      "Query normalized OCSF security events (read-only). Filter by scope, customer, minimum OCSF severity, source kind, and a lookback window.",
    inputSchema: {
      type: "object",
      properties: {
        scopeKey: { type: "string", description: "e.g. organization:internal or customer:<id>" },
        customerAccountId: { type: "string" },
        minSeverityId: { type: "number", description: "OCSF severity_id 0..6" },
        sourceKind: { type: "string", description: "windows.security | syslog | aws.cloudtrail | dpf.internal | cef" },
        sinceMinutes: { type: "number", description: "lookback window in minutes (default 60)" },
        limit: { type: "number", description: "max rows (default 50, max 200)" },
      },
    },
    requiredCapability: null,
    sideEffect: false,
  },
  {
    name: "query_detections",
    description:
      "Query fired detections (read-only). Filter by scope, customer, status, and severity, newest first.",
    inputSchema: {
      type: "object",
      properties: {
        scopeKey: { type: "string" },
        customerAccountId: { type: "string" },
        status: { type: "string", description: "open | triaged | linked | suppressed | closed" },
        severity: { type: "string", description: "info | low | medium | high | critical" },
        limit: { type: "number", description: "max rows (default 50, max 200)" },
      },
    },
    requiredCapability: null,
    sideEffect: false,
  },
  {
    name: "get_security_case",
    description:
      "Get one security case by caseKey, with its linked detections (read-only).",
    inputSchema: {
      type: "object",
      properties: { caseKey: { type: "string" } },
      required: ["caseKey"],
    },
    requiredCapability: null,
    sideEffect: false,
  },
  {
    name: "open_security_case",
    description:
      "Open a security case (the analyst worklist record) and link the given detections to it. The verdict starts 'unknown' — it is an evidence conclusion set later by investigation, not now.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        scopeKey: { type: "string" },
        customerAccountId: { type: "string" },
        customerSiteId: { type: "string" },
        severity: { type: "string", description: "info | low | medium | high | critical" },
        detectionKeys: { type: "array", items: { type: "string" }, description: "detections to group into this case" },
      },
      required: ["title", "scopeKey", "severity"],
    },
    requiredCapability: null,
    sideEffect: true,
    coworkerArtifact: true,
  },
  {
    name: "update_security_case",
    description:
      "Update a security case: advance status, set the evidence-based verdict + confidence, assign, and append a timeline entry. Verdict is an evidence conclusion; the governed ACTION decisions are separate.",
    inputSchema: {
      type: "object",
      properties: {
        caseKey: { type: "string" },
        status: { type: "string", description: "new | triaging | investigating | contained | resolved | closed" },
        verdict: { type: "string", description: "unknown | false-positive | benign-true-positive | malicious | needs-human" },
        confidence: { type: "string", description: "low | medium | high | confirmed" },
        assignedAgentId: { type: "string" },
        timelineNote: { type: "string", description: "a timeline entry describing what was found/decided" },
        evidenceRef: { type: "string", description: "optional pointer (eventKey, detectionKey, url) for the timeline entry" },
      },
      required: ["caseKey"],
    },
    requiredCapability: null,
    sideEffect: true,
    coworkerArtifact: true,
  },
  {
    name: "propose_detection_tuning",
    description:
      "Propose a tuning or suppression for a detection rule (does NOT change rule behavior). Recorded on the rule's tuning.proposals for operator review. Suppressions must carry a reason and expiry.",
    inputSchema: {
      type: "object",
      properties: {
        ruleKey: { type: "string" },
        kind: { type: "string", description: "tune | suppress" },
        rationale: { type: "string" },
        suppressUntil: { type: "string", description: "ISO 8601 expiry (required for kind=suppress)" },
        tuning: { type: "object", description: "proposed threshold/allow-list changes (for kind=tune)" },
      },
      required: ["ruleKey", "kind", "rationale"],
    },
    requiredCapability: null,
    sideEffect: true,
    coworkerArtifact: true,
  },
  {
    name: "propose_response",
    description:
      "Propose a containment/remediation action for a security case (does NOT execute). The governed authority decision (auto-approve / needs-human-approval / refuse) is computed from the action's risk band and the security kernel; the proposal is recorded on the case timeline for approval. Execution rides the proposal-not-action rail and the customer's own runner.",
    inputSchema: {
      type: "object",
      properties: {
        caseKey: { type: "string" },
        actionType: { type: "string", description: "collect_diagnostics | quarantine_host | block_ip | block_domain | revoke_token | disable_account | isolate_host | kill_process | wipe_host" },
        target: { type: "string", description: "the asset/account/indicator the action targets" },
        reversible: { type: "boolean" },
        blastRadius: { type: "string", description: "single-host | account | estate" },
        evidenceConfidence: { type: "number", description: "investigation confidence justifying the action, 0..1" },
        consent: { type: "string", description: "standing | per-action | none — customer's standing approval for this action class" },
        rationale: { type: "string" },
      },
      required: ["caseKey", "actionType", "target", "rationale"],
    },
    requiredCapability: null,
    sideEffect: true,
    coworkerArtifact: true,
  },
];

// ── Handlers ─────────────────────────────────────────────────────────────────

export async function querySecurityEventsHandler(
  params: Record<string, unknown>,
  _userId: string,
  _context?: SiemContext,
): Promise<ToolResult> {
  const sinceMinutes = clampLimit(params["sinceMinutes"], 60, 7 * 24 * 60);
  const since = new Date(Date.now() - sinceMinutes * 60 * 1000);
  const limit = clampLimit(params["limit"], 50, 200);
  const minSeverityId = num(params["minSeverityId"]);

  const where: Record<string, unknown> = { time: { gte: since } };
  const scopeKey = str(params["scopeKey"]);
  if (scopeKey) where["scopeKey"] = scopeKey;
  const customerAccountId = str(params["customerAccountId"]);
  if (customerAccountId) where["customerAccountId"] = customerAccountId;
  const sourceKind = str(params["sourceKind"]);
  if (sourceKind) where["sourceKind"] = sourceKind;
  if (minSeverityId !== undefined) where["severityId"] = { gte: minSeverityId };

  const events = await prisma.securityEvent.findMany({
    where,
    orderBy: { time: "desc" },
    take: limit,
    select: {
      eventKey: true,
      time: true,
      severityId: true,
      ocsfClassUid: true,
      sourceKind: true,
      sourceName: true,
      scopeKey: true,
      customerAccountId: true,
    },
  });

  return {
    success: true,
    message: `Found ${events.length} security event(s) in the last ${sinceMinutes}m.`,
    data: { count: events.length, events },
  };
}

export async function queryDetectionsHandler(
  params: Record<string, unknown>,
  _userId: string,
  _context?: SiemContext,
): Promise<ToolResult> {
  const limit = clampLimit(params["limit"], 50, 200);
  const where: Record<string, unknown> = {};
  const scopeKey = str(params["scopeKey"]);
  if (scopeKey) where["scopeKey"] = scopeKey;
  const customerAccountId = str(params["customerAccountId"]);
  if (customerAccountId) where["customerAccountId"] = customerAccountId;
  const status = str(params["status"]);
  if (status) where["status"] = status;
  const severity = str(params["severity"]);
  if (severity) where["severity"] = severity;

  const detections = await prisma.detection.findMany({
    where,
    orderBy: { lastSeenAt: "desc" },
    take: limit,
    select: {
      detectionKey: true,
      ruleId: true,
      severity: true,
      status: true,
      riskScore: true,
      scopeKey: true,
      customerAccountId: true,
      firstSeenAt: true,
      lastSeenAt: true,
      securityCaseId: true,
    },
  });

  return {
    success: true,
    message: `Found ${detections.length} detection(s).`,
    data: { count: detections.length, detections },
  };
}

export async function getSecurityCaseHandler(
  params: Record<string, unknown>,
  _userId: string,
  _context?: SiemContext,
): Promise<ToolResult> {
  const caseKey = str(params["caseKey"]);
  if (!caseKey) {
    return { success: false, error: "missing_caseKey", message: "caseKey is required." };
  }
  const sc = await prisma.securityCase.findUnique({ where: { caseKey } });
  if (!sc) {
    return { success: false, error: "not_found", message: `No security case ${caseKey}.` };
  }
  const detections = await prisma.detection.findMany({
    where: { securityCaseId: sc.id },
    orderBy: { lastSeenAt: "desc" },
    take: 200,
    select: { detectionKey: true, severity: true, status: true, riskScore: true, lastSeenAt: true },
  });
  return {
    success: true,
    message: `Case ${caseKey} (${sc.status}/${sc.verdict}) — ${detections.length} detection(s).`,
    data: { case: sc, detections },
  };
}

export async function openSecurityCaseHandler(
  params: Record<string, unknown>,
  _userId: string,
  context?: SiemContext,
): Promise<ToolResult> {
  const title = str(params["title"]);
  const scopeKey = str(params["scopeKey"]);
  const severity = str(params["severity"]);
  if (!title || !scopeKey || !severity) {
    return { success: false, error: "missing_fields", message: "title, scopeKey, and severity are required." };
  }
  const detectionKeys = strArray(params["detectionKeys"]);
  const caseKey = `case:manual:${randomUUID()}`;

  const sc = await prisma.securityCase.create({
    data: {
      caseKey,
      scopeKey,
      customerAccountId: str(params["customerAccountId"]) ?? null,
      customerSiteId: str(params["customerSiteId"]) ?? null,
      title,
      severity,
      status: "triaging",
      verdict: "unknown",
      confidence: "low",
      assignedAgentId: context?.agentId ?? null,
      timeline: [
        {
          kind: "opened",
          by: context?.agentId ?? "coworker",
          at: new Date().toISOString(),
          note: `Case opened grouping ${detectionKeys.length} detection(s).`,
        },
      ] as object,
    },
  });

  if (detectionKeys.length) {
    await prisma.detection.updateMany({
      where: { detectionKey: { in: detectionKeys } },
      data: { securityCaseId: sc.id, status: "linked" },
    });
  }

  return {
    success: true,
    entityId: sc.id,
    message: `Opened security case ${caseKey} ("${title}") and linked ${detectionKeys.length} detection(s).`,
    data: { caseKey, id: sc.id, linkedDetections: detectionKeys.length },
  };
}

export async function updateSecurityCaseHandler(
  params: Record<string, unknown>,
  _userId: string,
  context?: SiemContext,
): Promise<ToolResult> {
  const caseKey = str(params["caseKey"]);
  if (!caseKey) {
    return { success: false, error: "missing_caseKey", message: "caseKey is required." };
  }
  const sc = await prisma.securityCase.findUnique({ where: { caseKey } });
  if (!sc) {
    return { success: false, error: "not_found", message: `No security case ${caseKey}.` };
  }

  const data: Record<string, unknown> = {};
  const status = str(params["status"]);
  if (status) {
    data["status"] = status;
    if (status === "resolved") data["resolvedAt"] = new Date();
    if (status === "closed") data["closedAt"] = new Date();
  }
  const verdict = str(params["verdict"]);
  if (verdict) data["verdict"] = verdict;
  const confidence = str(params["confidence"]);
  if (confidence) data["confidence"] = confidence;
  const assignedAgentId = str(params["assignedAgentId"]);
  if (assignedAgentId) data["assignedAgentId"] = assignedAgentId;

  const timelineNote = str(params["timelineNote"]);
  if (timelineNote) {
    const existing = Array.isArray(sc.timeline) ? (sc.timeline as unknown[]) : [];
    existing.push({
      kind: "note",
      by: context?.agentId ?? "coworker",
      at: new Date().toISOString(),
      note: timelineNote,
      evidenceRef: str(params["evidenceRef"]) ?? null,
    });
    data["timeline"] = existing as object;
  }

  if (Object.keys(data).length === 0) {
    return { success: false, error: "nothing_to_update", message: "Provide at least one field to update." };
  }

  const updated = await prisma.securityCase.update({ where: { caseKey }, data });
  return {
    success: true,
    entityId: updated.id,
    message: `Updated case ${caseKey} → status ${updated.status}, verdict ${updated.verdict}.`,
    data: { caseKey, status: updated.status, verdict: updated.verdict, confidence: updated.confidence },
  };
}

export async function proposeDetectionTuningHandler(
  params: Record<string, unknown>,
  _userId: string,
  context?: SiemContext,
): Promise<ToolResult> {
  const ruleKey = str(params["ruleKey"]);
  const kind = str(params["kind"]);
  const rationale = str(params["rationale"]);
  if (!ruleKey || !kind || !rationale) {
    return { success: false, error: "missing_fields", message: "ruleKey, kind, and rationale are required." };
  }
  if (kind !== "tune" && kind !== "suppress") {
    return { success: false, error: "bad_kind", message: "kind must be 'tune' or 'suppress'." };
  }
  const suppressUntil = str(params["suppressUntil"]);
  if (kind === "suppress" && !suppressUntil) {
    return { success: false, error: "missing_expiry", message: "A suppression must carry suppressUntil (expiry)." };
  }

  const rule = await prisma.detectionRule.findUnique({ where: { ruleKey } });
  if (!rule) {
    return { success: false, error: "not_found", message: `No detection rule ${ruleKey}.` };
  }

  // Record the proposal WITHOUT changing rule behavior: the sweep reads specific
  // tuning fields, never tuning.proposals — so this is propose, not act.
  const tuning =
    rule.tuning && typeof rule.tuning === "object" && !Array.isArray(rule.tuning)
      ? (rule.tuning as Record<string, unknown>)
      : {};
  const proposals = Array.isArray(tuning["proposals"]) ? (tuning["proposals"] as unknown[]) : [];
  const proposal = {
    kind,
    rationale,
    suppressUntil: suppressUntil ?? null,
    tuning: (params["tuning"] as object) ?? null,
    by: context?.agentId ?? "coworker",
    at: new Date().toISOString(),
    status: "proposed",
  };
  proposals.push(proposal);

  await prisma.detectionRule.update({
    where: { ruleKey },
    data: { tuning: { ...tuning, proposals } as object },
  });

  return {
    success: true,
    message: `Recorded a ${kind} proposal for rule ${ruleKey} (operator review required — rule behavior unchanged).`,
    data: { ruleKey, proposal },
  };
}

export async function proposeResponseHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: SiemContext,
): Promise<ToolResult> {
  const caseKey = str(params["caseKey"]);
  const actionType = str(params["actionType"]);
  const target = str(params["target"]);
  const rationale = str(params["rationale"]);
  if (!caseKey || !actionType || !target || !rationale) {
    return { success: false, error: "missing_fields", message: "caseKey, actionType, target, and rationale are required." };
  }
  const sc = await prisma.securityCase.findUnique({ where: { caseKey } });
  if (!sc) {
    return { success: false, error: "not_found", message: `No security case ${caseKey}.` };
  }

  // Compute the governed authority decision: the risk band sets the floor and
  // the security kernel can only ratchet it more conservative (P3). The kernel
  // gate fails safe — a degenerate / low-confidence result keeps human approval.
  const input: SecurityResponseInput = {
    actionType,
    target,
    rationale,
    evidenceConfidence: typeof params["evidenceConfidence"] === "number" ? (params["evidenceConfidence"] as number) : 0.5,
    consent: (str(params["consent"]) as SecurityResponseConsent | undefined) ?? "none",
    reversible: typeof params["reversible"] === "boolean" ? (params["reversible"] as boolean) : undefined,
    blastRadius: str(params["blastRadius"]) as SecurityBlastRadius | undefined,
  };
  const verdict = await decideSecurityResponse(input, {
    userId,
    routeContext: context?.routeContext,
  });

  const proposal = {
    kind: "response-proposal",
    actionType,
    target,
    reversible: input.reversible ?? null,
    blastRadius: input.blastRadius ?? null,
    rationale,
    authorityDecision: verdict.decision,
    bandDecision: verdict.bandDecision,
    decisionReason: verdict.reason,
    by: context?.agentId ?? "coworker",
    at: new Date().toISOString(),
    status: "proposed",
  };
  const timeline = Array.isArray(sc.timeline) ? (sc.timeline as unknown[]) : [];
  timeline.push(proposal);

  await prisma.securityCase.update({
    where: { caseKey },
    data: { timeline: timeline as object },
  });

  return {
    success: true,
    entityId: sc.id,
    message: `Proposed ${actionType} on ${target} for case ${caseKey} — authority decision: ${verdict.decision}. Recorded for approval, NOT executed.`,
    data: { caseKey, proposal, authorityDecision: verdict.decision, bandDecision: verdict.bandDecision },
  };
}
