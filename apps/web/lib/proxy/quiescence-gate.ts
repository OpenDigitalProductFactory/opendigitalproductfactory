/**
 * Activity Quiescence Protocol — Proxy-side gate.
 *
 * Runs at Next.js Edge runtime (proxy.ts). Cannot import Prisma directly;
 * fetches state from /api/internal/quiescence-state (Node runtime) and
 * caches the result in-edge-process for 1s.
 *
 * Decision matrix (spec §6.4):
 *
 *   level=normal     → all requests pass; version headers injected
 *   level=draining   → mutation POSTs / new SSE handshakes → 503;
 *                       GETs and page loads pass
 *   level=swapping   → only allow-listed paths (edge + health + the
 *                       state route itself); everything else → 503
 *
 * Allow-listed paths bypass quiescence entirely. They are consumed by non-
 * browser callers that don't care about banners or stale bundles:
 *
 *   /api/health
 *   /api/v1/edge/*          (edge-node heartbeats)
 *   /api/internal/quiescence-state   (we'd recurse otherwise)
 *   /api/mcp/v1             (route enforces read/write tool policy)
 *
 * Fail-open / fail-closed (§12 Q6 decision):
 *
 *   On state-route fetch failure (timeout, network, 5xx):
 *     - GET / read requests: fail OPEN — allow the request.
 *     - Mutation POST / new SSE: preserve last known non-normal state;
 *       if no cached state, fail CLOSED (refuse mutation with 503).
 *
 * Spec: docs/superpowers/specs/2026-05-24-activity-quiescence-protocol-design.md
 *   §6.4 (this gate), §7.2 (version headers).
 * BI-QUIESCE-003.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export type ProxyQuiescenceLevel = "normal" | "draining" | "swapping" | "unknown";

export type ProxyQuiescenceState = {
  level: ProxyQuiescenceLevel;
  runId: string | null;
  enteredAt: string | null;
  version: string;
  bundleHash: string;
};

/**
 * Allow-list — paths that bypass the gate entirely. The state route itself
 * MUST be on this list (otherwise the Proxy recurses fetching its own state).
 */
const ALLOW_LISTED_PREFIXES = [
  "/api/health",
  "/api/v1/edge/",
  "/api/internal/quiescence-state",
  // MCP is POST-only transport even for read-only tools. Let the route inspect
  // the tool name and refuse only mutating calls during quiescence.
  "/api/mcp/v1",
  // The Inngest serve endpoint IS the control plane that DRIVES quiescence —
  // the coordinator function executes via callbacks to this route. Gating it
  // would deadlock the very function that transitions draining→ready-to-swap
  // and flips the level back to normal, wedging the portal in "quiescing"
  // forever. It has its own request-signature auth, so it's safe to bypass.
  "/api/inngest",
];

export function isAllowListed(pathname: string): boolean {
  for (const prefix of ALLOW_LISTED_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Classify the request as "mutation" for gating purposes. Mutations are
 * refused during `draining`:
 *   - HTTP method is POST / PUT / PATCH / DELETE
 *   - Request expects an SSE stream (new SSE handshake)
 *
 * GET pages, GET API queries, HEAD, OPTIONS = read-only.
 */
export function isMutationRequest(req: NextRequest): boolean {
  const method = req.method.toUpperCase();
  if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
    return true;
  }
  // New SSE handshake — clients open these with GET + Accept: text/event-stream.
  // Refused during draining so existing streams drain naturally without being
  // joined by new ones that would just receive system:quiescence and close.
  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("text/event-stream")) {
    return true;
  }
  return false;
}

// ─── State cache — in-edge-process, 1s TTL ────────────────────────────────

const CACHE_TTL_MS = 1_000;
type CacheEntry = { state: ProxyQuiescenceState; cachedAt: number };
// Per-process cache; survives across requests in the same Edge instance.
let stateCache: CacheEntry | null = null;

