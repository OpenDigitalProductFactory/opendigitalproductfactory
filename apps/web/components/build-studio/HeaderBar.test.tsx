// @vitest-environment jsdom
import "./test-setup";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HeaderBar } from "./HeaderBar";
import { DEMO_BUILD } from "@/lib/build-studio-demo";

describe("HeaderBar", () => {
  it("renders build title, branch chip, and approvals pill", () => {
    render(
      <HeaderBar
        build={DEMO_BUILD}
        pendingApprovalCount={1}
        otherBuildApprovalCount={2}
        theme="dark"
        onToggleTheme={() => {}}
      />,
    );
    expect(screen.getByText(DEMO_BUILD.title)).toBeInTheDocument();
    expect(screen.getByText(DEMO_BUILD.branch)).toBeInTheDocument();
    expect(screen.getByText(/1 thing waiting on you/)).toBeInTheDocument();
    expect(screen.getByText(/2 more across builds/)).toBeInTheDocument();
  });

  it("invokes onToggleTheme when theme button is clicked", () => {
    const onToggle = vi.fn();
    render(
      <HeaderBar
        build={DEMO_BUILD}
        pendingApprovalCount={0}
        otherBuildApprovalCount={0}
        theme="dark"
        onToggleTheme={onToggle}
      />,
    );
    fireEvent.click(screen.getByLabelText(/toggle theme/i));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("hides approvals pill when there are zero pending approvals anywhere", () => {
    render(
      <HeaderBar
        build={DEMO_BUILD}
        pendingApprovalCount={0}
        otherBuildApprovalCount={0}
        theme="dark"
        onToggleTheme={() => {}}
      />,
    );
    expect(screen.queryByText(/waiting on you/)).not.toBeInTheDocument();
  });

  it("pluralizes the approvals copy when the count is greater than one", () => {
    render(
      <HeaderBar
        build={DEMO_BUILD}
        pendingApprovalCount={2}
        otherBuildApprovalCount={0}
        theme="dark"
        onToggleTheme={() => {}}
      />,
    );
    expect(screen.getByText(/2 things waiting on you/)).toBeInTheDocument();
  });
});
