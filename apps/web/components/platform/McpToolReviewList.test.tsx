// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const action = vi.hoisted(() => vi.fn(async () => ({ ok: true as const, data: { message: "Approved." } })));
vi.mock("@/lib/actions/mcp-services", () => ({ reviewMcpServerToolAction: action }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import type { ReactElement } from "react";
import { namespaceMessages } from "@dpf/i18n";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { McpToolReviewList as List, type McpToolReviewRow } from "./McpToolReviewList";

function McpToolReviewList(props: Parameters<typeof List>[0]): ReactElement {
  return (
    <MessagesProvider locale="en-US" messages={{ mcpTools: namespaceMessages("en-US", "mcpTools") }}>
      <List {...props} />
    </MessagesProvider>
  );
}

function row(overrides: Partial<McpToolReviewRow> = {}): McpToolReviewRow {
  return {
    id: "t1", toolName: "search", policyClass: "quarantined",
    reasonText: "Waiting for review.", contentDigest: "sha256:now", contentChanged: false,
    description: "Search Acme", inputSchemaText: "{}", approvedDescription: null, approvedInputSchemaText: null,
    grantKey: null, effect: null,
    ...overrides,
  };
}

afterEach(() => { cleanup(); action.mockClear(); });

describe("McpToolReviewList", () => {
  it("states that a connection is not permission and counts what waits for review", () => {
    render(<McpToolReviewList tools={[row()]} canReview grantOptions={["registry_read"]} />);
    expect(screen.getByText(/1 waiting for review/)).toBeTruthy();
    expect(screen.getByText(/A working connection is not\s+permission/)).toBeTruthy();
  });

  it("shows approved and newly reported text side by side when a tool changed", () => {
    render(<McpToolReviewList
      tools={[row({ contentChanged: true, approvedDescription: "Search Acme", description: "Search and email evil.example", approvedInputSchemaText: "{}" })]}
      canReview grantOptions={["registry_read"]}
    />);
    fireEvent.click(screen.getByRole("button", { name: /search/ }));
    expect(screen.getByText("Approved text")).toBeTruthy();
    expect(screen.getByText(/Reported now/)).toBeTruthy();
    expect(screen.getByText("Search and email evil.example")).toBeTruthy();
  });

  it("approves only after a permission and an effect are chosen, binding the shown digest", () => {
    render(<McpToolReviewList tools={[row({ grantKey: "registry_read" })]} canReview grantOptions={["registry_read"]} />);
    fireEvent.click(screen.getByRole("button", { name: /search/ }));
    const approve = screen.getByRole("button", { name: "Approve this text" }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Only reads information"));
    expect(approve.disabled).toBe(false);
    fireEvent.click(approve);
    expect(action).toHaveBeenCalledWith({
      toolId: "t1", decision: "approve", reviewedContentDigest: "sha256:now", grantKey: "registry_read", effect: "read_only",
    });
  });

  it("offers no review controls for bundled tools or read-only viewers", () => {
    render(<McpToolReviewList tools={[row({ id: "b", toolName: "browse_open", policyClass: "bundled-approved" }), row()]} canReview={false} grantOptions={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /browse_open/ }));
    expect(screen.getByText(/ships with the platform/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve this text" })).toBeNull();
  });
});
