// @vitest-environment jsdom
import "../test-setup";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilesTouchedCard } from "./FilesTouchedCard";
import { DEMO_FILES_TOUCHED } from "@/lib/build-studio-demo";

describe("FilesTouchedCard", () => {
  it("renders one row per file with kind chips", () => {
    render(<FilesTouchedCard files={DEMO_FILES_TOUCHED} onDrill={() => {}} />);
    expect(screen.getAllByTestId("files-touched-row")).toHaveLength(DEMO_FILES_TOUCHED.length);
    expect(screen.getAllByText(/^new$/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^modified$/i).length).toBeGreaterThan(0);
  });

  it("renders the file count in the header", () => {
    render(<FilesTouchedCard files={DEMO_FILES_TOUCHED} onDrill={() => {}} />);
    expect(
      screen.getByText(new RegExp(`${DEMO_FILES_TOUCHED.length} files`)),
    ).toBeInTheDocument();
  });

  it("invokes onDrill when 'See the diff' is clicked", () => {
    const onDrill = vi.fn();
    render(<FilesTouchedCard files={DEMO_FILES_TOUCHED} onDrill={onDrill} />);
    fireEvent.click(screen.getByRole("button", { name: /see the diff/i }));
    expect(onDrill).toHaveBeenCalledTimes(1);
  });
});
