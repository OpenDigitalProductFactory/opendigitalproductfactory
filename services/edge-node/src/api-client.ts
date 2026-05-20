// Typed HTTP client for the Authority's /api/v1/edge/* endpoints.
//
// Uses Node 22+'s built-in fetch (via undici). No third-party HTTP
// client; the surface is small enough to inline.

import { request } from "undici";

export type EnrollRequest = {
  displayName: string;
  platform: "darwin" | "win32" | "linux";
  installMode: "native" | "container-host" | "container-vm";
  version: string;
  advertisedCapabilities: string[];
  hostFingerprint?: string;
  metadata?: Record<string, unknown>;
};

export type EnrollResponse = {
  ok: true;
  nodeId: string;
  nodeToken: string;
  trustState: "pending" | "trusted";
  heartbeatIntervalSec: number;
  sweepIntervalSec: number;
  /** Cadence for the metrics collection loop. Defaults to 10 s if absent. */
  metricsIntervalSec?: number;
  acceptedCapabilities: string[];
};

export type HeartbeatRequest = {
  capabilityReports?: Array<{
    capability: string;
    status: "healthy" | "degraded" | "failing" | "unknown";
    evidence?: Record<string, unknown>;
  }>;
};

export type HeartbeatResponse = {
  ok: true;
  heartbeatIntervalSec: number;
  sweepIntervalSec: number;
  /** Cadence for the metrics collection loop. Defaults to 10 s if absent. */
  metricsIntervalSec?: number;
  acceptedCapabilities: string[];
  trustState: "pending" | "trusted" | "quarantined" | "revoked";
};

export class AuthorityHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorCode: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "AuthorityHttpError";
  }
}

export type ApiClientOptions = {
  /** Authority Core base URL, e.g. "http://host.docker.internal:3000" */
  authorityUrl: string;
  /** Per-call timeout in ms. */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;

export class AuthorityApiClient {
  private readonly base: string;
  private readonly timeoutMs: number;

  constructor(opts: ApiClientOptions) {
    this.base = opts.authorityUrl.replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * POST /api/v1/edge/enroll using the bootstrap token.
   * The bootstrap token is consumed on success and never sent again.
   */
  async enroll(
    bootstrapToken: string,
    body: EnrollRequest,
  ): Promise<EnrollResponse> {
    return this.post<EnrollResponse>(
      "/api/v1/edge/enroll",
      bootstrapToken,
      body,
    );
  }

  /** POST /api/v1/edge/heartbeat using the node token. */
  async heartbeat(
    nodeToken: string,
    body: HeartbeatRequest = {},
  ): Promise<HeartbeatResponse> {
    return this.post<HeartbeatResponse>(
      "/api/v1/edge/heartbeat",
      nodeToken,
      body,
    );
  }

  /**
   * POST /api/v1/edge/discovery-runs using the node token.
   * Returns the parsed JSON; A5 wires the actual sweep loop in.
   */
  async submitDiscoveryRun(
    nodeToken: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.post<Record<string, unknown>>(
      "/api/v1/edge/discovery-runs",
      nodeToken,
      body,
    );
  }

  /**
   * POST /api/v1/edge/metrics using the node token.
   * Sends network interface metrics and LLDP peer discoveries.
   */
  async postMetrics(
    nodeToken: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.post<Record<string, unknown>>(
      "/api/v1/edge/metrics",
      nodeToken,
      body,
    );
  }

  private async post<T>(
    path: string,
    token: string,
    body: unknown,
  ): Promise<T> {
    const url = `${this.base}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await request(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.body.text();
      let parsed: unknown = null;
      if (text.length > 0) {
        try {
          parsed = JSON.parse(text);
        } catch {
          // Non-JSON body; fall through to the error path below if
          // status is non-2xx.
        }
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        const errorCode =
          parsed && typeof parsed === "object" && "error" in parsed
            ? String((parsed as Record<string, unknown>).error)
            : undefined;
        const message =
          parsed && typeof parsed === "object" && "message" in parsed
            ? String((parsed as Record<string, unknown>).message)
            : `Authority returned ${response.statusCode} for ${path}`;
        throw new AuthorityHttpError(response.statusCode, errorCode, message);
      }

      return parsed as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
