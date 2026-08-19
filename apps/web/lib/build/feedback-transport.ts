/**
 * Feedback Transport — selects HOW a redacted issue payload reaches the
 * upstream project team, decoupling the credential path from the
 * `fileUpstreamFeedback()` action (BI-6D45BA27, spec 2026-06-06 §4.2).
 *
 *   - DirectBridgeTransport: installs that hold a GitHub token (contributor /
 *     admin / dev) use the existing, tested `escalateToUpstreamIssue()` path.
 *   - RelayTransport: consumer installs with NO GitHub token POST the redacted
 *     payload to a configurable intake relay (install-authenticated). The relay
 *     holds the GitHub credential and files the issue server-side. This is also
 *     the reseller seam — the relay URL can point at a reseller's intake.
 *   - NoopTransport: neither relay nor token available → skipped, stays local.
 *
 * Payloads are built by `buildEscalationPayload()` in `issue-bridge.ts`, so the
 * relay and direct paths file byte-identical, equally-redacted issues.
 */

import {
  escalateToUpstreamIssue,
  type NormalizedSource,
  buildEscalationPayload,
} from "./issue-bridge";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RedactedIssuePayload {
  title: string;
  body: string;
  labels: string[];
  /** Stable install pseudonym (dpf-agent-<shortId>) — the relay's contributor handle. */
  pseudonym: string;
  /** Local human-readable reference (PIR-XXXXX) for correlation/audit. */
  localRef: string;
}

export type FeedbackTransportResult =
  | { status: "filed"; issueNumber: number | null; url: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

export interface FeedbackFileContext {
  /** PlatformIssueReport row id (cuid) — the direct bridge loads/persists by this. */
  reportRowId: string;
}

export interface FeedbackTransport {
  readonly kind: "direct" | "relay" | "noop";
  file(
    payload: RedactedIssuePayload,
    ctx: FeedbackFileContext,
  ): Promise<FeedbackTransportResult>;
}

/**
 * Minimal HTTP client surface — injected so the relay path is unit-testable
 * without a live endpoint. Mirrors the subset of `fetch` we rely on.
 */
export type RelayHttpClient = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

const defaultRelayClient: RelayHttpClient = (url, init) =>
  fetch(url, init) as unknown as ReturnType<RelayHttpClient>;

// ─── Pure payload builder ────────────────────────────────────────────────────

/**
 * Builds the redacted relay/issue payload for a loaded report source. Pure —
 * reuses the issue-bridge builders so redaction and formatting are identical
 * to the direct GitHub path.
 */
export function buildRedactedFeedbackPayload(input: {
  source: NormalizedSource;
  pseudonym: string;
}): RedactedIssuePayload {
  const { title, body, labels } = buildEscalationPayload({
    kind: "issue-report",
    pseudonym: input.pseudonym,
    source: input.source,
  });
  return {
    title,
    body,
    labels,
    pseudonym: input.pseudonym,
    localRef: input.source.humanId,
  };
}

// ─── Transports ───────────────────────────────────────────────────────────────

class DirectBridgeTransport implements FeedbackTransport {
  readonly kind = "direct" as const;

  async file(
    _payload: RedactedIssuePayload,
    ctx: FeedbackFileContext,
  ): Promise<FeedbackTransportResult> {
    // The bridge re-loads the source, builds the same payload, posts to GitHub,
    // and persists the upstream link itself (existing tested behavior).
    const result = await escalateToUpstreamIssue({
      kind: "issue-report",
      id: ctx.reportRowId,
    });
    if (result.status === "created") {
      return { status: "filed", issueNumber: result.issueNumber, url: result.url };
    }
    if (result.status === "skipped") {
      return { status: "skipped", reason: result.reason };
    }
    return { status: "failed", error: result.error };
  }
}

class RelayTransport implements FeedbackTransport {
  readonly kind = "relay" as const;

  constructor(
    private readonly relayUrl: string,
    private readonly client: RelayHttpClient = defaultRelayClient,
  ) {}

  async file(payload: RedactedIssuePayload): Promise<FeedbackTransportResult> {
    let response: Awaited<ReturnType<RelayHttpClient>>;
    try {
      response = await this.client(this.relayUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Install-authenticated submission. Phase A carries the stable
          // pseudonym; Phase B hardens this to a signed/HMAC install credential
          // the relay validates before filing.
          "X-DPF-Install-Id": payload.pseudonym,
        },
        body: JSON.stringify({
          title: payload.title,
          body: payload.body,
          labels: payload.labels,
          pseudonym: payload.pseudonym,
          localRef: payload.localRef,
        }),
      });
    } catch (err) {
      return { status: "failed", error: `Relay network error: ${(err as Error).message}` };
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return { status: "failed", error: `Relay returned ${response.status} with unparseable body` };
    }

    if (!response.ok) {
      const msg =
        typeof data === "object" && data !== null && "error" in data
          ? String((data as { error: unknown }).error)
          : `status ${response.status}`;
      return { status: "failed", error: `Relay error: ${msg}` };
    }

    const issueUrl =
      typeof data === "object" && data !== null && "url" in data
        ? String((data as { url: unknown }).url)
        : null;
    if (!issueUrl) {
      return { status: "failed", error: "Relay response missing url" };
    }
    const issueNumber =
      typeof data === "object" && data !== null && typeof (data as { issueNumber?: unknown }).issueNumber === "number"
        ? (data as { issueNumber: number }).issueNumber
        : null;

    return { status: "filed", issueNumber, url: issueUrl };
  }
}

class NoopTransport implements FeedbackTransport {
  readonly kind = "noop" as const;
  constructor(private readonly reason: string) {}
  async file(): Promise<FeedbackTransportResult> {
    return { status: "skipped", reason: this.reason };
  }
}

// ─── Selection ────────────────────────────────────────────────────────────────

export interface TransportSelectionConfig {
  /** PlatformDevConfig.upstreamRelayUrl — when set, prefer the relay. */
  upstreamRelayUrl: string | null;
  /** Whether resolveHiveToken() yielded a token (resolved by the caller, kept async-free here). */
  hasToken: boolean;
}

/**
 * Picks the transport for this install. Pure and synchronous — the caller
 * resolves the token first and passes `hasToken`, and injects a relay client
 * for tests. Relay wins when configured (it is the no-token consumer path and
 * the reseller seam); otherwise the direct bridge runs if a token exists;
 * otherwise a no-op keeps the report local.
 */
export function selectTransport(
  config: TransportSelectionConfig,
  deps: { relayClient?: RelayHttpClient } = {},
): FeedbackTransport {
  if (config.upstreamRelayUrl) {
    return new RelayTransport(config.upstreamRelayUrl, deps.relayClient);
  }
  if (config.hasToken) {
    return new DirectBridgeTransport();
  }
  return new NoopTransport(
    "no upstream relay configured and no GitHub token available — report stays local",
  );
}