/**
 * Last known non-normal state for fail-closed mutation policy. We remember
 * the most recent draining/swapping state we observed so that if the state
 * route is unreachable during a mutation, we can preserve that posture
 * rather than fail open.
 */
let lastKnownNonNormal: ProxyQuiescenceState | null = null;

/**
 * Fetch the current state from the internal route, with cache + timeout.
 *
 * `origin` is derived from req.nextUrl — Edge code doesn't have access to a
 * static base URL across deployments. Tests inject `fetchImpl` and `now`.
 */
export async function fetchQuiescenceState(
  origin: string,
  opts?: {
    timeoutMs?: number;
    now?: number;
    fetchImpl?: typeof fetch;
  },
): Promise<ProxyQuiescenceState> {
  const now = opts?.now ?? Date.now();
  const timeoutMs = opts?.timeoutMs ?? 750; // hot path; cap at 750ms
  const f = opts?.fetchImpl ?? fetch;

  if (stateCache && now - stateCache.cachedAt < CACHE_TTL_MS) {
    return stateCache.state;
  }

  const url = `${origin}/api/internal/quiescence-state`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await f(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok && res.status !== 503) {
      // 4xx or other non-503 5xx — unexpected; fall through to error path.
      throw new Error(`state-route returned ${res.status}`);
    }
    const body = (await res.json()) as Partial<ProxyQuiescenceState>;
    const state: ProxyQuiescenceState = {
      level: normalizeLevel(body.level),
      runId: body.runId ?? null,
      enteredAt: body.enteredAt ?? null,
      version: body.version ?? "unknown",
      bundleHash: body.bundleHash ?? "unknown",
    };
    stateCache = { state, cachedAt: now };
    if (state.level !== "normal") lastKnownNonNormal = state;
    return state;
  } catch {
    // Fetch failed / timed out. Don't cache the failure — let next call
    // retry. Return the unknown state so the caller's failure-mode logic
    // applies the §6.4 fail-open/closed policy.
    return {
      level: "unknown",
      runId: null,
      enteredAt: null,
      version: "unknown",
      bundleHash: "unknown",
    };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeLevel(raw: unknown): ProxyQuiescenceLevel {
  if (raw === "draining" || raw === "swapping" || raw === "normal") return raw;
  return "unknown";
}

/**
 * Test-only — reset cache + last-known so consecutive tests are isolated.
 */
export function _resetProxyQuiescenceCache(): void {
  stateCache = null;
  lastKnownNonNormal = null;
}

/**
 * Read the last known non-normal state observed by THIS edge process. Used
 * by the gate to apply preserve-last-known fail-closed for mutations when
 * the state route is unreachable.
 */
export function getLastKnownNonNormal(): ProxyQuiescenceState | null {
  return lastKnownNonNormal;
}

function getAllowListedPassState(): ProxyQuiescenceState {
  return stateCache?.state ?? {
    level: "normal",
    runId: null,
    enteredAt: null,
    version: "unknown",
    bundleHash: "unknown",
  };
}

// ─── Gating decision ──────────────────────────────────────────────────────

/**
 * Result of evaluating the gate against a request. Either `pass` (caller
 * continues processing, attaching headers to the eventual response) or
 * `block` (caller returns the embedded NextResponse immediately).
 */
export type GateDecision =
  | { kind: "pass"; state: ProxyQuiescenceState }
  | { kind: "block"; response: NextResponse; state: ProxyQuiescenceState };

/**
 * Evaluate whether `req` should be blocked given `state`. Pure decision
 * function — no fetch, no side effects.
 *
 * Pass `effectiveStateForUnknown` to invoke the fail-open / fail-closed
 * policy: caller decides what state to substitute when level is "unknown".
 *   - For mutations: preserve getLastKnownNonNormal(); otherwise fail open.
 *   - For reads: pass {level: "normal"} (fail-open)
 */
export function evaluateGate(
  req: NextRequest,
  state: ProxyQuiescenceState,
): GateDecision {
  const pathname = req.nextUrl.pathname;

  if (isAllowListed(pathname)) {
    return { kind: "pass", state };
  }

  if (state.level === "swapping") {
    return {
      kind: "block",
      response: build503(state, /* swapping= */ true),
      state,
    };
  }

  if (state.level === "draining" && isMutationRequest(req)) {
    return {
      kind: "block",
      response: build503(state, /* swapping= */ false),
      state,
    };
  }

  return { kind: "pass", state };
}

/**
 * Construct the 503 Upgrade response. Includes Retry-After + version
 * headers (so the client can detect stale-bundle on retry).
 */
function build503(state: ProxyQuiescenceState, swapping: boolean): NextResponse {
  const headers = new Headers({
    "Retry-After": "30",
    "Cache-Control": "no-store, max-age=0",
    "X-Platform-Version": state.version,
    "X-Bundle-Hash": state.bundleHash,
    "X-Quiescence-Level": state.level,
  });
  if (state.runId) headers.set("X-Quiescence-Run-Id", state.runId);
  headers.set("Connection", "close");
  const body = JSON.stringify({
    error: "portal_quiescing",
    message: swapping
      ? "Platform upgrade in progress — please retry shortly"
      : "Platform upgrade preparing — new actions refused; current work will finish",
    level: state.level,
    runId: state.runId,
    retryAfterSeconds: 30,
  });
  return new NextResponse(body, {
    status: 503,
    headers: { ...Object.fromEntries(headers.entries()), "Content-Type": "application/json" },
  });
}

/**
 * Attach version + level headers to an outgoing pass-through response. The
 * Proxy calls this just before returning so EVERY response carries the
 * stale-bundle signal headers (spec §7.2 defensive layer).
 */
export function attachVersionHeaders(
  response: NextResponse,
  state: ProxyQuiescenceState,
): NextResponse {
  response.headers.set("X-Platform-Version", state.version);
  response.headers.set("X-Bundle-Hash", state.bundleHash);
  // X-Quiescence-Level is useful for SREs / dashboards inspecting traffic
  // mid-drain. Cheap, no PII.
  if (state.level !== "unknown") {
    response.headers.set("X-Quiescence-Level", state.level);
  }
  // During drain/swap the container is about to be recycled. Signal browsers
  // to close their keep-alive sockets now so the connection pool is empty by
  // the time the container stops. Without this, wslrelay (Windows/WSL2) and
  // equivalent relay layers absorb the TCP RST from the dying container and
  // never propagate it to the browser — leaving Chrome's 6-socket pool wedged
  // on dead connections indefinitely (BI-79676285).
  if (state.level === "draining" || state.level === "swapping") {
    response.headers.set("Connection", "close");
  }
  return response;
}

/**
 * Convenience — does the work of (a) fetching state, (b) applying fail
 * policy, (c) evaluating the gate. Caller integrates the result.
 */
export async function checkQuiescenceForRequest(
  req: NextRequest,
  origin: string,
): Promise<GateDecision> {
  if (isAllowListed(req.nextUrl.pathname)) {
    return evaluateGate(req, getAllowListedPassState());
  }

  const state = await fetchQuiescenceState(origin);
  if (state.level === "unknown") {
    // Fail policy: preserve last known non-normal for mutations; fail open
    // when there is no evidence this Edge process has observed a drain.
    if (isMutationRequest(req)) {
      const fallback = getLastKnownNonNormal();
      if (fallback) return evaluateGate(req, fallback);
      const open: ProxyQuiescenceState = { ...state, level: "normal" };
      return evaluateGate(req, open);
    }
    // Read: fail open.
    const open: ProxyQuiescenceState = { ...state, level: "normal" };
    return evaluateGate(req, open);
  }
  return evaluateGate(req, state);
}
