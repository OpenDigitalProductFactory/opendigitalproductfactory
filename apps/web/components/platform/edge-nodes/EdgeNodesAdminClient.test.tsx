// @vitest-environment jsdom
//
// HostAddressCell unit tests — pure presentational logic for the
// T2.4 IP / hostname surface in the Edge Nodes admin table.

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockIssueBootstrapTokenAction, mockPrepareRemoteProvisioning } = vi.hoisted(() => ({
  mockIssueBootstrapTokenAction: vi.fn(),
  mockPrepareRemoteProvisioning: vi.fn(),
}));

vi.mock("@/lib/actions/edge-nodes", () => ({
  approveEdgeNodeAction: vi.fn(),
  issueEdgeBootstrapTokenAction: mockIssueBootstrapTokenAction,
  prepareRemoteEdgeProvisioningAction: mockPrepareRemoteProvisioning,
  quarantineEdgeNodeAction: vi.fn(),
  revokeEdgeNodeAction: vi.fn(),
}));

import {
  EdgeNodesAdminClient,
  __test_HostAddressCell as HostAddressCell,
} from "./EdgeNodesAdminClient";
import type {
  EdgeHealth,
  EdgeReadinessCheck,
  EdgeReadinessNextAction,
} from "@/lib/edge-node/readiness";

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const BASE_NODE = {
  id: "edge_1",
  nodeId: "dpf-edge-1",
  platform: "linux",
  installMode: "container-host",
  version: "0.1.0",
  status: "active",
  trustState: "trusted",
  lastSeenAt: null,
  enrolledAt: null,
  approvedAt: null,
  quarantinedAt: null,
  quarantineReason: null,
  revokedAt: null,
  revocationReason: null,
  displayName: "Acme HQ Edge",
  capabilities: [],
  hostHostname: "edge-acme-hq",
  hostIpAddresses: ["10.0.0.5"],
  customerAccountId: "cust_acme",
  customerAccountName: "Acme Dental",
  customerSiteId: "site_hq",
  customerSiteName: "Headquarters",
  health: "healthy" as EdgeHealth,
  heartbeatAgeMs: 60_000,
  nextAction: "none" as EdgeReadinessNextAction,
  isMainInstallation: true,
  readinessChecks: [
    { key: "service", label: "Host service", status: "pass", detail: "Supervised host service is enrolled." },
    { key: "trust", label: "Trust", status: "pass", detail: "Submissions are accepted." },
    { key: "heartbeat", label: "Heartbeat", status: "pass", detail: "Heartbeat is current." },
    { key: "capability:federation.discovery", label: "Nearby DPF discovery", status: "pass", detail: "Capability is enabled and healthy." },
  ] as EdgeReadinessCheck[],
};

const BASE_TOKEN = {
  id: "boot_1",
  prefix: "dpfboot_ACME",
  scope: "edge:enroll",
  issuedAt: "2026-05-22T12:00:00.000Z",
  expiresAt: "2026-05-22T12:15:00.000Z",
  consumedAt: null,
  consumedByNodeId: null,
  revokedAt: null,
  targetCustomerAccountId: "cust_acme",
  targetCustomerAccountName: "Acme Dental",
  targetCustomerSiteId: "site_hq",
  targetCustomerSiteName: "Headquarters",
};

const CUSTOMER_ACCOUNTS = [
  {
    id: "cust_acme",
    accountId: "CUST-001",
    name: "Acme Dental",
    status: "active",
    sites: [
      {
        id: "site_hq",
        siteId: "SITE-HQ",
        name: "Headquarters",
        status: "active",
      },
      {
        id: "site_branch",
        siteId: "SITE-BR",
        name: "Branch Office",
        status: "active",
      },
    ],
  },
  {
    id: "cust_contoso",
    accountId: "CUST-002",
    name: "Contoso Clinic",
    status: "active",
    sites: [
      {
        id: "site_contoso_hq",
        siteId: "SITE-CT-HQ",
        name: "Main Office",
        status: "active",
      },
    ],
  },
];

