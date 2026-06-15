// Means adapters (EP-BROWSER-DRIVE, spec §6 / §8). M2 (plugin) is the live
// adapter over the profile-aware browser-use sidecar; M1 (deterministic) and M3
// (delegated) are interface-conformant stubs landed for Phase 5.
//
// The sidecar transport is injected so the adapter is testable and decoupled from
// the MCP wiring; at runtime it is bound to the namespaced mcp-browser-use__*
// tool execution path.

import {
  createBrowserSessionBinding,
  setBrowserSessionStatus,
  type BrowserMeans,
} from "./session-binding";
import { recordBrowserToolExecution, type BrowserExecutionMode } from "./audit";
import type {
  BrowserDriver,
  BrowserOpenInput,
  BrowserSessionHandle,
  BrowserActResult,
  BrowserReadResult,
  BrowserScreenshotResult,
  BrowserCloseResult,
  BrowserActOptions,
} from "./driver";

/** Calls one browser-use sidecar tool and returns its JSON result. */
export type SidecarTransport = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

/** Audit attribution shared across a driver's calls. */
export type DriverAuditContext = {
  /** Executing identity (service/coworker principal id). */
  userId: string;
  agentId: string;
  threadId: string;
};

type SessionMeta = {
  attended: boolean;
  delegatingUserId: string;
  routeContext?: string;
};

export class M2PluginDriver implements BrowserDriver {
  readonly means: BrowserMeans = "plugin";
  private readonly meta = new Map<string, SessionMeta>();

  constructor(
    private readonly transport: SidecarTransport,
    private readonly ctx: DriverAuditContext,
  ) {}

  async open(input: BrowserOpenInput): Promise<BrowserSessionHandle> {
    const engine = input.engine ?? "chromium";
    const attended = input.attended ?? input.profileKind === "operator-live";
    const started = Date.now();
    const res = await this.transport("browse_open", {
      url: input.url,
      profile_path: input.profileRef,
      target_domains: input.targetDomains,
      evidence_dir: input.evidenceDir,
    });
    const sessionId =
      typeof res.session_id === "string" && res.session_id ? res.session_id : (input.sessionId ?? "");
    if (!sessionId) {
      throw new Error("browse_open did not return a session_id");
    }

    // The binding is the auditable+resumable record; createBrowserSessionBinding
    // asserts the Verdict-3 / Chromium-only invariants before persisting.
    await createBrowserSessionBinding({
      sessionId,
      means: this.means,
      engine,
      driverRef: sessionId,
      profileRef: input.profileRef ?? "operator-live",
      profileKind: input.profileKind,
      attended,
      delegatingUserId: input.delegatingUserId,
      actingPrincipalId: input.actingPrincipalId ?? null,
      delegationGrantId: input.delegationGrantId ?? null,
      credentialId: input.credentialId ?? null,
      targetDomains: input.targetDomains,
      evidenceDir: input.evidenceDir ?? null,
      meansDecisionJson: input.meansDecisionJson,
    });

    this.meta.set(sessionId, {
      attended,
      delegatingUserId: input.delegatingUserId,
      routeContext: input.routeContext,
    });

    await this.audit(sessionId, "mcp-browser-use__browse_open", { url: input.url, targetDomains: input.targetDomains }, res, !res.error, attended ? "permission" : "immediate", Date.now() - started);
    return { sessionId, means: this.means };
  }

  async read(session: BrowserSessionHandle, query: string): Promise<BrowserReadResult> {
    const started = Date.now();
    const res = await this.transport("browse_extract", { session_id: session.sessionId, query });
    await this.audit(session.sessionId, "mcp-browser-use__browse_extract", { query }, res, !res.error, "immediate", Date.now() - started);
    if (res.error) return { status: "error", detail: String(res.error) };
    return { status: "completed", data: res.data };
  }

