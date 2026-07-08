// Browser-driving orchestrator (EP-BROWSER-DRIVE) — the coworker-callable flow.
//
// Ties the substrate together for one bounded task: pick the means (governed
// WWMD), resolve the identity/profile/credential, open a governed session, run
// the task, and gate any outward irreversible action behind a CoworkerActionEnvelope.
// Reuses every existing piece (Verdict 2): selector, M2 adapter, session binding,
// audit, envelope. M2 is the live driver; the selector's choice is recorded on the
// binding regardless (M1/M3 are not yet executable — see notImplemented in
// means-m2-plugin), so a non-plugin recommendation runs via M2 with the ledger
// preserved.

import {
  readBrowserSessionCredential,
  browserSessionIntegrationId,
} from "./credentials";
import { serviceAccountPrincipalId } from "./identity";
import { selectMeans, type MeansSelectionTask, type MeansSelectionResult } from "./select-means";
import {
  proposeBrowserActionEnvelope,
  isDestructiveBrowserAction,
  type DestructiveBrowserAction,
} from "./envelope";
import { M2PluginDriver, type DriverAuditContext } from "./means-m2-plugin";
import { makeSidecarTransport } from "./sidecar";
import type { BrowserDriver } from "./driver";
import { prisma } from "@dpf/db";
import { getErrorMessage } from "@/lib/shared/get-error-message";

export type DriveBrowserMode = "service-account" | "operator-live";

export type DriveBrowserTaskInput = {
  /** Natural-language task for the browser (the act loop drives multi-step). */
  task: string;
  /** Site identifier (selects the provisioned service-account profile). */
  siteKey: string;
  accountKey?: string;
  /** Navigation allowlist — enforced at the sidecar. */
  targetDomains: string[];
  /** Optional URL to open at. */
  targetUrl?: string;
  /** read-only extraction vs a driving action. */
  kind?: "read" | "act";
  /** Audit attribution + the human the coworker acts for. */
  agentId: string;
  threadId: string;
  userId: string;
  /** service-account (autonomous, default) or operator-live (attended). */
  mode?: DriveBrowserMode;
  /** Set when the task takes an outward irreversible action — gates an envelope. */
  outwardAction?: DestructiveBrowserAction;
  /** What the human approves at the destructive boundary (rendered post/form payload). */
  renderedArtifact?: unknown;
  rationale?: string;
  /** Task-derived means-selection signals. */
  signals?: Partial<MeansSelectionTask>;
  /** Injected for tests; default to the real substrate. */
  deps?: {
    selectMeans?: typeof selectMeans;
    makeDriver?: (ctx: DriverAuditContext) => BrowserDriver;
    readCredential?: typeof readBrowserSessionCredential;
  };
};

export type DriveBrowserTaskResult =
  | { status: "completed"; sessionId: string; means: string; data?: unknown; detail?: string }
  | { status: "awaiting-approval"; sessionId: string; envelopeId: string; means: string }
  | { status: "needs-provisioning"; siteKey: string; accountKey: string }
  | { status: "needs-human"; reason: string }
  | { status: "blocked" | "error"; detail: string };

function fullSignals(s?: Partial<MeansSelectionTask>): MeansSelectionTask {
  return {
    outwardSideEffect: s?.outwardSideEffect ?? 0.2,
    siteVolatility: s?.siteVolatility ?? 0.6,
    recurrence: s?.recurrence ?? 0.3,
    needsOperatorSession: s?.needsOperatorSession ?? 0.3,
    hasRecordedScript: s?.hasRecordedScript ?? false,
  };
}

/**
 * Run one browser-driving task end-to-end. Non-destructive tasks execute and
 * return their result; a task flagged with an `outwardAction` proposes an
 * approval envelope and returns `awaiting-approval` WITHOUT acting — the approved
 * action runs later via executeApprovedBrowserAction.
 */
