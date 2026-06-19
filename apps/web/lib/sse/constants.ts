// apps/web/lib/sse/constants.ts
//
// Tiny isomorphic constants shared by the SSE server builder (lib/sse/sse-stream.ts)
// and the browser client (lib/hooks/useResilientEventSource.ts). Kept dependency-free
// so importing it into client code never drags server-only modules into the bundle.

/**
 * Named SSE event used purely for liveness. The server emits it on an interval;
 * the client resets its watchdog on it and never forwards it to consumers.
 * If no heartbeat arrives within the client watchdog window, the client treats
 * the connection as a zombie and force-reconnects. See sse-stream.ts for the
 * full root-cause writeup (BI-864E83B0).
 */
export const SSE_HEARTBEAT_EVENT = "dpf-hb";
