import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  planMcpReadinessProbe,
  interpretMcpReadinessResponse,
  interpretScopeCoverageProbe,
  SCOPE_COVERAGE_PROBE,
} from "../mcp-readiness-probe";

const FIXTURES = join(__dirname, "fixtures");
const toolsListBody = JSON.parse(
  readFileSync(join(FIXTURES, "mcp-tools-list-response.json"), "utf8"),
);
const insufficientScopeBody = JSON.parse(
  readFileSync(join(FIXTURES, "mcp-insufficient-scope-response.json"), "utf8"),
);

const OBSERVED = "2026-05-27T02:00:00.000Z";

describe("planMcpReadinessProbe", () => {
  it("returns the probe plan when a token is configured", () => {
    const plan = planMcpReadinessProbe("http://127.0.0.1:3000/api/mcp/v1", true);
    expect("skipReason" in plan).toBe(false);
    if (!("skipReason" in plan)) {
      expect(plan.endpoint).toBe("http://127.0.0.1:3000/api/mcp/v1");
      expect(plan.method).toBe("tools/list");
      expect(plan.expectsResponseShape).toBe("non-empty-tools-array");
      expect(plan.redactBearer).toBe(true);
    }
  });

  it("returns skipReason when no token is present", () => {
    const plan = planMcpReadinessProbe("http://127.0.0.1:3000/api/mcp/v1", false);
    expect(plan).toEqual({ skipReason: "no_token" });
  });

  it("never embeds bearer-shaped substrings in the plan output", () => {
    const plan = planMcpReadinessProbe("http://127.0.0.1:3000/api/mcp/v1", true);
    const serialized = JSON.stringify(plan);
    expect(serialized).not.toMatch(/Bearer\s+\w/);
    expect(serialized).not.toMatch(/dpfmcp_/);
  });
});

describe("interpretMcpReadinessResponse", () => {
  it("returns ok=true with toolCount for a valid tools/list response", () => {
    const result = interpretMcpReadinessResponse(200, toolsListBody, OBSERVED);
    expect(result).toEqual({ ok: true, toolCount: 5, observedAt: OBSERVED });
  });

  it("returns scope_insufficient when 401 body indicates insufficient_token_scope", () => {
    const result = interpretMcpReadinessResponse(401, insufficientScopeBody, OBSERVED);
    expect(result).toEqual({ ok: false, reason: "scope_insufficient", httpStatus: 401 });
  });

  it("returns no_token for a plain 401", () => {
    const result = interpretMcpReadinessResponse(401, { error: "unauthorized" }, OBSERVED);
    expect(result).toEqual({ ok: false, reason: "no_token", httpStatus: 401 });
  });

  it("returns endpoint_unreachable for 5xx", () => {
    const result = interpretMcpReadinessResponse(503, {}, OBSERVED);
    expect(result).toEqual({ ok: false, reason: "endpoint_unreachable", httpStatus: 503 });
  });

  it("returns endpoint_unreachable for status=0 (no response)", () => {
    const result = interpretMcpReadinessResponse(0, null, OBSERVED);
    expect(result).toEqual({ ok: false, reason: "endpoint_unreachable", httpStatus: null });
  });

  it("returns unexpected_shape for 200 with no tools array", () => {
    const result = interpretMcpReadinessResponse(200, { result: {} }, OBSERVED);
    expect(result).toEqual({ ok: false, reason: "unexpected_shape", httpStatus: 200 });
  });

  it("structuredContent.error path also flags insufficient scope", () => {
    const body = { structuredContent: { error: "insufficient_token_scope", requiredScope: "write" } };
    const result = interpretMcpReadinessResponse(403, body, OBSERVED);
    expect(result).toEqual({ ok: false, reason: "scope_insufficient", httpStatus: 403 });
  });
});

describe("interpretScopeCoverageProbe (BI-A3DE9A31)", () => {
  const scopeFailureBody = {
    jsonrpc: "2.0",
    id: 1,
    result: {
      isError: true,
      content: [
        {
          type: "text",
          text: `Token lacks the required scope for ${SCOPE_COVERAGE_PROBE.tool}. Required: one of ${SCOPE_COVERAGE_PROBE.requiredScope}; token has: backlog_read, backlog_write.`,
        },
      ],
    },
  };
  const successBody = {
    jsonrpc: "2.0",
    id: 1,
    result: {
      isError: false,
      content: [{ type: "text", text: JSON.stringify({ success: true, data: { coworker: "x" } }) }],
    },
  };

  it("flags an under-provisioned token (explicit registry_read scope failure)", () => {
    expect(interpretScopeCoverageProbe(200, scopeFailureBody)).toEqual({
      sufficient: false,
      missingScope: "registry_read",
    });
  });

  it("treats a successful registry-gated call as sufficient", () => {
    expect(interpretScopeCoverageProbe(200, successBody)).toEqual({ sufficient: true });
  });

  it("returns null (never re-mint) when the endpoint is unreachable", () => {
    expect(interpretScopeCoverageProbe(0, null)).toEqual({ sufficient: null, reason: "unreachable" });
    expect(interpretScopeCoverageProbe(503, null)).toEqual({ sufficient: null, reason: "unreachable" });
  });

  it("returns null (inconclusive) for a non-scope error — does not assume under-provisioned", () => {
    const otherError = {
      result: { isError: true, content: [{ type: "text", text: "Coworker profile not found." }] },
    };
    expect(interpretScopeCoverageProbe(200, otherError)).toEqual({ sufficient: null, reason: "inconclusive" });
  });

  it("returns null for an unrecognized body shape", () => {
    expect(interpretScopeCoverageProbe(200, {})).toEqual({ sufficient: null, reason: "inconclusive" });
  });
});
