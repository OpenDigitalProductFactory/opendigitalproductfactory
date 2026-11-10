// Typed HTTP client for the Authority's /api/v1/edge/* endpoints.
//
// Uses Node 22+'s built-in fetch (via undici). No third-party HTTP
// client; the surface is small enough to inline.

import { request } from "undici";

import type { FederationCandidateSnapshot } from "@dpf/validators";

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

/**
 * Adapter row shape returned by GET /api/v1/edge/adapters. Mirrors the
 * authority's EdgeAdapter schema (apps/web/lib/edge-node/wire-contract.ts).
 * The apiKey field is decrypted server-side and MUST be treated as
 * sensitive by the caller — don't log it, don't write it to disk.
 */
export type EdgeAdapterRow = {
  id: string;
  connectionKey: string;
  name: string;
  collectorType: "unifi";
  endpointUrl: string;
  apiKey: string;
  configuration: {
    site: string;
    discoverClients: boolean;
    tlsInsecure: boolean;
  };
};

export type AdaptersFetchResponse = {
  ok: true;
  adapters: EdgeAdapterRow[];
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

// Default per-call timeout. Bumped from 30 s → 60 s after a real Mac
// install hit a 30 s portal warm-up window during first-run enrollment
// (portal accepted + committed the EdgeNode row but the response arrived
// after the client had already aborted, leaving a half-enrolled record
// the client couldn't recover from). The portal's normal p99 enrollment
// latency is < 300 ms; 60 s only matters when the portal is starting up
// or under heavy compose-orchestration load. Override via
// DPF_EDGE_HTTP_TIMEOUT_MS.
const DEFAULT_TIMEOUT_MS = 60_000;

export class AuthorityApiClient {
  private readonly base: string;
  private readonly timeoutMs: number;

  constructor(opts: ApiClientOptions) {
    this.base = opts.authorityUrl.replace(/\/+$/, "");
    // Env var > explicit opt > default. Env-var form lets operators
    // tune for slow links / overloaded portals without code changes.
    const envTimeout = Number.parseInt(
      process.env.DPF_EDGE_HTTP_TIMEOUT_MS ?? "",
      10,
    );
    this.timeoutMs = Number.isFinite(envTimeout) && envTimeout > 0
      ? envTimeout
      : opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
   * POST /api/v1/edge/federation-candidates — report the nearby DPF installs
   * this node found on its segment.
   *
   * The body is a `FederationCandidateSnapshot`; the scan loop validates against
   * that schema before calling, and the Authority parses with the same one. A
   * candidate is an untrusted setup suggestion — pairing is decided at the
   * Authority against the pinned organization root, never here.
   */
  async submitFederationCandidates(
    nodeToken: string,
    body: FederationCandidateSnapshot,
  ): Promise<Record<string, unknown>> {
    return this.post<Record<string, unknown>>(
      "/api/v1/edge/federation-candidates",
      nodeToken,
      body,
    );
  }

  /**
   * POST /api/v1/edge/metrics — send a MetricsEnvelope to the portal.
   * The envelope shape is defined in @dpf/validators MetricsEnvelope.
   */
  async postMetrics(
    nodeToken: string,
    body: object,
  ): Promise<Record<string, unknown>> {
    return this.post<Record<string, unknown>>(
      "/api/v1/edge/metrics",
      nodeToken,
      body,
    );
  }

  /**
   * GET /api/v1/edge/adapters — fetch the active DiscoveryConnection rows
   * the Authority wants this node to run, with apiKey decrypted server-side.
   *
   * Returns shape (validated minimally here; the wire-contract test asserts
   * the full Zod schema match):
   *   { ok: true, adapters: [{ id, connectionKey, name, collectorType,
   *     endpointUrl, apiKey, configuration: {site, discoverClients, tlsInsecure} }] }
   *
   * Replaces the legacy bind-mounted /etc/dpf-edge/adapters.json — see
   * BI-35de9ce8 (consolidation BI) for the rationale.
   */
  async fetchAdapters(nodeToken: string): Promise<AdaptersFetchResponse> {
    return this.get<AdaptersFetchResponse>("/api/v1/edge/adapters", nodeToken);
  }

  private async get<T>(path: string, token: string): Promise<T> {
    const url = `${this.base}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await request(url, {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
        },
        signal: controller.signal,
      });
      const text = await response.body.text();
      let parsed: unknown = null;
      if (text.length > 0) {
        try { parsed = JSON.parse(text); } catch { /* fall through */ }
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