describe("HostAddressCell", () => {
  it('renders "—" placeholder when both hostname and IPs are absent', () => {
    render(<HostAddressCell hostname={null} ipAddresses={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it('renders "—" placeholder when hostname null and IPs is empty array', () => {
    render(<HostAddressCell hostname={null} ipAddresses={[]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders hostname alone when no IPs are populated", () => {
    render(<HostAddressCell hostname="edge-warehouse-2" ipAddresses={null} />);
    expect(screen.getByText("edge-warehouse-2")).toBeInTheDocument();
  });

  it("renders hostname + single IP on separate lines", () => {
    render(
      <HostAddressCell
        hostname="edge-warehouse-2"
        ipAddresses={["192.168.1.42"]}
      />,
    );
    expect(screen.getByText("edge-warehouse-2")).toBeInTheDocument();
    expect(screen.getByText("192.168.1.42")).toBeInTheDocument();
  });

  it("renders up to 2 IPs inline before collapsing the rest", () => {
    render(
      <HostAddressCell
        hostname="multihomed-host"
        ipAddresses={[
          "10.0.0.5",
          "192.168.1.42",
          "2001:db8::1",
          "fdab::2",
        ]}
      />,
    );
    expect(screen.getByText("10.0.0.5, 192.168.1.42")).toBeInTheDocument();
    // 4 total - 2 visible = 2 overflow → "(+2 more)"
    expect(screen.getByText(/\+2 more/i)).toBeInTheDocument();
    // Hidden IPs should NOT be rendered as visible text — they live in
    // the metadata blob; operators who need the full list query SQL.
    expect(screen.queryByText("2001:db8::1")).not.toBeInTheDocument();
    expect(screen.queryByText("fdab::2")).not.toBeInTheDocument();
  });

  it("does not show the overflow badge when <=2 IPs are present", () => {
    render(
      <HostAddressCell
        hostname="dual-home"
        ipAddresses={["10.0.0.5", "192.168.1.42"]}
      />,
    );
    expect(screen.queryByText(/more/i)).not.toBeInTheDocument();
  });

  it("renders IPs alone when hostname is missing", () => {
    render(<HostAddressCell hostname={null} ipAddresses={["192.168.1.42"]} />);
    expect(screen.queryByText("—")).not.toBeInTheDocument();
    expect(screen.getByText("192.168.1.42")).toBeInTheDocument();
  });
});

describe("main installation readiness", () => {
  it("shows an enrollment conflict before a disabled-install message", () => {
    render(
      <EdgeNodesAdminClient
        nodes={[]}
        tokens={[]}
        customerAccounts={[]}
        edgeEnabled={false}
        mainInstallationStatus="ambiguous"
      />,
    );

    expect(
      screen.getByText(/More than one installer-managed node claims this installation/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Edge is not enabled for this installation/)).not.toBeInTheDocument();
  });
});

describe("EdgeNodesAdminClient customer/site scope", () => {
  it("shows this installation readiness before the fleet registry", () => {
    render(
      <EdgeNodesAdminClient
        nodes={[BASE_NODE]}
        tokens={[]}
        customerAccounts={CUSTOMER_ACCOUNTS}
        edgeEnabled
        mainInstallationStatus="found"
      />,
    );

    expect(screen.getByRole("heading", { name: "This DPF installation" })).toBeInTheDocument();
    expect(screen.getAllByText("Healthy").length).toBeGreaterThan(0);
    expect(screen.getByText("Nearby DPF discovery")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open connections/i })).toHaveAttribute(
      "href",
      "/platform/federation-links",
    );
  });

  it("summarizes derived health instead of the stored active field", () => {
    render(
      <EdgeNodesAdminClient
        nodes={[
          {
            ...BASE_NODE,
            platform: "linux",
            installMode: "container-vm",
            trustState: "trusted",
            status: "active",
            health: "offline",
            heartbeatAgeMs: 64 * 24 * 60 * 60 * 1000,
            nextAction: "repair-service",
            readinessChecks: [
              { key: "heartbeat", label: "Heartbeat", status: "fail", detail: "The host service has missed the offline threshold." },
            ],
          },
        ]}
        tokens={[]}
        customerAccounts={CUSTOMER_ACCOUNTS}
        edgeEnabled
        mainInstallationStatus="found"
      />,
    );

    expect(screen.getByText("Fleet health")).toBeInTheDocument();
    expect(screen.getByText("1 offline")).toBeInTheDocument();
    expect(screen.queryByText("1 active")).not.toBeInTheDocument();
    expect(screen.getByText("1 trusted")).toBeInTheDocument();
    expect(screen.getAllByText("linux / container-vm").length).toBeGreaterThan(0);
    expect(screen.getByText(/limited host-LAN visibility/i)).toBeInTheDocument();
  });

  it("keeps node health and trust visible as separate fleet columns", () => {
    render(
      <EdgeNodesAdminClient
        nodes={[{ ...BASE_NODE, health: "degraded", trustState: "trusted" }]}
        tokens={[]}
        customerAccounts={CUSTOMER_ACCOUNTS}
        edgeEnabled
        mainInstallationStatus="found"
      />,
    );

    expect(screen.getByRole("columnheader", { name: "Health" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Trust" })).toBeInTheDocument();
    expect(screen.getAllByText("Degraded").length).toBeGreaterThan(0);
    expect(screen.getAllByText("trusted").length).toBeGreaterThan(0);
  });

  it("shows readiness failures and next actions for multiple customer sites", () => {
    render(
      <EdgeNodesAdminClient
        nodes={[
          { ...BASE_NODE, isMainInstallation: false },
          {
            ...BASE_NODE,
            id: "edge_2",
            nodeId: "dpf-edge-2",
            displayName: "Contoso Main Edge",
            customerAccountId: "cust_contoso",
            customerAccountName: "Contoso Clinic",
            customerSiteId: "site_contoso_hq",
            customerSiteName: "Main Office",
            health: "degraded",
            nextAction: "upgrade-node",
            isMainInstallation: false,
            readinessChecks: [
              {
                key: "version",
                label: "Version",
                status: "warning",
                detail: "Node 0.1.0 differs from the current installation 0.2.0.",
              },
            ],
          },
        ]}
        tokens={[]}
        customerAccounts={CUSTOMER_ACCOUNTS}
      />,
    );

    expect(screen.getByRole("heading", { name: "Edge fleet (2)" })).toBeInTheDocument();
    expect(screen.getByText("Acme Dental / Headquarters")).toBeInTheDocument();
    expect(screen.getByText("Contoso Clinic / Main Office")).toBeInTheDocument();
    expect(screen.getByText("Node 0.1.0 differs from the current installation 0.2.0.")).toBeInTheDocument();
    expect(screen.getByText("Upgrade node")).toBeInTheDocument();
  });

  it("shows a governed setup state when no main-installation node is proven", () => {
    render(
      <EdgeNodesAdminClient
        nodes={[]}
        tokens={[]}
        customerAccounts={CUSTOMER_ACCOUNTS}
        edgeEnabled={false}
        mainInstallationStatus="missing"
      />,
    );

    expect(screen.getByRole("heading", { name: "This DPF installation" })).toBeInTheDocument();
    expect(screen.getByText("Setup required")).toBeInTheDocument();
    expect(screen.getByText(/not enabled/i)).toBeInTheDocument();
  });

  it("renders customer/site scope badges for nodes and bootstrap tokens", () => {
    render(
      <EdgeNodesAdminClient
        nodes={[BASE_NODE]}
        tokens={[BASE_TOKEN]}
        customerAccounts={CUSTOMER_ACCOUNTS}
      />,
    );

    expect(screen.getByText("Scope")).toBeInTheDocument();
    expect(screen.getByText("Target")).toBeInTheDocument();
    expect(screen.getAllByText("Acme Dental / Headquarters")).toHaveLength(2);
  });

  it("filters sites by selected customer and forwards the scope when issuing a token", async () => {
    mockIssueBootstrapTokenAction.mockResolvedValue({
      ok: true,
      tokenId: "boot_scoped",
      plaintext: "dpfboot_SCOPED",
      prefix: "dpfboot_SCO",
      expiresAt: "2026-05-22T12:15:00.000Z",
    });

    render(
      <EdgeNodesAdminClient
        nodes={[]}
        tokens={[]}
        customerAccounts={CUSTOMER_ACCOUNTS}
      />,
    );

    const customerSelect = screen.getByLabelText("Customer account");
    const siteSelect = screen.getByLabelText("Customer site");

    expect(siteSelect).toBeDisabled();

    fireEvent.change(customerSelect, { target: { value: "cust_acme" } });
    expect(siteSelect).not.toBeDisabled();
    expect(screen.getByRole("option", { name: "Headquarters" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Main Office" })).not.toBeInTheDocument();

    fireEvent.change(siteSelect, { target: { value: "site_hq" } });
    fireEvent.click(screen.getByRole("button", { name: "Issue raw token only" }));

    await waitFor(() => {
      expect(mockIssueBootstrapTokenAction).toHaveBeenCalledWith(
        expect.objectContaining({
          targetCustomerAccountId: "cust_acme",
          targetCustomerSiteId: "site_hq",
        }),
      );
    });
  });

  it("generates a ready-to-run install command for a remote host", async () => {
    mockPrepareRemoteProvisioning.mockResolvedValue({
      ok: true,
      tokenId: "boot_remote",
      prefix: "dpfboot_REM",
      expiresAt: "2026-05-22T12:15:00.000Z",
      plan: {
        authorityUrl: "https://dpf-authority.lan:443",
        authorityUrlIssues: [],
        os: "linux",
        commands: [
          {
            id: "linux-container",
            label: "Linux — Docker (real LAN)",
            kind: "container",
            worksToday: true,
            shell: "bash",
            command:
              "curl -fsSL https://example/docker-compose.edge-standalone.yml -o docker-compose.edge-standalone.yml && DPF_AUTHORITY_URL='https://dpf-authority.lan:443' DPF_BOOTSTRAP_TOKEN='dpfboot_x' docker compose -f docker-compose.edge-standalone.yml up -d",
            note: "Native Docker Engine on Linux sees the host's real NICs.",
          },
        ],
        approveHint: "The node enrolls as pending. Approve it here on this Edge Nodes page.",
        nativeBinaryNote: "Full-fidelity LAN discovery on Windows/macOS needs the native binary.",
      },
    });

    render(
      <EdgeNodesAdminClient nodes={[]} tokens={[]} customerAccounts={CUSTOMER_ACCOUNTS} />,
    );

    fireEvent.change(screen.getByLabelText("Host operating system"), {
      target: { value: "linux" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate install command" }));

    await waitFor(() => {
      expect(mockPrepareRemoteProvisioning).toHaveBeenCalledWith(
        expect.objectContaining({ os: "linux" }),
      );
    });
    expect(screen.getByText("Run this on the new machine")).toBeInTheDocument();
    expect(
      screen.getByText(/docker compose -f docker-compose\.edge-standalone\.yml up -d/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("warns when the resolved Authority URL is unreachable from another machine", async () => {
    mockPrepareRemoteProvisioning.mockResolvedValue({
      ok: true,
      tokenId: "boot_remote",
      prefix: "dpfboot_REM",
      expiresAt: "2026-05-22T12:15:00.000Z",
      plan: {
        authorityUrl: "http://localhost:3000",
        authorityUrlIssues: ["loopback", "insecure-http"],
        os: "linux",
        commands: [
          {
            id: "linux-container",
            label: "Linux — Docker (real LAN)",
            kind: "container",
            worksToday: true,
            shell: "bash",
            command: "curl ... up -d",
          },
        ],
        approveHint: "The node enrolls as pending.",
        nativeBinaryNote: "Native binary note.",
      },
    });

    render(
      <EdgeNodesAdminClient nodes={[]} tokens={[]} customerAccounts={CUSTOMER_ACCOUNTS} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate install command" }));

    // The loopback warning names NEXT_PUBLIC_BASE_URL — a clean text node we
    // can assert without tripping over the interspersed <code> elements.
    await waitFor(() => {
      expect(screen.getByText("NEXT_PUBLIC_BASE_URL")).toBeInTheDocument();
    });
  });
});
