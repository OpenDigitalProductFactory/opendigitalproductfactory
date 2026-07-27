import { randomBytes } from "node:crypto";

const TRACE_ID_PATTERN = /^[a-f0-9]{32}$/;

/** Create a W3C Trace Context-compatible, non-zero 16-byte trace identifier. */
export function createRoutingTraceId(): string {
  let traceId = randomBytes(16).toString("hex");
  while (/^0+$/.test(traceId)) {
    traceId = randomBytes(16).toString("hex");
  }
  return traceId;
}

export function isRoutingTraceId(value: unknown): value is string {
  return typeof value === "string" && TRACE_ID_PATTERN.test(value) && !/^0+$/.test(value);
}
