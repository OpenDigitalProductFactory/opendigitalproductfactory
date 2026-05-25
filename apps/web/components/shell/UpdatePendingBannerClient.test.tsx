// @vitest-environment jsdom
import "@/components/build-studio/test-setup";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { UpdatePendingBannerClient } from "./UpdatePendingBannerClient";

describe("UpdatePendingBannerClient", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders as an overlay-friendly banner with a collapse control", () => {
    render(<UpdatePendingBannerClient pendingVersion="v1.2.3" />);

    expect(screen.getByRole("status")).toHaveAttribute("data-overlay-banner", "true");
    expect(screen.getByRole("link", { name: /review in admin/i })).toHaveAttribute(
      "href",
      "/admin/platform-development",
    );
    expect(screen.getByRole("button", { name: /collapse platform update banner/i })).toBeInTheDocument();
  });

  it("collapses into a compact overlay pill and can expand again", () => {
    render(<UpdatePendingBannerClient pendingVersion="v1.2.3" />);

    fireEvent.click(screen.getByRole("button", { name: /collapse platform update banner/i }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /expand platform update banner/i })).toHaveTextContent(
      "Platform update v1.2.3",
    );

    fireEvent.click(screen.getByRole("button", { name: /expand platform update banner/i }));

    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
