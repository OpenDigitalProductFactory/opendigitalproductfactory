// @vitest-environment jsdom
//
// HostAddressCell unit tests — pure presentational logic for the
// T2.4 IP / hostname surface in the Edge Nodes admin table.

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { __test_HostAddressCell as HostAddressCell } from "./EdgeNodesAdminClient";

afterEach(() => cleanup());

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