export async function driveBrowserTask(input: DriveBrowserTaskInput): Promise<DriveBrowserTaskResult> {
  const accountKey = input.accountKey ?? "default";
  const mode: DriveBrowserMode = input.mode ?? "service-account";
  const selectMeansFn = input.deps?.selectMeans ?? selectMeans;
  const readCredentialFn = input.deps?.readCredential ?? readBrowserSessionCredential;
  const ctx: DriverAuditContext = { userId: input.userId, agentId: input.agentId, threadId: input.threadId };
  const makeDriver = input.deps?.makeDriver ?? ((c) => new M2PluginDriver(makeSidecarTransport(), c));

  // 1. Governed means selection (records the ledger regardless of which means runs).
  const signals = fullSignals({
    ...input.signals,
    outwardSideEffect: input.outwardAction ? 0.9 : input.signals?.outwardSideEffect,
    needsOperatorSession: mode === "operator-live" ? 0.9 : input.signals?.needsOperatorSession,
  });
  const selection: MeansSelectionResult = await selectMeansFn(signals, {
    userId: input.userId,
    routeContext: "browser-drive",
  });
  if (selection.status === "needs-human") {
    return { status: "needs-human", reason: selection.reason };
  }

  // 2. Resolve identity / profile / credential.
  let profileRef: string | undefined;
  let actingPrincipalId: string | null = null;
  let credentialId: string | null = null;
  const attended = mode === "operator-live";
  if (mode === "service-account") {
    const principalId = serviceAccountPrincipalId(input.siteKey, accountKey);
    credentialId = browserSessionIntegrationId(principalId, input.siteKey);
    const cred = await readCredentialFn(credentialId);
    if (!cred) {
      return { status: "needs-provisioning", siteKey: input.siteKey, accountKey };
    }
    actingPrincipalId = principalId;
    profileRef = `/profiles/${principalId}/${input.siteKey}/`;
  }

  // 3. Open a governed session.
  const driver = makeDriver(ctx);
  let handle;
  try {
    handle = await driver.open({
      url: input.targetUrl,
      profileKind: mode === "operator-live" ? "operator-live" : "service-account",
      profileRef,
      attended,
      targetDomains: input.targetDomains,
      delegatingUserId: input.userId,
      actingPrincipalId,
      credentialId,
      meansDecisionJson: selection.ledger,
      agentId: input.agentId,
      threadId: input.threadId,
      routeContext: "browser-drive",
    });
  } catch (err) {
    return { status: "error", detail: getErrorMessage(err) };
  }

  try {
    // 4a. Destructive boundary: propose an envelope, do NOT act.
    if (input.outwardAction && isDestructiveBrowserAction(input.outwardAction)) {
      const envelope = await proposeBrowserActionEnvelope({
        coworkerAgentId: input.agentId,
        delegatingUserId: input.userId,
        threadId: input.threadId,
        action: input.outwardAction,
        renderedArtifact: input.renderedArtifact ?? { task: input.task },
        targetUrl: input.targetUrl ?? input.targetDomains[0] ?? "",
        rationale: input.rationale ?? `Browser ${input.outwardAction} on ${input.siteKey}`,
      });
      return { status: "awaiting-approval", sessionId: handle.sessionId, envelopeId: envelope.id, means: selection.means };
    }

    // 4b. Non-destructive: run the task.
    if (input.kind === "read") {
      const res = await driver.read(handle, input.task);
      return res.status === "completed"
        ? { status: "completed", sessionId: handle.sessionId, means: selection.means, data: res.data }
        : { status: "error", detail: res.detail ?? "read failed" };
    }
    const res = await driver.act(handle, input.task);
    if (res.status === "completed") {
      return { status: "completed", sessionId: handle.sessionId, means: selection.means, detail: res.detail };
    }
    return { status: res.status, detail: res.detail ?? `act ${res.status}` };
  } finally {
    await driver.close(handle).catch(() => {});
  }
}

/**
 * Execute a destructive browser action after its CoworkerActionEnvelope was
 * approved. Refuses unless the envelope exists and is approved — the final
 * irreversible act never runs on an unapproved or already-resolved envelope.
 */
export async function executeApprovedBrowserAction(input: {
  envelopeId: string;
  /** The exact action command, e.g. "click the Publish button". */
  command: string;
  siteKey: string;
  accountKey?: string;
  targetDomains: string[];
  targetUrl?: string;
  agentId: string;
  threadId: string;
  userId: string;
  mode?: DriveBrowserMode;
  deps?: { makeDriver?: (ctx: DriverAuditContext) => BrowserDriver };
}): Promise<DriveBrowserTaskResult> {
  const envelope = await prisma.coworkerActionEnvelope.findUnique({ where: { id: input.envelopeId } });
  if (!envelope) return { status: "error", detail: "envelope not found" };
  if (envelope.status !== "approved") {
    return { status: "blocked", detail: `envelope is ${envelope.status}, not approved — refusing the destructive action` };
  }

  const accountKey = input.accountKey ?? "default";
  const mode: DriveBrowserMode = input.mode ?? "service-account";
  const ctx: DriverAuditContext = { userId: input.userId, agentId: input.agentId, threadId: input.threadId };
  const makeDriver = input.deps?.makeDriver ?? ((c) => new M2PluginDriver(makeSidecarTransport(), c));

  let profileRef: string | undefined;
  let actingPrincipalId: string | null = null;
  let credentialId: string | null = null;
  if (mode === "service-account") {
    const principalId = serviceAccountPrincipalId(input.siteKey, accountKey);
    actingPrincipalId = principalId;
    credentialId = browserSessionIntegrationId(principalId, input.siteKey);
    profileRef = `/profiles/${principalId}/${input.siteKey}/`;
  }

  const driver = makeDriver(ctx);
  const handle = await driver.open({
    url: input.targetUrl,
    profileKind: mode === "operator-live" ? "operator-live" : "service-account",
    profileRef,
    attended: mode === "operator-live",
    targetDomains: input.targetDomains,
    delegatingUserId: input.userId,
    actingPrincipalId,
    credentialId,
    agentId: input.agentId,
    threadId: input.threadId,
    routeContext: "browser-drive",
  });
  try {
    const res = await driver.act(handle, input.command, { envelopeId: input.envelopeId });
    return res.status === "completed"
      ? { status: "completed", sessionId: handle.sessionId, means: "plugin", detail: res.detail }
      : { status: res.status, detail: res.detail ?? `act ${res.status}` };
  } finally {
    await driver.close(handle).catch(() => {});
  }
}
