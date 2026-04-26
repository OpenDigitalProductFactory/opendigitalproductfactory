// @vitest-environment jsdom
import "../test-setup";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DecisionCard } from "./DecisionCard";

describe("DecisionCard", () => {
  it("renders the warning eyebrow, body, and three actions", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const onDrill = vi.fn();
    render(
      <DecisionCard
        body="OK to ship?"
        onApprove={onApprove}
        onRequestChanges={onReject}
        onDrill={onDrill}
      />,
    );
    expect(screen.getByText(/needs your eye/i)).toBeInTheDocument();
    expect(screen.getByText("OK to ship?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /approve & ship/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /request changes/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /see the change/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /approve & ship/i }));
    expect(onApprove).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /request changes/i }));
    expect(onReject).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /see the change/i }));
    expect(onDrill).toHaveBeenCalledTimes(1);
  });
});
