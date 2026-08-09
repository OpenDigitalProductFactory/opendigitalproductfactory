import {
  buildMcpTelemetryRecord,
  countSuspendedMcpTasks,
  recordMcpProtocolTelemetry,
} from "./protocol-telemetry";

let activeMcpRequestCount = 0;

/** Observe bounded compatibility/resource dimensions around the canonical
 * handler. Clones are transient; payloads and identities are never persisted. */
export async function withMcpRouteTelemetry(
  request: Request,
  handler: (request: Request) => Promise<Response>,
): Promise<Response> {
  const startedAt = performance.now();
  const telemetryRequest = request.clone();
  activeMcpRequestCount += 1;

  try {
    const response = await handler(request);
    const [body, responseBody, suspendedTaskCount] = await Promise.all([
      telemetryRequest.json().catch(() => null),
      response.clone().json().catch(() => null),
      countSuspendedMcpTasks(),
    ]);
    await recordMcpProtocolTelemetry(buildMcpTelemetryRecord({
      headers: telemetryRequest.headers,
      body: body && typeof body === "object" && !Array.isArray(body)
        ? body as Record<string, unknown>
        : null,
      responseBody,
      httpStatus: response.status,
      latencyMs: performance.now() - startedAt,
      activeRequestCount: activeMcpRequestCount,
      suspendedTaskCount,
      processRssBytes: typeof process.memoryUsage === "function"
        ? BigInt(process.memoryUsage().rss)
        : null,
    }));
    return response;
  } finally {
    activeMcpRequestCount = Math.max(0, activeMcpRequestCount - 1);
  }
}
