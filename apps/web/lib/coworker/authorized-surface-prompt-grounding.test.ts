import type { SemanticSurfaceGraph, SurfacePrincipalContext } from "@dpf/types";
import { describe, expect, it, vi } from "vitest";

import {
  groundPromptWithAuthorizedSurface,
  isAuthorizedSurfaceGuidanceRequest,
} from "./authorized-surface-prompt-grounding";

const graph: SemanticSurfaceGraph = {
  contractVersion: "1.0",
  surfaceId: "platform.estate-discovery",
  revision: "rev-1",
  generatedAt: "2026-08-12T12:00:00.000Z",
  summary: {
    label: "Estate Discovery",
    purpose: "Resolve discovery evidence and configure network collectors.",
    status: "attention-needed",
    highlights: [
      "SNMP is the network-discovery method on this surface; SMTP configures outbound email elsewhere.",
      "For SNMP choose SNMP (Generic), enter Target IP or Hostname and the write-only Community String, then use Save & Test.",
    ],
  },
  nodes: [
    {
      nodeId: "connection.method",
      kind: "field",
      accessibleName: "Discovery Method",
      value: "snmp",
      state: { labels: ["Ubiquiti UniFi", "SNMP (Generic)"] },
      help: "SNMP discovers network devices. SMTP sends outbound email.",
      provenance: { source: "estate-discovery.view-model", trust: "trusted-system", sensitivity: "internal" },
    },
    {
      nodeId: "connection.community",
      kind: "field",
      accessibleName: "Community String",
      help: "Write-only and never returned.",
      provenance: { source: "estate-discovery.view-model", trust: "trusted-system", sensitivity: "secret" },
    },
  ],
  actions: [{
    actionId: "connection.save-and-test",
    label: "Save & Test",
    actionClass: "domain",
    risk: "medium",
    confirmation: "policy",
  }],
  continuations: [],
  provenance: { source: "estate-discovery.view-model", trust: "trusted-system", sensitivity: "internal" },
};

describe("groundPromptWithAuthorizedSurface", () => {
  it("distinguishes read-only setup guidance from a request to operate the surface", () => {
    expect(isAuthorizedSurfaceGuidanceRequest("how should I setup this smtp discovery?")).toBe(true);
    expect(isAuthorizedSurfaceGuidanceRequest("what does Save & Test do here?")).toBe(true);
    expect(isAuthorizedSurfaceGuidanceRequest("enter the SNMP target and click Save & Test")).toBe(false);
    expect(isAuthorizedSurfaceGuidanceRequest("configure and test this connection for me")).toBe(false);
  });

  it("prehydrates current authorized UX truth without exposing secret values", async () => {
    const context: SurfacePrincipalContext = {
      delegatingUserId: "user-1",
      actingAgentId: "estate-specialist",
      mode: "browser",
      locale: "en-US",
      timezone: "America/Chicago",
      route: "/platform/tools/discovery",
    };
    const open = vi.fn(async () => ({
      ok: true as const,
      session: {
        sessionId: "surface-session-1",
        surfaceId: graph.surfaceId,
        delegatingUserId: context.delegatingUserId,
        actingAgentId: context.actingAgentId,
        mode: context.mode,
        authorityDigest: "authority-1",
        revision: graph.revision,
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      },
      summary: graph.summary,
      actions: graph.actions,
    }));
    const snapshot = vi.fn(async () => ({ ok: true as const, graph }));

    const result = await groundPromptWithAuthorizedSurface({
      systemPrompt: "BASE PROMPT",
      context,
      authorizedToolNames: new Set(["surface_open", "surface_snapshot", "surface_act"]),
    }, { open, snapshot });

    expect(result.grounded).toBe(true);
    expect(result.sessionId).toBe("surface-session-1");
    expect(result.systemPrompt).toContain("CURRENT AUTHORIZED SURFACE — TRUSTED UX STATE");
    expect(result.systemPrompt).toContain("SNMP is the network-discovery method");
    expect(result.systemPrompt).toContain("Community String");
    expect(result.systemPrompt).toContain("Save & Test");
    expect(result.systemPrompt).toContain("surface-session-1");
    expect(result.systemPrompt).not.toContain("authority-1");
    expect(open).toHaveBeenCalledWith({
      context: expect.objectContaining({ route: "/platform/tools/discovery" }),
      selector: { route: "/platform/tools/discovery" },
    });
  });

  it("fails open when no authorized surface matches the route", async () => {
    const result = await groundPromptWithAuthorizedSurface({
      systemPrompt: "BASE PROMPT",
      context: {
        delegatingUserId: "user-1",
        actingAgentId: "estate-specialist",
        mode: "browser",
        locale: "en-US",
        timezone: "America/Chicago",
        route: "/uncovered",
      },
      authorizedToolNames: new Set(),
    }, {
      open: vi.fn(async () => ({
        ok: false as const,
        code: "surface_not_found" as const,
        message: "none",
      })),
      snapshot: vi.fn(),
    });

    expect(result).toEqual({ systemPrompt: "BASE PROMPT", grounded: false });
  });
});
