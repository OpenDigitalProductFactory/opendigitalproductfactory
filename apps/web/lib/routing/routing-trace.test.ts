import { describe, expect, it } from "vitest";
import { createRoutingTraceId, isRoutingTraceId } from "./routing-trace";

describe("routing trace ids", () => {
  it("creates distinct W3C-compatible trace ids", () => {
    const first = createRoutingTraceId();
    const second = createRoutingTraceId();

    expect(first).toMatch(/^[a-f0-9]{32}$/);
    expect(second).toMatch(/^[a-f0-9]{32}$/);
    expect(first).not.toBe(second);
    expect(isRoutingTraceId(first)).toBe(true);
  });

  it("rejects malformed and all-zero ids", () => {
    expect(isRoutingTraceId("0".repeat(32))).toBe(false);
    expect(isRoutingTraceId("ABCDEF0123456789ABCDEF0123456789")).toBe(false);
    expect(isRoutingTraceId("short")).toBe(false);
  });
});
