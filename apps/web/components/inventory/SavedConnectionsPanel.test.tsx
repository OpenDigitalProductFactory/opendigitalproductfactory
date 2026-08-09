// Server-component test: panel switches between empty-state hero and
// list-with-compact-add-CTA based on listDiscoveryConnections() result.

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/discovery", () => ({
  listDiscoveryConnections: vi.fn(),
}));
vi.mock("./AddDiscoveryConnection", () => ({
  AddDiscoveryConnection: ({ variant = "hero", gatewayCandidates = [] }: {
    variant?: string;
    gatewayCandidates?: unknown[];
  }) => (
    <div data-add-cta data-variant={variant} data-gateway-count={gatewayCandidates.length} />
  ),
}));
vi.mock("./SavedConnectionRow", () => ({
  SavedConnectionRow: ({ connection }: { connection: { id: string; name: string } }) => (
    <div data-row-id={connection.id} data-row-name={connection.name} />
  ),
}));

import { SavedConnectionsPanel } from "./SavedConnectionsPanel";
import { listDiscoveryConnections } from "@/lib/actions/discovery";

const mockList = listDiscoveryConnections as ReturnType<typeof vi.fn>;

describe("SavedConnectionsPanel", () => {
  it("renders hero CTA when no connections exist", async () => {
    mockList.mockResolvedValue({ ok: true, connections: [] });
    const html = renderToStaticMarkup(await SavedConnectionsPanel({
      detectedGateway: "192.168.0.1",
      gatewayCandidates: [{ entityId: "gw-1" } as never],
    }));
    expect(html).toContain('data-add-cta');
    expect(html).toContain('data-variant="hero"');
    expect(html).toContain('data-gateway-count="1"');
    expect(html).not.toContain('data-row-id');
  });

  it("renders hero CTA when listing is unauthorized (graceful fallback)", async () => {
    mockList.mockResolvedValue({ ok: false, error: "Unauthorized" });
    const html = renderToStaticMarkup(await SavedConnectionsPanel({ detectedGateway: null }));
    expect(html).toContain('data-add-cta');
    expect(html).toContain('data-variant="hero"');
  });

  it("renders a row per connection plus a compact 'add another' CTA when rows exist", async () => {
    mockList.mockResolvedValue({
      ok: true,
      connections: [
        {
          id: "c1", connectionKey: "unifi:192.168.0.1", name: "Cloud Gateway",
          collectorType: "unifi", status: "active", endpointUrl: "https://192.168.0.1",
          hasApiKey: true, configuration: { site: "default" },
          lastTestedAt: null, lastTestStatus: null, lastTestMessage: null,
          gatewayEntityId: null,
        },
        {
          id: "c2", connectionKey: "snmp:10.0.0.1", name: "Core Switch SNMP",
          collectorType: "snmp", status: "auth_failed", endpointUrl: "http://10.0.0.1",
          hasApiKey: true, configuration: {},
          lastTestedAt: null, lastTestStatus: null, lastTestMessage: null,
          gatewayEntityId: null,
        },
      ],
    });
    const html = renderToStaticMarkup(await SavedConnectionsPanel({ detectedGateway: null }));
    expect(html).toContain('data-row-id="c1"');
    expect(html).toContain('data-row-id="c2"');
    expect(html).toContain('data-row-name="Cloud Gateway"');
    expect(html).toContain('data-row-name="Core Switch SNMP"');
    expect(html).toContain('data-add-cta');
    expect(html).toContain('data-variant="compact"');
    expect(html).toContain('2 configured');
  });
});
