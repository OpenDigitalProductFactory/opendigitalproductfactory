// @vitest-environment jsdom
//
// HostAddressCell unit tests — pure presentational logic for the
// T2.4 IP / hostname surface in the Edge Nodes admin table.

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockIssueBootstrapTokenAction } = vi.hoisted(() => ({
  mockIssueBootstrapTokenAction: vi.fn(),
}));

vi.mock("@/lib/actions/edge-nodes", () => ({
  approveEdgeNodeAction: vi.fn(),
  issueEdgeBootstrapTokenAction: mockIssueBootstrapTokenAction,
  quarantineEdgeNodeAction: vi.fn(),
  revokeEdgeNodeAction: vi.fn(),
}));

import {
  EdgeNodesAdminClient,
  __test_HostAddressCell as HostAddressCell,
} from "./EdgeNodesAdminClient";

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

describe("EdgeNodesAdminClient customer/site scope", () => {
  it("summarizes runtime mode and warns about container LAN visibility", () => {
    render(
      <EdgeNodesAdminClient
        nodes={[
          {
            ...BASE_NODE,
            platform: "linux",
            installMode: "container-vm",
            trustState: "trusted",
            status: "active",
          },
        ]}
        tokens={[]}
        customerAccounts={CUSTOMER_ACCOUNTS}
      />,
    );

    expect(screen.getByText("Runtime summary")).toBeInTheDocument();
    expect(screen.getByText("1 trusted")).toBeInTheDocument();
    expect(screen.getAllByText("linux / container-vm").length).toBeGreaterThan(0);
    expect(screen.getByText(/limited host-LAN visibility/i)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Issue token" }));

    await waitFor(() => {
      expect(mockIssueBootstrapTokenAction).toHaveBeenCalledWith(
        expect.objectContaining({
          targetCustomerAccountId: "cust_acme",
          targetCustomerSiteId: "site_hq",
        }),
      );
    });
  });
});
