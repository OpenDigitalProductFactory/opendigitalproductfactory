import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { McpCompatibilityReadModel } from "@/lib/mcp/compatibility-read-model";
import { McpCompatibilityPanel } from "./McpCompatibilityPanel";

function model(overrides: Partial<McpCompatibilityReadModel> = {}): McpCompatibilityReadModel {
  return {
    generatedAt: "2026-08-08T18:00:00.000Z",
    observationDaysRequired: 30,
    summary: {
      totalRequests: 42,
      modernRequests: 40,
      legacyRequests: 2,
      compatibilityFailures: 2,
      modernSharePercent: 95.2,
    },
    clients: [{
      key: "codex",
      clientKind: "codex",
      surface: "External MCP client",
      owner: "Agent toolchain bootstrap",
      currentVersion: "1.2.0",
      currentProtocolVersion: "2026-07-28",
      currentProtocolEra: "modern",
      conformanceStatus: "conforming",
      blocker: null,
      tasksExtensionObserved: true,
      requestCount: 40,
      compatibilityFailures: 0,
      lastSeenAt: "2026-08-08T17:30:00.000Z",
    }],
    resources: {
      peakActiveRequests: 3,
      peakSuspendedTasks: 12,
      peakProcessRssMiB: 512,
    },
    retirement: {
      ready: false,
      blockers: ["No legacy protocol traffic in the window", "Explicit operator retirement approval recorded"],
      criteria: [{
        key: "operator-approval",
        label: "Explicit operator retirement approval recorded",
        satisfied: false,
        evidence: "Operator approval is missing",
      }],
    },
    ...overrides,
  };
}

describe("McpCompatibilityPanel", () => {
  it("shows compatibility, resource, privacy, and deny-by-default retirement status", () => {
    const html = renderToStaticMarkup(<McpCompatibilityPanel model={model()} />);

    expect(html).toContain("MCP compatibility");
    expect(html).toContain("Legacy retirement blocked");
    expect(html).toContain("95.2%");
    expect(html).toContain("12");
    expect(html).toContain("512 MiB");
    expect(html).toContain("Client compatibility matrix");
    expect(html).toContain("codex");
    expect(html).toContain("Payloads, credentials, task IDs, GAIDs, and internal agent topology are excluded");
  });

  it("uses an honest no-observations state", () => {
    const html = renderToStaticMarkup(<McpCompatibilityPanel model={model({
      summary: {
        totalRequests: 0,
        modernRequests: 0,
        legacyRequests: 0,
        compatibilityFailures: 0,
        modernSharePercent: 0,
      },
      clients: [],
    })} />);

    expect(html).toContain("No MCP compatibility observations yet");
    expect(html).toContain("Retirement remains blocked until known clients have exercised this install");
  });
});