  async act(session: BrowserSessionHandle, command: string, options?: BrowserActOptions): Promise<BrowserActResult> {
    const meta = this.meta.get(session.sessionId);
    // executionMode: a human-approved destructive action → "proposal" (+envelope);
    // attended operator-live driving → "permission"; otherwise → "immediate".
    const mode: BrowserExecutionMode = options?.envelopeId
      ? "proposal"
      : meta?.attended
        ? "permission"
        : "immediate";
    const started = Date.now();
    const res = await this.transport("browse_act", { session_id: session.sessionId, task: command });
    const status = res.status === "blocked" ? "blocked" : res.error ? "error" : "completed";
    await this.audit(
      session.sessionId,
      "mcp-browser-use__browse_act",
      { task: command },
      res,
      status === "completed",
      mode,
      Date.now() - started,
      options?.envelopeId ?? null,
    );
    return {
      status,
      detail: typeof res.result === "string" ? res.result : (res.error ? String(res.error) : undefined),
      url: typeof res.url === "string" ? res.url : undefined,
    };
  }

  async screenshot(session: BrowserSessionHandle): Promise<BrowserScreenshotResult> {
    const res = await this.transport("browse_screenshot", { session_id: session.sessionId });
    return { base64: typeof res.screenshot_base64 === "string" ? res.screenshot_base64 : undefined };
  }

  async close(session: BrowserSessionHandle): Promise<BrowserCloseResult> {
    const res = await this.transport("browse_close", { session_id: session.sessionId });
    await setBrowserSessionStatus(session.sessionId, "closed").catch(() => {});
    this.meta.delete(session.sessionId);
    return {
      sessionId: session.sessionId,
      status: "closed",
      actionCount: typeof res.action_count === "number" ? res.action_count : undefined,
    };
  }

  private async audit(
    sessionId: string,
    toolName: string,
    parameters: unknown,
    result: unknown,
    success: boolean,
    executionMode: BrowserExecutionMode,
    durationMs: number,
    envelopeId: string | null = null,
  ): Promise<void> {
    const meta = this.meta.get(sessionId);
    await recordBrowserToolExecution({
      threadId: this.ctx.threadId,
      agentId: this.ctx.agentId,
      userId: this.ctx.userId,
      toolName,
      parameters,
      result,
      success,
      executionMode,
      routeContext: meta?.routeContext ?? null,
      durationMs,
      delegatingUserId: meta?.delegatingUserId ?? null,
      envelopeId,
    }).catch(() => {
      // Audit must not break the drive loop; a failed audit write is logged
      // upstream by the prisma client and surfaced in the session evidence gap.
    });
  }
}

/** Not-yet-implemented adapter that still conforms to BrowserDriver (Phase 5). */
function notImplemented(means: BrowserMeans): never {
  throw new Error(`${means} browser driver is not implemented yet (EP-BROWSER-DRIVE Phase 5)`);
}

export class M1DeterministicDriver implements BrowserDriver {
  readonly means: BrowserMeans = "deterministic";
  async open(): Promise<BrowserSessionHandle> { return notImplemented(this.means); }
  async read(): Promise<BrowserReadResult> { return notImplemented(this.means); }
  async act(): Promise<BrowserActResult> { return notImplemented(this.means); }
  async screenshot(): Promise<BrowserScreenshotResult> { return notImplemented(this.means); }
  async close(): Promise<BrowserCloseResult> { return notImplemented(this.means); }
}

export class M3DelegatedDriver implements BrowserDriver {
  readonly means: BrowserMeans = "delegated";
  async open(): Promise<BrowserSessionHandle> { return notImplemented(this.means); }
  async read(): Promise<BrowserReadResult> { return notImplemented(this.means); }
  async act(): Promise<BrowserActResult> { return notImplemented(this.means); }
  async screenshot(): Promise<BrowserScreenshotResult> { return notImplemented(this.means); }
  async close(): Promise<BrowserCloseResult> { return notImplemented(this.means); }
}
