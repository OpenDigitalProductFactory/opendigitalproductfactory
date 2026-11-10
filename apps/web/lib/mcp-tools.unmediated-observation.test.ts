// GPP Phase 2, PR-C — an O/A/I tool reached by a direct call that bypasses the
// reference monitor records one `unmediated` observation; a monitor call
// (`governedSource` set) and a routine read record none. The call's result is
// never changed.
// Plan: docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md (PR-C).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handler = vi.fn(async () => ({ success: true, message: "handled" }));

vi.mock("@/lib/mcp/pack-registry", async (importOriginal) => {
  const actual = (await importOriginal()) as { TOOL_PACK_REGISTRY: { getHandler: (name: string) => unknown } };
  return {
    ...actual,
    TOOL_PACK_REGISTRY: new Proxy(actual.TOOL_PACK_REGISTRY, {
      get(target, prop, receiver) {
        if (prop === "getHandler") return () => handler;
        return Reflect.get(target, prop, receiver);
      },
    }),
  };
});
vi.mock("@/lib/kernel/load-enforceable-principles", () => ({ loadEnforceablePrinciples: async () => [] }));
vi.mock("@/lib/operate/metrics", () => ({ kernelGateDecisionsTotal: { inc: () => undefined } }));

import { setGppPermitStoreOverrideForTests } from "./gpp/permit-store";
import type { PermitObservationCreate } from "./gpp/permit-store";
import { executeTool } from "./mcp-tools";

let observations: PermitObservationCreate[];
const flush = () => new Promise((resolve) => setTimeout(resolve, 50));

beforeEach(() => {
  observations = [];
  handler.mockClear();
  setGppPermitStoreOverrideForTests({
    createPermit: async () => { throw new Error("not used"); },
    findPermitByPermitId: async () => null,
    consumePermit: async () => true,
    createObservation: async (data) => { observations.push(data); },
    findLineage: async () => ({ found: false }),
  });
});

afterEach(() => setGppPermitStoreOverrideForTests(null));

describe("executeTool unmediated observation", () => {
  it("records one unmediated observation for a direct O/A/I call", async () => {
    const result = await executeTool("create_portal_pr", { title: "t" }, "user-1", { routeContext: "/build", agentId: "AGT-1" });

    expect(result).toEqual({ success: true, message: "handled" });
    await vi.waitFor(() => expect(observations).toHaveLength(1));
    expect(observations[0]).toMatchObject({
      toolName: "create_portal_pr",
      verdict: "unmediated",
      path: "direct",
      permitRowId: null,
      bindingId: null,
      toolExecutionId: null,
      callerSite: "route:/build agent:AGT-1",
    });
    expect(JSON.stringify(observations[0])).not.toContain("\"title\"");
  });

  it("records none when the monitor made the call (governedSource set)", async () => {
    await executeTool("create_portal_pr", { title: "t" }, "user-1", { governedSource: "jsonrpc" });
    await flush();
    expect(handler).toHaveBeenCalledOnce();
    expect(observations).toEqual([]);
  });

  it.each(["query_backlog", "create_backlog_item"])("records none for the R/W tool %s", async (toolName) => {
    await executeTool(toolName, {}, "user-1");
    await flush();
    expect(observations).toEqual([]);
  });

  it("a failing observation sink never changes the result", async () => {
    setGppPermitStoreOverrideForTests({
      createPermit: async () => { throw new Error("x"); },
      findPermitByPermitId: async () => { throw new Error("x"); },
      consumePermit: async () => { throw new Error("x"); },
      createObservation: async () => { throw new Error("db down"); },
      findLineage: async () => { throw new Error("x"); },
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await executeTool("create_portal_pr", {}, "user-1");
    await flush();
    expect(result).toEqual({ success: true, message: "handled" });
    errors.mockRestore();
  });
});
